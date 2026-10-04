import {
  createStreamConnectionManager,
  tradeStream,
  type BinanceEnvironment,
  type StreamConnectionManager,
  type StreamMessage
} from "@meridian/binance-client";
import type { MarketIngestor } from "../market/market-ingestor-factory.js";

export interface LiveIngestSmokeArgs {
  readonly symbol: string;
  readonly maxEvents: number;
  readonly timeoutMs: number;
  readonly environment: BinanceEnvironment;
}

export interface LiveIngestSmokeResult {
  readonly kind: "live-ingest-smoke-completed";
  readonly symbol: string;
  readonly eventsReceived: number;
  readonly eventsIngested: number;
  readonly timedOut: boolean;
}

export interface LiveIngestSmokeDeps {
  readonly ingestor: Pick<MarketIngestor, "ingest">;
  readonly createStreamManager?: (args: LiveIngestSmokeArgs) => StreamConnectionManager;
}

export function parseLiveIngestSmokeArgs(args: readonly string[]): LiveIngestSmokeArgs {
  const flags = parseFlags(args);

  return {
    symbol: flags.symbol ?? "BTCUSDT",
    maxEvents: parsePositiveInteger(flags.events ?? "3", "events"),
    timeoutMs: parsePositiveInteger(flags.timeoutMs ?? "10000", "timeoutMs"),
    environment: parseEnvironment(flags.environment ?? "production")
  };
}

export function runLiveIngestSmoke(
  args: readonly string[],
  deps: LiveIngestSmokeDeps
): Promise<LiveIngestSmokeResult> {
  const parsed = parseLiveIngestSmokeArgs(args);
  const manager =
    deps.createStreamManager?.(parsed) ??
    createStreamConnectionManager({
      environment: parsed.environment,
      subscriptions: [tradeStream(parsed.symbol)]
    });

  return new Promise<LiveIngestSmokeResult>((resolve, reject) => {
    let settled = false;
    let eventsReceived = 0;
    let eventsIngested = 0;

    const timeout = setTimeout(() => {
      finish(true);
    }, parsed.timeoutMs);

    function finish(timedOut: boolean): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      manager.close();
      resolve({
        kind: "live-ingest-smoke-completed",
        symbol: parsed.symbol,
        eventsReceived,
        eventsIngested,
        timedOut
      });
    }

    function fail(error: unknown): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      manager.close();
      reject(error);
    }

    manager.onMessage((message) => {
      void handleMessage(message).catch(fail);
    });

    async function handleMessage(message: StreamMessage): Promise<void> {
      eventsReceived += 1;
      await deps.ingestor.ingest(message.data);
      eventsIngested += 1;

      if (eventsIngested >= parsed.maxEvents) {
        finish(false);
      }
    }

    manager.connect();
  });
}

function parseFlags(args: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];

    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid live ingest smoke argument near: ${key ?? "<end>"}`);
    }

    flags[key.slice(2)] = value;
  }

  return flags;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${name}: ${value}`);
  }

  return parsed;
}

function parseEnvironment(value: string): BinanceEnvironment {
  if (value === "production" || value === "testnet") {
    return value;
  }

  throw new Error(`Invalid --environment: ${value}`);
}
