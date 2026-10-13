import { randomUUID } from "node:crypto";
import { demandedMarketSymbols, marketDemandKey, readMarketDemandScript } from "@meridian/config";
import { Pool } from "pg";
import { createClient } from "redis";
import {
  createStreamConnectionManager,
  depthStream,
  klineStream,
  tradeStream
} from "@meridian/binance-client";
import { createIngestorApp } from "./app-bootstrap.js";
import { loadIngestorConfig } from "./config.js";
import { createRuntimeClients } from "./runtime-clients.js";
import {
  createMetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  type Registry
} from "@meridian/observability";

export const dashboardLeaseKey = "meridian:dashboard:public-feed:BTCUSDT";
export const renewLeaseScript =
  "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end";
export const releaseLeaseScript =
  "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";

export interface DashboardFeedOptions {
  signal: AbortSignal;
  durationMs?: number;
  log?: (event: Record<string, unknown>) => void;
  metricsRegistry?: Registry;
  onReady?: (ready: boolean) => void;
}

export function dashboardFeedDuration(options: DashboardFeedOptions): number | undefined {
  if (
    options.durationMs !== undefined &&
    (!Number.isSafeInteger(options.durationMs) ||
      options.durationMs < 1000 ||
      options.durationMs > 3600000)
  )
    throw new Error("dashboard_feed_duration_must_be_1s_to_1h");
  return options.durationMs;
}

export async function runDashboardFeed(options: DashboardFeedOptions): Promise<void> {
  const durationMs = dashboardFeedDuration(options);
  if (options.signal.aborted) return;
  if ((process.env.MARKET_DATA_ENV ?? "production") !== "production")
    throw new Error("dashboard_feed_requires_production_public_market_data");
  const log = options.log ?? ((event) => console.log(JSON.stringify(event)));
  const registry = options.metricsRegistry ?? createMetricsRegistry("ingestor");
  const reconnectTotal =
    (registry.getSingleMetric("ws_reconnects_total") as Counter | undefined) ??
    new Counter({
      name: "ws_reconnects_total",
      help: "Scheduled upstream reconnect attempts across supervisor retries; resets only on process restart",
      registers: [registry]
    });
  // The supervisor supplies one registry across reconnect attempts; counters survive retries.
  const queue =
    (registry.getSingleMetric("ingestor_backlog") as Gauge | undefined) ??
    new Gauge({
      name: "ingestor_backlog",
      help: "Queued public-feed events",
      registers: [registry]
    });
  const rejected =
    (registry.getSingleMetric("ingestor_backpressure_rejections_total") as Counter | undefined) ??
    new Counter({
      name: "ingestor_backpressure_rejections_total",
      help: "Public feed messages refused at bounded capacity; feed stops for recovery, never silently drops",
      registers: [registry]
    });
  const age =
    (registry.getSingleMetric("ws_last_message_age_seconds") as Gauge | undefined) ??
    new Gauge({
      name: "ws_last_message_age_seconds",
      help: "Age of last upstream message; -1 means not observed",
      registers: [registry]
    });
  const reconnects =
    (registry.getSingleMetric("ws_reconnect_attempts") as Gauge | undefined) ??
    new Gauge({
      name: "ws_reconnect_attempts",
      help: "Reconnect attempts in the current upstream connection manager (resets per retry)",
      registers: [registry]
    });
  const symbolAge =
    (registry.getSingleMetric("meridian_market_connection_age_seconds") as Gauge | undefined) ??
    new Gauge({
      name: "meridian_market_connection_age_seconds",
      help: "Latest upstream message age per active public instrument; -1 means unobserved",
      labelNames: ["symbol"],
      registers: [registry]
    });
  const symbolReady =
    (registry.getSingleMetric("meridian_market_connection_ready") as Gauge | undefined) ??
    new Gauge({
      name: "meridian_market_connection_ready",
      help: "Active public connection is OPEN with a message age no greater than 15 seconds",
      labelNames: ["symbol"],
      registers: [registry]
    });
  const activeConnections =
    (registry.getSingleMetric("meridian_market_connections") as Gauge | undefined) ??
    new Gauge({
      name: "meridian_market_connections",
      help: "Current public-feed connections; at most four, not a historical symbol count",
      registers: [registry]
    });
  symbolAge.reset();
  symbolReady.reset();
  activeConnections.set(0);
  const latency =
    (registry.getSingleMetric("ingestor_operation_duration_ms") as Histogram | undefined) ??
    new Histogram({
      name: "ingestor_operation_duration_ms",
      help: "Public feed ingest operation elapsed milliseconds including DB work; not pure bus latency",
      buckets: [1, 5, 10, 25, 50, 100, 500, 1000, 5000],
      registers: [registry]
    });
  options.onReady?.(false);
  const config = loadIngestorConfig();
  const owner = randomUUID();
  let stopping = false;
  let failure: string | undefined;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const makeManager = (symbol: string) =>
    createStreamConnectionManager({
      onReconnect: () => reconnectTotal.inc(),
      environment: "production",
      subscriptions: [
        tradeStream(symbol),
        depthStream(symbol),
        ...(["1m", "5m", "15m", "1h"] as const).map((interval) => klineStream(symbol, interval))
      ]
    });
  const manager = makeManager("BTCUSDT");
  const managers = new Map([["BTCUSDT", manager]]);
  const connectionStartedAt = new Map([["BTCUSDT", performance.now()]]);
  const lastDemand = new Map<string, number>();
  function sample() {
    let ready = !stopping && performance.now() < leaseDeadline;
    let worstAge = 0;
    let unobserved = false;
    let attempts = 0;
    for (const [symbol, connection] of managers) {
      const lastAge = connection.getLastMessageAgeMs();
      const validAge = lastAge !== undefined && Number.isFinite(lastAge) && lastAge >= 0;
      const connectionReady = validAge && lastAge <= 15000 && connection.getState() === "OPEN";
      symbolAge.set({ symbol }, validAge ? lastAge / 1000 : -1);
      symbolReady.set({ symbol }, stopping ? 0 : Number(connectionReady));
      ready &&= connectionReady;
      unobserved ||= !validAge;
      if (validAge) worstAge = Math.max(worstAge, lastAge);
      attempts += connection.getReconnectCount();
    }
    age.set(unobserved ? -1 : worstAge / 1000);
    reconnects.set(attempts);
    activeConnections.set(stopping ? 0 : managers.size);
    options.onReady?.(ready);
  }
  function stop(reason?: string) {
    if (stopping) return;
    stopping = true;
    failure = reason;
    options.onReady?.(false);
    for (const connection of managers.values()) connection.close();
    finish();
  }
  const redis = createClient({
    url: config.redisUrl,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 1000,
    socket: { connectTimeout: 3000, reconnectStrategy: false }
  });
  redis.on("error", () => stop("dashboard_feed_redis_failed"));
  const command = (args: readonly (string | Buffer)[]): Promise<unknown> =>
    redis.withAbortSignal(AbortSignal.timeout(3000)).sendCommand([...args]);
  const pool = new Pool({
    connectionString: config.postgresUrl,
    max: 2,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000
  });
  pool.on("error", () => stop("dashboard_feed_database_failed"));
  const clients = createRuntimeClients(
    { ...config, redisStreamMaxLen: 2000 },
    {
      createPostgresPool: () => pool,
      createRedisCommandClient: () => ({
        connect: () => redis.connect(),
        quit: async () => {
          if (redis.isOpen) redis.destroy();
        },
        sendCommand: command
      })
    }
  );
  const app = createIngestorApp({
    ...clients,
    metricsRegistry: registry,
    buffer: { capacity: 1000, batchSize: 128, flushMs: 1 }
  });
  const pending = new Set<Promise<void>>();
  let backlog = 0;
  let leased = false;
  let renewing = false;
  let leaseDeadline = 0;
  let leaseTimer: NodeJS.Timeout | undefined;
  let progressTimer: NodeJS.Timeout | undefined;
  let durationTimer: NodeJS.Timeout | undefined;
  let metricsTimer: NodeJS.Timeout | undefined;
  let demandTimer: NodeJS.Timeout | undefined;
  let checkingDemand = false;
  const counts = { trade: 0, depth: 0, kline: 0 };
  const abort = () => stop();
  options.signal.addEventListener("abort", abort, { once: true });
  manager.onStateChange((event) => {
    if (event.state !== "OPEN") options.onReady?.(false);
    if (event.state === "STALE") stop("dashboard_feed_stale");
  });
  try {
    await clients.redis.connect();
    if (options.signal.aborted || stopping) return;
    leased = (await command(["SET", dashboardLeaseKey, owner, "NX", "PX", "30000"])) === "OK";
    if (!leased) throw new Error("dashboard_feed_already_running");
    leaseDeadline = performance.now() + 20000;
    leaseTimer = setInterval(() => {
      if (renewing || stopping) return;
      renewing = true;
      void command(["EVAL", renewLeaseScript, "1", dashboardLeaseKey, owner, "30000"])
        .then((result) => {
          if (result !== 1) stop("dashboard_feed_lease_lost");
          else leaseDeadline = performance.now() + 20000;
        })
        .catch(() => stop("dashboard_feed_lease_failed"))
        .finally(() => {
          renewing = false;
        });
    }, 10000);
    await app.start();
    if (options.signal.aborted || stopping) return;
    const watch = (symbol: string, connection: typeof manager) => {
      if (symbol !== "BTCUSDT")
        connection.onStateChange((event) => {
          if (managers.get(symbol) !== connection) return;
          if (event.state !== "OPEN") options.onReady?.(false);
          if (event.state === "STALE") stop("dashboard_feed_stale");
        });
      connection.onMessage((message) => {
        const receivedAtMs = performance.now();
        if (stopping || managers.get(symbol) !== connection) return;
        if (performance.now() >= leaseDeadline) {
          stop("dashboard_feed_lease_expired");
          return;
        }
        if (backlog >= 1000) {
          rejected.inc();
          stop("dashboard_feed_backlog_capacity");
          return;
        }
        backlog++;
        queue.set(backlog);
        const work = app
          .ingest(message.data, receivedAtMs)
          .then((result) => {
            latency.observe(performance.now() - receivedAtMs);
            counts[result.event.kind]++;
          })
          .catch(() => stop("dashboard_feed_ingest_failed"))
          .finally(() => {
            backlog--;
            queue.set(backlog);
            pending.delete(work);
          });
        pending.add(work);
      });
    };
    watch("BTCUSDT", manager);
    manager.connect();
    demandTimer = setInterval(() => {
      if (stopping || checkingDemand) return;
      checkingDemand = true;
      void command(["EVAL", readMarketDemandScript, "1", marketDemandKey])
        .then((value) => {
          if (stopping) return;
          const wanted = demandedMarketSymbols(value);
          const missing = wanted.filter((symbol) => !managers.has(symbol)).length;
          for (const symbol of wanted) lastDemand.set(symbol, performance.now());
          for (const [symbol, connection] of managers)
            if (!wanted.includes(symbol)) {
              if (
                managers.size + missing <= 4 &&
                performance.now() - (lastDemand.get(symbol) ?? 0) < 10000
              )
                continue;
              managers.delete(symbol);
              connectionStartedAt.delete(symbol);
              lastDemand.delete(symbol);
              symbolAge.remove({ symbol });
              symbolReady.remove({ symbol });
              connection.close();
            }
          for (const symbol of wanted)
            if (!managers.has(symbol)) {
              const connection = makeManager(symbol);
              managers.set(symbol, connection);
              connectionStartedAt.set(symbol, performance.now());
              watch(symbol, connection);
              connection.connect();
            }
          sample();
        })
        .catch(() => stop("dashboard_feed_demand_failed"))
        .finally(() => {
          checkingDemand = false;
        });
    }, 2000);
    sample();
    metricsTimer = setInterval(sample, 5000);
    if (durationMs !== undefined) durationTimer = setTimeout(() => stop(), durationMs);
    progressTimer = setInterval(() => {
      log({
        kind: "public_dashboard_feed",
        counts,
        backlog,
        state: manager.getState(),
        ageMs: manager.getLastMessageAgeMs(),
        reconnects: manager.getReconnectCount()
      });
      for (const [symbol, connection] of managers) {
        const lastAge = connection.getLastMessageAgeMs();
        if (
          (lastAge === undefined &&
            performance.now() - connectionStartedAt.get(symbol)! >= 60000) ||
          (lastAge !== undefined && (!Number.isFinite(lastAge) || lastAge < 0 || lastAge > 60000))
        )
          stop("dashboard_feed_no_progress");
      }
    }, 60000);
    log({
      kind: "public_dashboard_feed_started",
      durationMs: durationMs ?? null,
      redisApproxMaxLen: 2000,
      recording: false,
      trading: false
    });
    await done;
  } finally {
    stop();
    symbolAge.reset();
    symbolReady.reset();
    activeConnections.set(0);
    age.set(-1);
    reconnects.set(0);
    options.signal.removeEventListener("abort", abort);
    clearInterval(leaseTimer);
    clearInterval(progressTimer);
    clearInterval(metricsTimer);
    clearInterval(demandTimer);
    clearTimeout(durationTimer);
    await Promise.allSettled([...pending]);
    await app.drain?.().catch(() => {
      failure ??= "dashboard_feed_ingest_failed";
    });
    if (leased && redis.isReady)
      await command(["EVAL", releaseLeaseScript, "1", dashboardLeaseKey, owner]).catch(
        () => undefined
      );
    if (redis.isOpen) redis.destroy();
    await clients.close();
    log({ kind: "public_dashboard_feed_stopped", counts });
  }
  if (failure) throw new Error(failure);
}
