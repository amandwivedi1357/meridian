import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { Pool } from "pg";
import { GenericContainer, Wait } from "testcontainers";
import { Decimal } from "@meridian/core";
import {
  createOrderWriteAheadRepository,
  marketDataMigrations
} from "@meridian/db";
import {
  BinanceRestClient,
  createBinanceReconciliationExchange,
  createTestnetTradingClientFromEnv
} from "@meridian/binance-client";
import { runAccountTradeCatchUp } from "../account-trade-catch-up.js";
import { runStartupReconciliation } from "../startup-reconciliation.js";

if (process.argv.slice(2).join(" ") !== "--confirm-bounded-testnet-missed-fill-catch-up") {
  throw new Error(
    "Explicit --confirm-bounded-testnet-missed-fill-catch-up required; maximum two IOC Testnet orders"
  );
}

loadEnvFile(fileURLToPath(new URL("../../../../.env", import.meta.url)));

const runId = `missfill-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
const artifact = `logs/verification/${runId}.json`;
const symbol = "BTCUSDT";
const strategyId = "missed-fill-catch-up";
const ownIds = new Set();
const legs = [];
const errors = [];
let postgres;
let pool;
let trading;
let placements = 0;
let completed = false;

async function save(extra = {}) {
  await writeFile(
    artifact,
    JSON.stringify(
      {
        runId,
        environment: "testnet",
        scope:
          "bounded live REST account-trade catch-up fixture; user-data persistence intentionally skipped; max two IOC orders; not unattended acceptance",
        symbol,
        placements,
        ownIds: [...ownIds],
        legs,
        errors,
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
  const metadata = (await publicClient.getExchangeInfo()).symbols.find(
    (entry) => entry.symbol === symbol && entry.status === "TRADING"
  );
  if (!metadata?.isSpotTradingAllowed || !metadata.orderTypes.includes("LIMIT")) {
    throw new Error("BTCUSDT Testnet LIMIT unavailable");
  }

  const filters = readFilters(metadata);
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
  pool = new Pool({
    connectionString: `postgres://verification:verification@${postgres.getHost()}:${postgres.getMappedPort(5432)}/verification`
  });
  for (const migration of marketDataMigrations) {
    await pool.query(migration.sql);
  }

  const database = {
    async execute(query) {
      const result = await pool.query(query.text, [...query.values]);
      return { rows: result.rows, rowCount: result.rowCount };
    }
  };
  const store = createOrderWriteAheadRepository(database);

  const buy = await placeAndCatchUpMissedFill({
    publicClient,
    store,
    side: "BUY",
    quantity: new Decimal("0.0002"),
    filters
  });
  const sellQuantity = buy.executedQuantity.div(filters.step).floor().mul(filters.step);
  if (sellQuantity.lte(0)) throw new Error("No filled BUY quantity available for SELL cleanup");

  await placeAndCatchUpMissedFill({
    publicClient,
    store,
    side: "SELL",
    quantity: sellQuantity,
    filters
  });

  const openOwnOrders = (await trading.openOrders({ symbol })).filter((order) =>
    ownIds.has(order.clientOrderId)
  );
  if (openOwnOrders.length > 0) {
    throw new Error("Fixture left own open orders on Testnet");
  }

  const fills = await queryFills();
  if (fills.length !== 2) throw new Error(`Expected 2 recovered fills, found ${fills.length}`);

  completed = true;
  await save({ stage: "passed", fills });
  console.log(
    JSON.stringify({
      runId,
      artifact,
      placements,
      fillsPersisted: fills.length,
      ownOrdersOpen: 0
    })
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown missed-fill catch-up failure";
  errors.push(message);
  await save({ stage: "failed", message });
  console.error(JSON.stringify({ runId, artifact, message, placements, ownIds: [...ownIds] }));
  process.exitCode = 1;
} finally {
  await cleanupOwnOrders();
  await cleanup("trading client", async () => trading?.close());
  await cleanup("postgres client", async () => pool?.end());
  await cleanup("postgres container", async () => postgres?.stop());
  if (!completed) {
    await save({
      stage: "failed-cleaned-up",
      fills: pool === undefined ? [] : await queryFills().catch(() => [])
    }).catch(() => undefined);
  }
}

async function placeAndCatchUpMissedFill({ publicClient, store, side, quantity, filters }) {
  if (placements >= 2) throw new Error("Fixture placement limit exceeded");

  const clientOrderId = `${side.toLowerCase()}_${runId}`.slice(0, 36);
  const price = await executableIocPrice(publicClient, side, quantity, filters);
  const now = Date.now();
  await store.recordPendingOrder({
    clientOrderId,
    strategyId,
    signalId: `${runId}-${side.toLowerCase()}`,
    attempt: placements,
    symbol,
    side,
    type: "LIMIT",
    quantity: quantity.toString(),
    limitPrice: price.toString(),
    createdAtMs: now
  });
  const claimed = await store.claimOrderSubmission(clientOrderId);
  if (!claimed) throw new Error(`Could not claim local order ${clientOrderId}`);

  ownIds.add(clientOrderId);
  placements += 1;
  await save({ stage: `${side.toLowerCase()}-before-send`, clientOrderId, price: price.toString() });

  const placed = await trading.placeOrder({
    symbol,
    side,
    type: "LIMIT",
    quantity: quantity.toString(),
    price: price.toString(),
    timeInForce: "IOC",
    clientOrderId
  });
  const queried = await trading.queryOrder({ symbol, clientOrderId });
  const executedQuantity = new Decimal(queried.executedQty);
  if (executedQuantity.lte(0)) {
    throw new Error(`${side} IOC did not fill; status=${queried.status}`);
  }

  const catchUp = await reconcileAndCatchUpUntilFilled(store, clientOrderId);
  const fillRows = await queryFills(clientOrderId);
  if (fillRows.length !== 1) {
    throw new Error(`${side} catch-up did not persist exactly one fill`);
  }

  const leg = {
    side,
    clientOrderId,
    exchangeOrderId: String(queried.orderId),
    placedStatus: placed.status,
    queriedStatus: queried.status,
    executedQuantity: executedQuantity.toString(),
    cumulativeQuoteQuantity: queried.cummulativeQuoteQty,
    catchUp,
    fill: fillRows[0]
  };
  legs.push(leg);
  await save({ stage: `${side.toLowerCase()}-catch-up-persisted` });
  return { ...leg, executedQuantity };
}

async function reconcileAndCatchUpUntilFilled(store, clientOrderId) {
  let report;
  let result;
  const deadline = Date.now() + 15_000;
  do {
    report = await runStartupReconciliation({
      store,
      exchange: createBinanceReconciliationExchange({ client: trading }),
      logger: {
        info() {},
        warn(details, message) {
          errors.push({ message, details });
        },
        error(details, message) {
          errors.push({ message, details });
        }
      },
      reason: "startup",
      async accountTradeCatchUp(reconciliationReport) {
        result = await runAccountTradeCatchUp({
          report: reconciliationReport,
          accountTrades: { getAccountTrades: trading.getAccountTrades },
          store
        });
        return result;
      }
    });

    if (report.terminalOnExchange.some((item) => item.clientOrderId === clientOrderId)) {
      if ((await queryFills(clientOrderId)).length > 0) break;
      result = await runAccountTradeCatchUp({
        report,
        accountTrades: { getAccountTrades: trading.getAccountTrades },
        store
      });
    }

    if ((await queryFills(clientOrderId)).length > 0) break;
    await setTimeout(500);
  } while (Date.now() < deadline);

  if ((await queryFills(clientOrderId)).length === 0) {
    throw new Error(`REST account-trade catch-up did not recover ${clientOrderId}`);
  }

  return {
    checked: report?.checked ?? 0,
    terminalOnExchange: report?.terminalOnExchange.length ?? 0,
    matched: report?.matched.length ?? 0,
    missingOnExchange: report?.missingOnExchange.length ?? 0,
    queryFailed: report?.queryFailed.length ?? 0,
    accountTradeCatchUp: result
  };
}

async function executableIocPrice(publicClient, side, quantity, filters) {
  const depth = await publicClient.getDepth({ symbol, limit: 5 });
  const raw =
    side === "BUY"
      ? new Decimal(depth.asks[0][0]).mul("1.003")
      : new Decimal(depth.bids[0][0]).mul("0.997");
  const price =
    side === "BUY"
      ? raw.div(filters.tick).ceil().mul(filters.tick)
      : raw.div(filters.tick).floor().mul(filters.tick);
  const notional = price.mul(quantity);
  if (notional.gt(25)) throw new Error(`${side} notional exceeds 25 USDT`);
  if (quantity.gt("0.0002")) throw new Error(`${side} quantity exceeds fixture cap`);
  if (quantity.mod(filters.step).gt(0)) throw new Error(`${side} quantity violates step size`);
  if (quantity.lt(filters.minQty) || quantity.gt(filters.maxQty)) {
    throw new Error(`${side} quantity violates exchange lot size`);
  }
  if (price.lt(filters.minPrice) || price.gt(filters.maxPrice)) {
    throw new Error(`${side} price violates exchange price filter`);
  }
  if (notional.lt(filters.minNotional)) {
    throw new Error(`${side} notional below exchange minimum`);
  }
  if (filters.maxNotional !== undefined && filters.maxNotional.gt(0) && notional.gt(filters.maxNotional)) {
    throw new Error(`${side} notional above exchange maximum`);
  }
  return price;
}

function readFilters(metadata) {
  const lot = metadata.filters.find((filter) => filter.filterType === "LOT_SIZE");
  const price = metadata.filters.find((filter) => filter.filterType === "PRICE_FILTER");
  const notional = metadata.filters.find((filter) =>
    ["MIN_NOTIONAL", "NOTIONAL"].includes(filter.filterType)
  );
  if (!lot || !price || !notional) throw new Error("Exchange filters unavailable");
  return {
    step: new Decimal(lot.stepSize),
    minQty: new Decimal(lot.minQty),
    maxQty: new Decimal(lot.maxQty),
    tick: new Decimal(price.tickSize),
    minPrice: new Decimal(price.minPrice),
    maxPrice: new Decimal(price.maxPrice),
    minNotional: new Decimal(notional.minNotional),
    maxNotional:
      notional.maxNotional === undefined ? undefined : new Decimal(notional.maxNotional)
  };
}

async function queryFills(clientOrderId) {
  if (pool === undefined) return [];
  const params = clientOrderId === undefined ? [] : [clientOrderId];
  const where = clientOrderId === undefined ? "" : "WHERE client_order_id = $1";
  const rows = await pool.query(
    `
      SELECT
        client_order_id,
        execution_id,
        trade_id,
        symbol,
        side,
        quantity::text,
        price::text,
        fee::text,
        fee_asset,
        event_time_ms::text
      FROM order_fills
      ${where}
      ORDER BY event_time_ms, client_order_id
    `,
    params
  );
  return rows.rows;
}

async function cleanupOwnOrders() {
  if (trading === undefined) return;
  for (const clientOrderId of ownIds) {
    try {
      const order = await trading.queryOrder({ symbol, clientOrderId });
      if (["NEW", "PARTIALLY_FILLED", "PENDING_NEW", "PENDING_CANCEL"].includes(order.status)) {
        await trading.cancelOrder({ symbol, clientOrderId });
      }
      const terminal = await trading.queryOrder({ symbol, clientOrderId });
      if (!["FILLED", "CANCELED", "EXPIRED", "EXPIRED_IN_MATCH", "REJECTED"].includes(terminal.status)) {
        errors.push(`Operator reconciliation required for ${clientOrderId}`);
        process.exitCode = 1;
      }
    } catch (error) {
      errors.push(`Operator reconciliation required for ${clientOrderId}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

async function cleanup(name, work) {
  try {
    await work();
  } catch (error) {
    console.error(`Verification cleanup failed (${name}): ${error.message}`);
    process.exitCode = 1;
  }
}
