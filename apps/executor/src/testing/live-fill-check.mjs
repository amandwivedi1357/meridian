import { loadEnvFile } from "node:process";
import { fileURLToPath, URL } from "node:url";
import { setTimeout } from "node:timers";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createClient } from "redis";
import { GenericContainer, Wait } from "testcontainers";
import { Decimal, projectTestnetAllocation, serializeSignal } from "@meridian/core";
import { createRedisStreamClient, streams } from "@meridian/bus";
import {
  createOrderWriteAheadRepository,
  createRiskRepository,
  createTestnetAllocationRepository,
  testnetAccountBinding,
  marketDataMigrations
} from "@meridian/db";
import {
  BinanceRestClient,
  createTestnetTradingClientFromEnv,
  createBinanceExchangeGateway,
  createQueryBeforeRetryOrderSubmitter
} from "@meridian/binance-client";
import { createKillSwitch } from "../../dist/kill-switch.js";
import { createExecutorUserDataTracker } from "../../dist/user-data-tracker.js";
import { createExecutorRuntimeFromDeps } from "../../dist/executor-runtime-factory.js";
import { createRiskEngine } from "../../dist/risk-engine.js";
import { calculateDailyRealizedPnl } from "../../dist/risk-accounting.js";
import { createRiskSnapshotReader } from "../../dist/risk-snapshot.js";
import { loadRiskConfig } from "../../dist/risk-config.js";
import { createLiveStrategyRunner } from "../../../engine/dist/live-strategy-runner.js";
import { createAllocatedAccountState } from "../../../engine/dist/allocated-account-state.js";
import { createLiveFillReader } from "../../../engine/dist/live-fill-reader.js";

if (process.argv.slice(2).join(" ") !== "--confirm-bounded-testnet-fills")
  throw new Error("Explicit --confirm-bounded-testnet-fills required; maximum two IOC orders");
loadEnvFile(fileURLToPath(new URL("../../../../.env", import.meta.url)));
const runId = `fill-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
const artifact = `logs/verification/${runId}.json`;
const policy = { id: runId, quoteAsset: "USDT", initialQuote: "100", symbols: ["BTCUSDT"] };
const symbol = "BTCUSDT";
const ownIds = new Set();
const errors = [];
let postgres, redisContainer, pool, redis, trading, tracker;
let placements = 0;
let excludedWalletAssets = [];
let completed = false;
let latestProof = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function save(extra = {}) {
  await writeFile(
    artifact,
    JSON.stringify(
      {
        runId,
        environment: "testnet",
        policy,
        placements,
        ownIds: [...ownIds],
        excludedWalletAssets,
        ...latestProof,
        ...extra
      },
      null,
      2
    )
  );
}
try {
  await mkdir("logs/verification", { recursive: true });
  await save({ stage: "preflight" });
  trading = await createTestnetTradingClientFromEnv({ autoSynchronizeTime: true });
  await trading.synchronizeTime();
  const publicClient = new BinanceRestClient({ environment: "testnet" });
  const info = await publicClient.getExchangeInfo();
  const metadata = info.symbols.find((m) => m.symbol === symbol && m.status === "TRADING");
  if (!metadata?.isSpotTradingAllowed || !metadata.orderTypes.includes("LIMIT"))
    throw new Error("BTCUSDT Testnet LIMIT unavailable");
  const lot = metadata.filters.find((f) => f.filterType === "LOT_SIZE");
  const priceFilter = metadata.filters.find((f) => f.filterType === "PRICE_FILTER");
  const notionalFilter = metadata.filters.find((f) =>
    ["MIN_NOTIONAL", "NOTIONAL"].includes(f.filterType)
  );
  if (!lot || !priceFilter || !notionalFilter) throw new Error("Exchange filters unavailable");
  const step = new Decimal(lot.stepSize),
    tick = new Decimal(priceFilter.tickSize);
  if (!step.isFinite() || step.lte(0) || !tick.isFinite() || tick.lte(0))
    throw new Error("Invalid filters");
  const initial = projectTestnetAllocation({
    policy,
    metadata: info.symbols,
    balances: await trading.getBalances(),
    openOrders: await trading.openOrders(),
    fills: [],
    managedOrders: []
  });
  excludedWalletAssets = initial.excludedWalletAssets;
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
  const execute = async (q) => {
    const r = await pool.query(q.text, [...q.values]);
    return { rows: r.rows, rowCount: r.rowCount };
  };
  const db = {
    execute,
    async transaction(work) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const result = await work({
          async execute(q) {
            const r = await c.query(q.text, [...q.values]);
            return { rows: r.rows, rowCount: r.rowCount };
          }
        });
        await c.query("COMMIT");
        return result;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    }
  };
  for (const m of marketDataMigrations) await pool.query(m.sql);
  redis = createClient({
    url: `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`,
    socket: { reconnectStrategy: false }
  });
  redis.on("error", () => {});
  await redis.connect();
  const bus = createRedisStreamClient({ sendCommand: (args) => redis.sendCommand([...args]) });
  const store = createOrderWriteAheadRepository(db),
    repo = createRiskRepository(db),
    allocationRepo = createTestnetAllocationRepository(db);
  const binding = testnetAccountBinding(process.env.BINANCE_API_KEY);
  await allocationRepo.initialize({
    database: db,
    policy,
    accountBinding: binding,
    actor: "bounded-verification",
    excludedWalletAssets,
    backingBaseline: initial.backingTotals
  });
  const assertPolicy = () => allocationRepo.assertPolicy(policy, binding);
  const kill = createKillSwitch({
    repo,
    command: (args) => redis.sendCommand([...args]),
    listOpenOrders: async () =>
      (await trading.openOrders({ symbol })).filter((o) => ownIds.has(o.clientOrderId)),
    cancelOrder: trading.cancelOrder,
    alert: (details) => errors.push({ alert: details })
  });
  await kill.reset("bounded-verification", async () => {});
  const snapshot = createRiskSnapshotReader({
    publicClient,
    tradingClient: trading,
    repo,
    symbols: [symbol],
    quoteAsset: "USDT",
    allocation: {
      policy,
      assertPolicy,
      backingBaseline: allocationRepo.backingBaseline,
      listManagedOrders: allocationRepo.listManagedOrders
    },
    assertPortfolioPolicy: assertPolicy
  });
  const risk = createRiskEngine({
    repo,
    killSwitch: kill,
    config: loadRiskConfig({}),
    snapshot,
    assertPortfolioPolicy: assertPolicy,
    assertReady: async () => {
      if (!tracker) throw new Error("Tracker absent");
      await tracker.assertReady();
    }
  });
  const submitter = createQueryBeforeRetryOrderSubmitter(trading);
  const gateway = createBinanceExchangeGateway({
    client: {
      ...trading,
      async placeOrder(input) {
        const qty = new Decimal(input.quantity),
          price = new Decimal(input.price);
        if (
          input.symbol !== symbol ||
          input.type !== "LIMIT" ||
          input.timeInForce !== "GTC" ||
          placements >= 2 ||
          qty.gt("0.0002") ||
          qty.lte(0) ||
          price.mul(qty).gt(25) ||
          qty.mod(step).gt(0) ||
          price.mod(tick).gt(0) ||
          qty.lt(lot.minQty) ||
          qty.gt(lot.maxQty) ||
          price.lt(priceFilter.minPrice) ||
          price.gt(priceFilter.maxPrice) ||
          price.mul(qty).lt(notionalFilter.minNotional)
        )
          throw new Error("Bounded placement fails bounds/filters");
        if (
          notionalFilter.maxNotional !== undefined &&
          new Decimal(notionalFilter.maxNotional).gt(0) &&
          price.mul(qty).gt(notionalFilter.maxNotional)
        )
          throw new Error("Exchange max notional exceeded");
        await tracker.assertReady();
        await kill.assertSafe();
        ownIds.add(input.clientOrderId);
        placements++;
        await save({ stage: "before-send" });
        // IOC prevents an unfilled verification limit from remaining on the book.
        return (await submitter.placeOrder({ ...input, timeInForce: "IOC" })).order;
      }
    }
  });
  const runtime = createExecutorRuntimeFromDeps({
    database: db,
    binanceClient: trading,
    logger: {
      info() {},
      warn() {},
      error(details) {
        errors.push(details);
      }
    },
    signalConsumer: {
      bus,
      exchange: gateway,
      riskGate: risk,
      group: "verification",
      consumer: "verification",
      clientOrderIdPrefix: "fillcheck",
      blockMs: 100,
      recordRejection: (details) => repo.recordEvent("signal-rejected", details),
      async beforeSubmit(signal) {
        const decision = await risk.evaluate(signal);
        if (!decision.approved) throw new Error(`Final risk rejected: ${decision.reason}`);
      }
    }
  });
  tracker = createExecutorUserDataTracker({
    store,
    stream: {
      start: () => trading.userData.start(),
      close: () => trading.userData.close(),
      getState: () => trading.userData.getState(),
      onStateChange: (handler) => trading.userData.onStateChange(handler),
      onEvent: (handler) =>
        trading.userData.onEvent((event) => {
          if (
            event.kind === "order-update" &&
            (ownIds.has(event.clientOrderId) || ownIds.has(event.originalClientOrderId))
          )
            handler(event);
        })
    },
    reconcile: async () => {
      const r = await runtime.reconcileAfterReconnect();
      if (r.missingOnExchange.length || r.queryFailed.length)
        throw new Error("Unresolved verification orders");
    },
    onError: (error) => errors.push(error.message)
  });
  await runtime.start();
  await tracker.start();
  const account = createAllocatedAccountState({
    policy,
    publicClient,
    tradingClient: trading,
    fillReader: createLiveFillReader({ query: execute }),
    assertPolicy,
    backingBaseline: allocationRepo.backingBaseline,
    listManagedOrders: allocationRepo.listManagedOrders
  });
  async function runLeg(side, qty) {
    const depth = await publicClient.getDepth({ symbol, limit: 5 });
    const limit =
      side === "BUY"
        ? new Decimal(depth.asks[0][0]).mul("1.001").div(tick).ceil().mul(tick)
        : new Decimal(depth.bids[0][0]).mul("0.999").div(tick).floor().mul(tick);
    if (
      qty.mul(limit).gt(25) ||
      qty.gt("0.0002") ||
      qty.lt(lot.minQty) ||
      qty.mul(limit).lt(notionalFilter.minNotional)
    )
      throw new Error("Leg exceeds bounds/minimum");
    const { serverTime } = await publicClient.getServerTime();
    const rows = await publicClient.getKlines({ symbol, interval: "1m", limit: 3 });
    const row = rows.filter((r) => r[6] < serverTime).at(-1);
    if (!row) throw new Error("No actual closed market candle");
    let emitted = false;
    const runner = createLiveStrategyRunner({
      strategy: {
        id: "bounded-fill-check",
        onCandle(candle, ctx) {
          if (!emitted) {
            emitted = true;
            ctx.submit({
              symbol,
              side,
              type: "LIMIT",
              quantity: qty,
              limitPrice: limit,
              reason: "bounded real-fill verification"
            });
          }
        }
      },
      accountState: account,
      publishSignal: (signal) =>
        bus.xAdd(streams.signals, "*", {
          kind: "signal",
          payload: JSON.stringify(serializeSignal(signal))
        }),
      nowMs: Date.now,
      signalTtlMs: 30000,
      maxMarketDataAgeMs: 90000
    });
    const signals = await runner.handleMarketEvent({
      kind: "candle",
      candle: {
        symbol,
        interval: "1m",
        openTimeMs: row[0],
        closeTimeMs: row[6],
        open: new Decimal(row[1]),
        high: new Decimal(row[2]),
        low: new Decimal(row[3]),
        close: new Decimal(row[4]),
        volume: new Decimal(row[5]),
        closed: true
      }
    });
    if (signals.length !== 1)
      throw new Error("Verification strategy did not emit exactly one signal");
    const results = await runtime.pollSignalsOnce();
    if (results.length !== 1 || results[0].outcome !== "submitted")
      throw new Error(`Risk/consumer blocked leg: ${JSON.stringify(results)}`);
    const clientOrderId = results[0].clientOrderId;
    const deadline = Date.now() + 15000;
    let saved;
    do {
      await tracker.assertReady();
      saved = (
        await pool.query(
          "SELECT state, executed_quantity::text AS quantity FROM orders WHERE client_order_id=$1",
          [clientOrderId]
        )
      ).rows[0];
      if (saved && ["FILLED", "EXPIRED", "CANCELED"].includes(saved.state)) break;
      await sleep(100);
    } while (Date.now() < deadline);
    if (
      !saved ||
      !["FILLED", "EXPIRED", "CANCELED"].includes(saved.state) ||
      new Decimal(saved.quantity).lte(0)
    )
      throw new Error(`Real fill not durably observed for ${clientOrderId}`);
    const exchange = await trading.queryOrder({ symbol, clientOrderId });
    if (!new Decimal(exchange.executedQty).eq(saved.quantity))
      throw new Error("Persisted quantity does not match exchange");
    await account.refresh();
    latestProof = {
      ...latestProof,
      [side.toLowerCase()]: {
        clientOrderId,
        state: saved.state,
        executedQuantity: saved.quantity,
        signalValidUntilMs: signals[0].validUntilMs
      }
    };
    await save({ stage: `${side.toLowerCase()}-filled` });
    return signals[0].validUntilMs;
  }
  const until = await runLeg("BUY", new Decimal("0.0002"));
  console.log(
    JSON.stringify({
      runId,
      stage: "buy-fill-persisted",
      waitingFor: "conservative reservation TTL before sell",
      artifact
    })
  );
  await sleep(Math.max(0, until - Date.now() + 100));
  await account.refresh();
  const sellQty = Decimal.min(account.position(symbol).quantity, new Decimal("0.0002"))
    .div(step)
    .floor()
    .mul(step);
  await runLeg("SELL", sellQty);
  const finalSnapshot = await snapshot();
  const realized = calculateDailyRealizedPnl(
    finalSnapshot.fills,
    Date.now(),
    "USDT",
    finalSnapshot.assetPrice
  );
  await risk.monitor();
  await kill.assertSafe();
  if (
    (await trading.openOrders({ symbol })).some((o) => ownIds.has(o.clientOrderId)) ||
    errors.length ||
    trading.userData.getReconnectCount() > 0
  )
    throw new Error("Unexpected open order, gap or tracking error");
  const fills = await repo.listFills();
  latestProof = {
    ...latestProof,
    completedAt: new Date().toISOString(),
    fills,
    managedResidualBTC: finalSnapshot.positions.get(symbol).toFixed(),
    allocatedEquity: finalSnapshot.equity.toFixed(),
    realizedPnl: realized.globalPnl.toFixed(),
    postFillRiskMonitorPassed: true,
    scope:
      "deterministic one-shot strategies using actual closed candles; real risk-approved Testnet fills; isolated 100-USDT allocation; max two IOC orders; not EMA performance or unattended acceptance",
    ownOrdersOpen: 0
  };
  await save({ stage: "fills-and-risk-verified" });
  await kill.engage("bounded-fill-verification-complete", "verification-operator");
  completed = true;
  await save({ stage: "passed" });
  console.log(JSON.stringify({ runId, artifact, placements, ...latestProof }));
} catch (error) {
  latestProof = { ...latestProof, failureMessage: error.message };
  await save({ stage: "failed", message: error.message, errors });
  console.error(
    JSON.stringify({ runId, artifact, message: error.message, placements, ownIds: [...ownIds] })
  );
  process.exitCode = 1;
} finally {
  if (trading) {
    for (const clientOrderId of ownIds) {
      try {
        const own = await trading.queryOrder({ symbol, clientOrderId });
        if (["NEW", "PARTIALLY_FILLED", "PENDING_NEW", "PENDING_CANCEL"].includes(own.status))
          await trading.cancelOrder({ symbol, clientOrderId });
        const terminal = await trading.queryOrder({ symbol, clientOrderId });
        if (
          !["FILLED", "CANCELED", "EXPIRED", "REJECTED", "EXPIRED_IN_MATCH"].includes(
            terminal.status
          )
        ) {
          console.error(`Operator reconciliation required for ${clientOrderId}`);
          process.exitCode = 1;
        }
      } catch {
        console.error(
          `Operator reconciliation required for Testnet ID ${clientOrderId}; see ${artifact}`
        );
        process.exitCode = 1;
      }
    }
  }
  // A failed export must not prevent closing sockets or disposable containers.
  const cleanup = async (name, work) => {
    try {
      await work();
    } catch (error) {
      console.error(`Verification cleanup failed (${name}): ${error.message}`);
      process.exitCode = 1;
    }
  };
  await cleanup("tracker", async () => tracker?.close());
  await cleanup("fill export", async () => {
    if (pool && !completed) {
      const rows = (await pool.query("SELECT * FROM order_fills ORDER BY event_time_ms")).rows;
      await save({
        stage: "failed-cleaned-up",
        fills: rows,
        errors,
        notice:
          "Any executed inventory remains owned by this test portfolio; no blind retry or wallet-inventory sell"
      });
    }
  });
  await cleanup("trading client", async () => trading?.close());
  await cleanup("redis client", async () => redis?.destroy());
  await cleanup("postgres client", async () => pool?.end());
  await cleanup("redis container", async () => redisContainer?.stop());
  await cleanup("postgres container", async () => postgres?.stop());
}
