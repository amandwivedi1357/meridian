import { mkdir, appendFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout, clearTimeout } from "node:timers";
import { Decimal } from "../../packages/core/dist/index.js";
import {
  BinanceRestClient,
  createStreamConnectionManager,
  klineStream,
  parseKlineStreamPayload
} from "../../packages/binance-client/dist/index.js";
import { createLiveStrategyRunner } from "../../apps/engine/dist/live-strategy-runner.js";
import { createEngineEmaCrossoverStrategy } from "../../apps/engine/dist/ema-crossover-strategy.js";
import { createSimBroker } from "../../apps/backtest-worker/dist/broker/create-sim-broker.js";

const directory = `sessions/verification/candle-parity-${randomUUID()}`;
const symbol = "BTCUSDT";
const interval = "15m";
const intervalMs = 900000;
const options = { symbol, interval, fastPeriod: 2, slowPeriod: 3, quantity: new Decimal("0.0002") };
const broker = createSimBroker({
  symbol,
  baseAsset: "BTC",
  quoteAsset: "USDT",
  initialQuoteBalance: new Decimal(1000),
  slippageBps: new Decimal(0),
  takerFeeRate: new Decimal(0)
});
const stream = createStreamConnectionManager({
  subscriptions: [klineStream(symbol, interval)],
  environment: "production"
});
let lastClose = -1;
let decisionAtMs = 0;
let liveClosedBars = 0;
let bars = 0;
let signals = 0;
let initialized = false;
let pending = Promise.resolve();
let finish;
let fail;
const completed = new Promise((resolve, reject) => {
  finish = resolve;
  fail = reject;
});
// Attach immediately so early socket/bootstrap failures do not become unhandled rejections.
completed.catch(() => {});
const deadline = setTimeout(() => fail(new Error("No clean live close within 16 minutes")), 960000);
const runner = createLiveStrategyRunner({
  strategy: createEngineEmaCrossoverStrategy(options),
  nowMs: Date.now,
  signalTtlMs: 5000,
  maxMarketDataAgeMs: Number.MAX_SAFE_INTEGER,
  position: broker.position,
  balance: broker.balance,
  async publishSignal(signal) {
    await appendFile(
      `${directory}/signals.ndjson`,
      `${JSON.stringify({ decisionAtMs, signal })}\n`
    );
    broker.submit(signal.intent, decisionAtMs);
    signals++;
    return "recorded";
  }
});
async function consume(candle, source) {
  if (!candle.closed || candle.closeTimeMs <= lastClose) return;
  if (lastClose !== -1 && candle.openTimeMs !== lastClose + 1)
    throw new Error("Candle capture gap");
  if (candle.closeTimeMs - candle.openTimeMs !== intervalMs - 1)
    throw new Error("Invalid candle duration");
  await appendFile(
    `${directory}/events.ndjson`,
    `${JSON.stringify({ kind: "kline", symbol, candle, source, receivedAtMs: Date.now() })}\n`
  );
  broker.processCandle(candle);
  decisionAtMs = candle.closeTimeMs;
  await runner.handleMarketEvent({ kind: "candle", candle });
  lastClose = candle.closeTimeMs;
  bars++;
  if (source === "websocket") liveClosedBars++;
}
const buffered = [];
stream.onStateChange((event) => {
  if (event.state === "BACKOFF" || event.state === "STALE")
    fail(new Error("Market capture interrupted"));
});
stream.onMessage((message) => {
  try {
    const payload = message.data;
    if (payload.e !== "kline") return;
    const candle = parseKlineStreamPayload(payload);
    if (!candle.closed) return;
    if (!initialized) {
      buffered.push(candle);
      return;
    }
    pending = pending
      .then(async () => {
        await consume(candle, "websocket");
        if (liveClosedBars > 0) finish();
      })
      .catch(fail);
  } catch (error) {
    fail(error);
  }
});
try {
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/signals.ndjson`, "", { flag: "wx" });
  stream.connect();
  const publicClient = new BinanceRestClient({ environment: "production" });
  const { serverTime } = await publicClient.getServerTime();
  const boundary = Math.floor(serverTime / intervalMs) * intervalMs;
  const klines = await publicClient.getKlines({
    symbol,
    interval,
    endTime: boundary - 1,
    limit: 100
  });
  for (const row of klines) {
    await consume(
      {
        symbol,
        interval,
        openTimeMs: row[0],
        closeTimeMs: row[6],
        open: new Decimal(row[1]),
        high: new Decimal(row[2]),
        low: new Decimal(row[3]),
        close: new Decimal(row[4]),
        volume: new Decimal(row[5]),
        closed: true
      },
      "rest-warmup"
    );
  }
  initialized = true;
  for (const candle of buffered.sort((a, b) => a.openTimeMs - b.openTimeMs))
    await consume(candle, "websocket");
  console.log(
    JSON.stringify({
      directory,
      warmupBars: bars - liveClosedBars,
      waitingFor: "one live 15m candle close",
      ordersPlaced: 0
    })
  );
  if (!liveClosedBars) await completed;
  await pending;
  if (stream.getReconnectCount() !== 0 || liveClosedBars === 0 || signals === 0)
    throw new Error("Capture is not nonempty and continuous");
  const manifest = {
    symbol,
    interval,
    fastPeriod: 2,
    slowPeriod: 3,
    quantity: "0.0002",
    initialQuoteBalance: "1000",
    slippageBps: "0",
    takerFeeRate: "0",
    bars,
    signals,
    liveClosedBars,
    warmupSource: "public REST closed klines",
    liveSource: "public production market WebSocket",
    execution: "independent simulated broker; no trading",
    completedAt: new Date().toISOString()
  };
  await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ directory, ...manifest }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  stream.close();
}
