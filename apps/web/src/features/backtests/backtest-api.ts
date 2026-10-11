import { ApiError, getJson, postJson } from "../../lib/api-client.js";
import { useTerminalStore } from "../../lib/terminal-store.js";

export interface Run {
  runId: string;
  strategy: string;
  symbol: string;
  interval: string;
  fromMs: string;
  toMs: string;
  metrics: Record<string, unknown>;
  createdAt: string;
  params?: Record<string, unknown>;
}
export interface JobRequest {
  requestId: string;
  strategy: "ema";
  symbol: "BTCUSDT";
  interval: "15m" | "1h";
  from: string;
  to: string;
}
export interface Job {
  jobId: string;
  state: "queued" | "running" | "succeeded" | "failed";
  request: JobRequest;
  runId: string | null;
  error: string | null;
}
export interface EquityPoint {
  index: number;
  tsMs: string;
  equity: string;
}
export interface BacktestFill {
  index: number;
  tsMs: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: string;
  price: string;
  fee: string;
  feeAsset: string;
}
export interface Page<T> {
  items: T[];
  nextCursor: number | null;
}
async function authenticated<T>(request: Promise<T>) {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      useTerminalStore.getState().setSession(null, "required");
    throw error;
  }
}
export const backtestApi = {
  runs: (signal?: AbortSignal) =>
    authenticated(getJson<{ runs: Run[] }>("/api/backtests?limit=100", signal)),
  run: (id: string, signal?: AbortSignal) =>
    authenticated(getJson<{ run: Run }>(`/api/backtests/${encodeURIComponent(id)}`, signal)),
  equity: (id: string, after: number, signal?: AbortSignal) =>
    authenticated(
      getJson<Page<EquityPoint>>(
        `/api/backtests/${encodeURIComponent(id)}/equity?after=${after}&limit=1000`,
        signal
      )
    ),
  fills: (id: string, after: number, signal?: AbortSignal) =>
    authenticated(
      getJson<Page<BacktestFill>>(
        `/api/backtests/${encodeURIComponent(id)}/fills?after=${after}&limit=200`,
        signal
      )
    ),
  submit: (request: JobRequest) =>
    authenticated(postJson<{ job: Job }>("/api/backtests/jobs", request)),
  job: (id: string, signal?: AbortSignal) =>
    authenticated(getJson<{ job: Job }>(`/api/backtests/jobs/${encodeURIComponent(id)}`, signal))
};
