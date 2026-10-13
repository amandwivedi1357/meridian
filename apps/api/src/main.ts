import Fastify from "fastify";
import { Pool } from "pg";
import { createClient } from "redis";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import { loadApiAuthConfig } from "./app/auth.js";
import { apiListenAddress } from "./app/listen-address.js";
import { registerApiRoutes } from "./app/register-routes.js";
import { configureGateway } from "./app/gateway.js";
import { registerSessions } from "./app/session.js";
import { createStreamSource } from "./features/streams/stream-source.js";
import { registerStreams } from "./features/streams/streams.js";
import { BinanceRestClient, createTestnetTradingClientFromEnv } from "@meridian/binance-client";
import { registerMarketSnapshot } from "./features/market/snapshot.js";
import { registerMarketInstrumentsRoutes } from "./features/market/instruments.js";
import { createMarketDemand } from "./features/market/demand.js";
import { createRecentHistoryLoader } from "./features/market/recent-history.js";
import { createPortfolioReader } from "./features/account/portfolio.js";
import { Decimal } from "@meridian/core";
import { createJobDispatcher } from "./features/backtests/job-dispatcher.js";
import { createLedgerMetrics, ledgerMetricsSql } from "./features/health/ledger-metrics.js";
import { createWalletReader, unavailableWallet } from "./features/account/wallet.js";
import { Redis } from "ioredis";
import { createSystemHealthReader, registerSystemHealth } from "./features/health/system-health.js";
import {
  createServiceDiagnostics,
  createShutdownGuard,
  createMetricsRegistry,
  createBinanceMetricsFetch,
  diagnosticsAddress
} from "@meridian/observability";
import { registerHttpMetrics } from "./features/health/http-metrics.js";
import { instrumentStorageHealth } from "./features/health/storage-metrics.js";
import { instrumentPortfolio } from "./features/health/portfolio-metrics.js";
import { registerWorkerHealth } from "./features/backtests/worker-health.js";

try {
  loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const server = Fastify({
  bodyLimit: 64 * 1024,
  logger: {
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.x-meridian-api-token",
      "res.headers.set-cookie"
    ]
  }
});
const auth = loadApiAuthConfig(process.env);
const diagnosticsConfig = diagnosticsAddress("api");
const registry = createMetricsRegistry("api");
const monitoredFetch = createBinanceMetricsFetch(registry);
let stopping = false;
let startupComplete = false;
let closeOnStop = () => {};
const shutdown = createShutdownGuard({
  onStop() {
    stopping = true;
    if (startupComplete) closeOnStop();
  }
});
registerHttpMetrics(server, registry);
await configureGateway(server, process.env.REDIS_URL ?? "redis://localhost:6379");
const redis = createClient({
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
  socket: { connectTimeout: 2000 },
  disableOfflineQueue: true
});
redis.on("error", (error) =>
  server.log.warn({ err: error }, "Dashboard Redis connection unavailable")
);
void redis.connect().catch((error) => server.log.warn({ err: error }, "Redis startup failed"));
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://meridian:meridian@localhost:5432/meridian",
  max: 2,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
});
pool.on("error", (error) =>
  server.log.warn({ err: error }, "Dashboard database connection unavailable")
);
const tradingEnvironment = process.env.BINANCE_ENV ?? "testnet";
if (tradingEnvironment !== "testnet" && tradingEnvironment !== "production")
  throw new Error("Invalid BINANCE_ENV");
const valuationClient = new BinanceRestClient({
  environment: tradingEnvironment,
  fetch: monitoredFetch
});
let metadata: Awaited<ReturnType<typeof valuationClient.getExchangeInfo>> | undefined;
let metadataTime = 0;
async function loadMetadata() {
  if (!metadata || Date.now() - metadataTime > 300000) {
    metadata = await valuationClient.getExchangeInfo(3000);
    metadataTime = Date.now();
  }
  return metadata.symbols;
}
let walletClient: Awaited<ReturnType<typeof createTestnetTradingClientFromEnv>> | undefined;
if (tradingEnvironment === "testnet" && process.env.BINANCE_API_KEY) {
  try {
    walletClient = await createTestnetTradingClientFromEnv({
      autoSynchronizeTime: true,
      fetch: monitoredFetch,
      timeoutMs: 3000
    });
  } catch {
    server.log.warn("Read-only Testnet wallet credentials unavailable");
  }
}
const wallet = walletClient
  ? createWalletReader(async () => {
      const observedAtMs = Date.now();
      const [balances, symbols, tickers] = await Promise.all([
        walletClient!.getBalances(),
        loadMetadata(),
        valuationClient.getBookTickers(3000)
      ]);
      return { observedAtMs, balances, metadata: symbols, tickers };
    })
  : async () =>
      unavailableWallet(
        tradingEnvironment !== "testnet"
          ? "production_wallet_not_enabled"
          : "wallet_credentials_required"
      );
const portfolio = instrumentPortfolio(
  createPortfolioReader(
    pool,
    {
      metadata: loadMetadata,
      async mark(symbol) {
        const observedAtMs = Date.now();
        const depth = await valuationClient.getDepth({ symbol, limit: 5, timeoutMs: 3000 });
        const bid = new Decimal(depth.bids[0]?.[0] ?? "NaN"),
          ask = new Decimal(depth.asks[0]?.[0] ?? "NaN");
        if (!bid.isFinite() || !ask.isFinite() || bid.lte(0) || ask.lt(bid))
          throw new Error("mark_unavailable");
        return { price: bid.plus(ask).div(2).toFixed(), observedAtMs };
      }
    },
    tradingEnvironment,
    Date.now,
    wallet
  ),
  registry
);
registerApiRoutes(server, {
  auth,
  redis,
  pool,
  portfolio,
  workspace: fileURLToPath(new URL("../../../", import.meta.url))
});
await registerSessions(server, auth);
const streamSource = createStreamSource(process.env.REDIS_URL ?? "redis://localhost:6379", pool, {
  portfolio
});
const marketEnvironment = process.env.MARKET_DATA_ENV ?? "production";
if (marketEnvironment !== "production" && marketEnvironment !== "testnet")
  throw new Error("Invalid MARKET_DATA_ENV");
const marketClient = new BinanceRestClient({
  environment: marketEnvironment,
  fetch: monitoredFetch
});
let marketMetadata: Awaited<ReturnType<typeof marketClient.getExchangeInfo>> | undefined;
let marketMetadataTime = 0;
async function loadMarketMetadata() {
  if (!marketMetadata || Date.now() - marketMetadataTime > 300000) {
    marketMetadata = await marketClient.getExchangeInfo(3000);
    marketMetadataTime = Date.now();
  }
  return marketMetadata;
}
registerMarketInstrumentsRoutes(server, loadMarketMetadata);
registerMarketSnapshot(
  server,
  pool,
  streamSource,
  (symbol) => marketClient.getDepth({ symbol, limit: 100, timeoutMs: 3000 }),
  createRecentHistoryLoader((symbol, interval, endTime) =>
    marketClient.getKlines({ symbol, interval, endTime, limit: 200 })
  )
);
const healthRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  connectTimeout: 2000,
  commandTimeout: 2000,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false
});
healthRedis.on("error", () => {});
const health = instrumentStorageHealth(
  createSystemHealthReader({
    command: (args) => healthRedis.call(args[0]!, ...args.slice(1)),
    database: () => pool.query("SELECT 1")
  }),
  registry
);
const diagnostics = createServiceDiagnostics({
  service: "api",
  registry,
  checkReady: async () => {
    jobs.health();
    // Ledger scans must not determine API readiness; stale samples are withheld separately.
    void sampleLedger();
    const sample = await health();
    return (
      redis.isReady &&
      sample.redis === "available" &&
      sample.database === "available" &&
      Date.now() - sample.checkedAt < 10000
    );
  }
});
registerSystemHealth(server, health);
registerStreams(server, streamSource, {
  health,
  marketDemand: createMarketDemand(
    (args) => redis.withAbortSignal(AbortSignal.timeout(2000)).sendCommand([...args]),
    async (symbol) =>
      (await loadMarketMetadata()).symbols.some(
        (entry) =>
          entry.symbol === symbol &&
          entry.status === "TRADING" &&
          entry.isSpotTradingAllowed &&
          entry.quoteAsset === "USDT"
      )
  )
});
const jobPool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://meridian:meridian@localhost:5432/meridian",
  max: 1,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
});
jobPool.on("error", () => server.log.warn("Backtest job database unavailable"));
await jobPool.query("SELECT 1 FROM backtest_jobs LIMIT 1");
const jobs = createJobDispatcher(
  jobPool,
  process.env.DATABASE_URL ?? "postgres://meridian:meridian@localhost:5432/meridian",
  {
    metricsRegistry: registry,
    onUnavailable: () => server.log.warn("Backtest queue unavailable")
  }
);
registerWorkerHealth(server, jobs.health);
const sampleLedger = createLedgerMetrics(registry, async () => {
  const result = await jobPool.query(ledgerMetricsSql);
  return result.rows[0]?.snapshot;
});
server.addHook("preClose", async () => {
  diagnostics.stopping();
  await jobs.close();
});
server.addHook("onClose", async () => {
  await diagnostics.close();
  await walletClient?.close();
  healthRedis.disconnect();
  if (redis.isOpen) redis.destroy();
  await pool.end();
  await jobPool.end();
});

server.get("/health/live", async (_request, reply) => {
  if (stopping) return reply.code(503).send({ status: "unavailable" });
  return { status: "ok" };
});
server.get("/health/ready", async (_request, reply) => {
  const ready = await diagnostics.ready();
  return reply.code(ready ? 200 : 503).send({ status: ready ? "ok" : "unavailable" });
});

const listenAddress = apiListenAddress(process.env);
closeOnStop = () => {
  diagnostics.stopping();
  void server
    .close()
    .then(() => shutdown.finish())
    .catch(() => {
      server.log.error("API shutdown failed");
      process.exitCode = 1;
    });
};

try {
  if (stopping) throw new Error("API startup cancelled");
  await diagnostics.listen(diagnosticsConfig);
  await server.listen(listenAddress);
} catch (error) {
  await server.close();
  shutdown.finish();
  throw error;
}
startupComplete = true;
if (stopping) closeOnStop();
else {
  diagnostics.started();
  jobs.start();
}
