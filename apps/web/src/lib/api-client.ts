export interface DashboardTrade {
  readonly id: string;
  readonly time: number;
  readonly price: string;
  readonly quantity: string;
  readonly side: "buy" | "sell";
}

export interface DashboardSnapshot {
  readonly checkedAt: number;
  readonly symbol: string;
  readonly source: string;
  readonly feed: "live" | "stale" | "waiting";
  readonly trades: readonly DashboardTrade[];
  readonly redis: { readonly available: boolean; readonly count: number | null; readonly memoryBytes: number | null };
  readonly database: { readonly available: boolean; readonly count: number | null; readonly checkedAt: number | null };
  readonly recording: { readonly bytes: number; readonly updatedAt: number; readonly path: string } | null;
}

export interface OrderRecord {
  readonly clientOrderId: string;
  readonly strategyId: string;
  readonly signalId: string;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly type: "MARKET" | "LIMIT";
  readonly state: string;
  readonly quantity: string;
  readonly limitPrice: string | null;
  readonly executedQuantity: string;
  readonly cumulativeQuoteQuantity: string;
  readonly exchangeOrderId: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface FillRecord {
  readonly clientOrderId: string;
  readonly strategyId: string;
  readonly executionId: string;
  readonly tradeId: string;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: string;
  readonly price: string;
  readonly fee: string;
  readonly feeAsset: string;
  readonly eventTimeMs: number;
}

export interface RiskEventRecord {
  readonly id: string;
  readonly tsMs: number;
  readonly type: string;
  readonly details: unknown;
}

export interface RiskControlState {
  readonly scope: string;
  readonly engaged: boolean;
  readonly reason: string;
  readonly updatedAtMs: number;
}

export interface StrategyControlState {
  readonly strategyId: string;
  readonly paused: boolean;
  readonly reason: string;
  readonly updatedAtMs: number;
}

export interface TradingState {
  readonly checkedAt: number;
  readonly orders: readonly OrderRecord[];
  readonly fills: readonly FillRecord[];
  readonly riskEvents: readonly RiskEventRecord[];
  readonly riskControl: RiskControlState | null;
  readonly strategies: readonly StrategyControlState[];
}

export interface MarketCandle {
  readonly symbol: string;
  readonly interval: string;
  readonly openTimeMs: number;
  readonly closeTimeMs: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
  readonly closed: boolean;
}

export interface MarketCandlesResponse {
  readonly checkedAt: number;
  readonly symbol: string;
  readonly interval: string;
  readonly candles: readonly MarketCandle[];
}

export interface PositionRecord {
  readonly symbol?: string;
  readonly side?: string;
  readonly quantity?: string;
  readonly entryPrice?: string | null;
  readonly markPrice?: string | null;
  readonly unrealizedPnl?: string | null;
}

export interface AccountSummary {
  readonly checkedAt?: number;
  readonly balances?: readonly { readonly asset: string; readonly free: string; readonly locked: string }[];
  readonly totalEquity?: string;
  readonly availableEquity?: string;
}

export interface RiskState {
  readonly checkedAt?: number;
  readonly riskControl?: RiskControlState | null;
  readonly exposure?: unknown;
}

export async function getDashboard(signal?: AbortSignal): Promise<DashboardSnapshot> {
  return getJson("/api/dashboard", signal);
}

export async function getTradingState(signal?: AbortSignal): Promise<TradingState> {
  return getJson("/api/trading/state", signal);
}

export async function getMarketCandles(
  symbol = "BTCUSDT",
  interval = "15m",
  limit = 200,
  signal?: AbortSignal
): Promise<MarketCandlesResponse> {
  return getJson(
    `/api/market/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`,
    signal
  );
}

export async function getOrders(limit = 50, signal?: AbortSignal): Promise<{ readonly orders: readonly OrderRecord[] }> {
  return getJson(`/api/orders?limit=${limit}`, signal);
}

export async function getFills(limit = 50, signal?: AbortSignal): Promise<{ readonly fills: readonly FillRecord[] }> {
  return getJson(`/api/fills?limit=${limit}`, signal);
}

export async function getPositions(signal?: AbortSignal): Promise<{ readonly positions: readonly PositionRecord[] }> {
  return getJson("/api/positions", signal);
}

export async function getRiskState(signal?: AbortSignal): Promise<RiskState> {
  return getJson("/api/risk/state", signal);
}

export async function getRiskEvents(limit = 50, signal?: AbortSignal): Promise<{ readonly events: readonly RiskEventRecord[] }> {
  return getJson(`/api/risk/events?limit=${limit}`, signal);
}

export async function getAccountSummary(signal?: AbortSignal): Promise<AccountSummary> {
  return getJson("/api/account/summary", signal);
}

export async function engageKillSwitch(reason: string): Promise<unknown> {
  return postJson("/api/risk/kill-switch/engage", { reason });
}

export async function pauseStrategy(strategyId: string, reason: string): Promise<unknown> {
  return postJson(`/api/strategies/${encodeURIComponent(strategyId)}/pause`, { reason });
}

export async function resumeStrategy(strategyId: string, reason: string): Promise<unknown> {
  return postJson(`/api/strategies/${encodeURIComponent(strategyId)}/resume`, {
    reason,
    confirm: "RESUME_STRATEGY"
  });
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, signal === undefined ? {} : { signal });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json() as Promise<T>;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json() as Promise<unknown>;
}
