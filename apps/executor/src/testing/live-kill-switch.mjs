import { loadEnvFile } from "node:process";
import { fileURLToPath, URL } from "node:url";
import { setTimeout } from "node:timers";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createClient } from "redis";
import { GenericContainer, Wait } from "testcontainers";
import { Decimal, serializeSignal } from "@meridian/core";
import { createRedisStreamClient, ensureConsumerGroup, streams } from "@meridian/bus";
import {
  createOrderWriteAheadRepository,
  createRiskRepository,
  marketDataMigrations
} from "@meridian/db";
import { BinanceRestClient, createTestnetTradingClientFromEnv } from "@meridian/binance-client";
import { runBoundedOrderCheck } from "../../../../packages/binance-client/dist/rest/bounded-order-check.js";
import { createKillSwitch, KILL_SWITCH_KEY } from "../../dist/kill-switch.js";
import { createExecutorUserDataTracker } from "../../dist/user-data-tracker.js";
import { createRiskEngine } from "../../dist/risk-engine.js";
import { createRiskSnapshotReader } from "../../dist/risk-snapshot.js";
import { loadRiskConfig } from "../../dist/risk-config.js";
import { processSignalMessage } from "../../dist/signal-execution.js";

if (process.argv.slice(2).join(" ") !== "--confirm-bounded-testnet-check") {
  throw new Error("Explicit --confirm-bounded-testnet-check required; creates one Testnet order");
}
loadEnvFile(fileURLToPath(new URL("../../../../.env", import.meta.url)));
const id = `mrd-check-${randomUUID().replaceAll("-", "").slice(0, 24)}`;
const symbol = "BTCUSDT";
const quantity = new Decimal("0.0002");
const artifact = `logs/verification/${id}.json`;
let postgres;
let redisContainer;
let pool;
let redis;
let tracker;
let trading;
let attempted = false;
let verifiedClean = false;
let placements = 0;
let userDataUpdates = 0;
const errors = [];
const alerts = [];
try {
  await mkdir("logs/verification", { recursive: true });
  await writeFile(
    artifact,
    JSON.stringify({
      id,
      symbol,
      quantity: quantity.toFixed(),
      stage: "preflight",
      environment: "testnet"
    }),
    { flag: "wx" }
  );
  trading = await createTestnetTradingClientFromEnv({ autoSynchronizeTime: true });
  await trading.synchronizeTime();
  const publicClient = new BinanceRestClient({ environment: "testnet" });
  const metadata = (await publicClient.getExchangeInfo()).symbols.find(
    (entry) => entry.symbol === symbol
  );
  if (
    !metadata ||
    metadata.status !== "TRADING" ||
    !metadata.isSpotTradingAllowed ||
    !metadata.orderTypes.includes("LIMIT")
  )
    throw new Error("Testnet symbol unavailable");
  const lot = metadata.filters.find((filter) => filter.filterType === "LOT_SIZE");
  const priceFilter = metadata.filters.find((filter) => filter.filterType === "PRICE_FILTER");
  const notionalFilter = metadata.filters.find((filter) =>
    ["MIN_NOTIONAL", "NOTIONAL"].includes(filter.filterType)
  );
  if (!lot || !priceFilter || !notionalFilter) throw new Error("Exchange filters unavailable");
  const tick = new Decimal(priceFilter.tickSize);
  const step = new Decimal(lot.stepSize);
  const depth = await publicClient.getDepth({ symbol, limit: 5 });
  const price = new Decimal(depth.bids[0][0]).times("0.995").div(tick).floor().times(tick);
  const notional = price.times(quantity);
  if (
    !tick.isFinite() ||
    tick.lte(0) ||
    !step.isFinite() ||
    step.lte(0) ||
    !price.isFinite() ||
    price.lte(0) ||
    quantity.mod(step).gt(0) ||
    quantity.lt(lot.minQty) ||
    quantity.gt(lot.maxQty) ||
    price.lt(priceFilter.minPrice) ||
    price.gt(priceFilter.maxPrice) ||
    notional.lt(notionalFilter.minNotional) ||
    (notionalFilter.maxNotional !== undefined &&
      new Decimal(notionalFilter.maxNotional).gt(0) &&
      notional.gt(notionalFilter.maxNotional)) ||
    notional.gt(25)
  )
    throw new Error("Bounded order fails exchange filters");
  postgres = await new GenericContainer("timescale/timescaledb:latest-pg16")
    .withEnvironment({
      POSTGRES_USER: "verification",
      POSTGRES_PASSWORD: "verification",
      POSTGRES_DB: "verification"
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections", 2))
    .withStartupTimeout(120000)
    .start();
  redisContainer = await new GenericContainer("redis:7-alpine")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
    .start();
  pool = new Pool({
    connectionString: `postgres://verification:verification@${postgres.getHost()}:${postgres.getMappedPort(5432)}/verification`
  });
  const execute = async (query) => {
    const result = await pool.query(query.text, [...query.values]);
    return { rows: result.rows, rowCount: result.rowCount };
  };
  const db = {
    execute,
    async transaction(work) {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        const result = await work({
          async execute(query) {
            const result = await connection.query(query.text, [...query.values]);
            return { rows: result.rows, rowCount: result.rowCount };
          }
        });
        await connection.query("COMMIT");
        return result;
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
      }
    }
  };
  for (const migration of marketDataMigrations) await pool.query(migration.sql);
  redis = createClient({
    url: `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`,
    socket: { reconnectStrategy: false }
  });
  redis.on("error", () => {});
  await redis.connect();
  const bus = createRedisStreamClient({ sendCommand: (args) => redis.sendCommand([...args]) });
  const store = createOrderWriteAheadRepository(db);
  const repo = createRiskRepository(db);
  const kill = createKillSwitch({
    repo,
    command: (args) => redis.sendCommand([...args]),
    listOpenOrders: async () =>
      (await trading.openOrders({ symbol })).filter((order) => order.clientOrderId === id),
    cancelOrder: trading.cancelOrder,
    alert: (details) => alerts.push(details)
  });
  // All state is disposable. Cancellation is scoped to this exact verification ID.
  await kill.reset("bounded-verification", async () => {});
  tracker = createExecutorUserDataTracker({
    store,
    reconcile: async () => {},
    onError: (error) => errors.push(error.message),
    stream: {
      start: () => trading.userData.start(),
      close: () => trading.userData.close(),
      getState: () => trading.userData.getState(),
      onStateChange: (handler) => trading.userData.onStateChange(handler),
      onEvent: (handler) =>
        trading.userData.onEvent((event) => {
          if (
            event.kind === "order-update" &&
            (event.clientOrderId === id || event.originalClientOrderId === id)
          ) {
            userDataUpdates++;
            handler(event);
          }
        })
    }
  });
  await tracker.start();
  const pending = {
    clientOrderId: id,
    strategyId: "bounded-cancellation-fixture",
    signalId: id,
    attempt: 0,
    symbol,
    side: "BUY",
    type: "LIMIT",
    quantity: quantity.toFixed(),
    limitPrice: price.toFixed(),
    createdAtMs: Date.now()
  };
  let killElapsedMs;
  await writeFile(
    artifact,
    JSON.stringify({
      ...pending,
      environment: "testnet",
      stage: "before-placement",
      notional: notional.toFixed()
    })
  );
  const result = await runBoundedOrderCheck(
    {
      ...trading,
      async placeOrder(request) {
        await store.recordPendingOrder(pending);
        if (!(await store.claimOrderSubmission(id)))
          throw new Error("Verification submission already claimed");
        await tracker.assertReady();
        await kill.assertSafe();
        attempted = true;
        placements++;
        return trading.placeOrder(request);
      },
      async cancelOrder(request) {
        if (request.clientOrderId !== id)
          throw new Error("Cancellation outside verification scope");
        const start = Date.now();
        await kill.engage("bounded-live-verification", "verification-operator");
        killElapsedMs = Date.now() - start;
        return trading.queryOrder(request);
      }
    },
    { symbol, quantity: quantity.toFixed(), price: price.toFixed(), clientOrderId: id }
  );
  verifiedClean = true;
  const deadline = Date.now() + 10000;
  let savedState;
  do {
    await tracker.assertReady();
    savedState = (await pool.query("SELECT state FROM orders WHERE client_order_id = $1", [id]))
      .rows[0]?.state;
    if (savedState === "CANCELED") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  if (
    savedState !== "CANCELED" ||
    userDataUpdates < 1 ||
    errors.length ||
    trading.userData.getReconnectCount() > 0
  )
    throw new Error("Live cancellation report was not durably tracked without a stream gap");
  const risk = createRiskEngine({
    repo,
    killSwitch: kill,
    config: loadRiskConfig({}),
    assertReady: tracker.assertReady,
    snapshot: createRiskSnapshotReader({
      publicClient,
      tradingClient: trading,
      repo,
      symbols: [symbol],
      quoteAsset: "USDT"
    })
  });
  const now = Date.now();
  const signal = {
    signalId: `${id}-blocked`,
    strategyId: "bounded-verification",
    createdAtMs: now,
    validUntilMs: now + 30000,
    intent: {
      symbol,
      side: "BUY",
      type: "LIMIT",
      quantity,
      limitPrice: price,
      reason: "must be blocked"
    }
  };
  await ensureConsumerGroup(bus, streams.signals, "verification");
  await bus.xAdd(streams.signals, "*", {
    kind: "signal",
    payload: JSON.stringify(serializeSignal(signal))
  });
  const message = (
    await bus.xReadGroup("verification", "verification", [{ key: streams.signals, id: ">" }])
  )[0].messages[0];
  const blocked = await processSignalMessage(message, {
    bus,
    group: "verification",
    store,
    riskGate: risk,
    exchange: {
      placeOrder: async () => {
        throw new Error("Kill switch authorized an unexpected order");
      }
    },
    recordRejection: (details) => repo.recordEvent("signal-rejected", details),
    clientOrderIdPrefix: "check",
    nowMs: Date.now
  });
  if (
    blocked.outcome !== "rejected" ||
    blocked.reason !== "kill-switch-engaged" ||
    alerts.length === 0 ||
    !(await repo.getKillState()).engaged ||
    (await redis.get(KILL_SWITCH_KEY)) !== "1" ||
    killElapsedMs > 5000
  )
    throw new Error("Live kill-switch verification failed");
  const proof = {
    ...result,
    artifact,
    completedAt: new Date().toISOString(),
    killElapsedMs,
    userDataUpdates,
    savedState,
    alerts: alerts.length,
    durableKillEngaged: true,
    blockedSignal: blocked,
    placements,
    scope:
      "one bounded cancellation fixture; isolated DB/Redis; real signed orders and user-data; no strategy fills"
  };
  await writeFile(artifact, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} catch (error) {
  await writeFile(
    artifact,
    JSON.stringify(
      { clientOrderId: id, stage: "failed", message: error.message, placements, alerts, errors },
      null,
      2
    )
  );
  console.error(
    JSON.stringify({ clientOrderId: id, artifact, message: error.message, placements })
  );
  process.exitCode = 1;
} finally {
  if (attempted && !verifiedClean && trading) {
    try {
      const own = await trading.queryOrder({ symbol, clientOrderId: id });
      if (["NEW", "PARTIALLY_FILLED", "PENDING_NEW", "PENDING_CANCEL"].includes(own.status))
        await trading.cancelOrder({ symbol, clientOrderId: id });
      const terminal = await trading.queryOrder({ symbol, clientOrderId: id });
      if (
        !["CANCELED", "FILLED", "EXPIRED", "REJECTED", "EXPIRED_IN_MATCH"].includes(terminal.status)
      ) {
        console.error(
          `Operator reconciliation required for nonterminal Testnet order ${id}; see ${artifact}`
        );
        process.exitCode = 1;
      }
    } catch {
      console.error(`Operator reconciliation required for Testnet order ${id}; see ${artifact}`);
      process.exitCode = 1;
    }
  }
  await tracker?.close();
  trading?.close();
  redis?.destroy();
  await pool?.end();
  await redisContainer?.stop();
  await postgres?.stop();
}
