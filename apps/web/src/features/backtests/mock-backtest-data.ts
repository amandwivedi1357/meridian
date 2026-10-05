// Temporary visual-only data for the Backtests preview. Replace with API-backed data in Phase 4.
export interface BacktestPoint {
  readonly t: string;
  readonly equity: number;
  readonly drawdown: number;
}

export interface BacktestFill {
  readonly id: string;
  readonly time: string;
  readonly side: "BUY" | "SELL";
  readonly price: number;
  readonly quantity: string;
  readonly fee: string;
  readonly reason: string;
}

export interface BacktestRun {
  readonly id: string;
  readonly label: string;
  readonly strategy: string;
  readonly symbol: string;
  readonly interval: "15m" | "1h";
  readonly range: string;
  readonly status: "saved" | "reported";
  readonly metrics: {
    readonly totalReturnPct: number;
    readonly maxDrawdownPct: number;
    readonly tradeCount: number;
    readonly winRatePct: number;
    readonly buyAndHoldReturnPct: number;
    readonly sharpeRatio: number;
    readonly profitFactor: number;
  };
  readonly equity: readonly BacktestPoint[];
  readonly fills: readonly BacktestFill[];
}

export const mockBacktestRuns: readonly BacktestRun[] = [
  {
    id: "ema-btc-jan-2024",
    label: "EMA 12/26 · January validation",
    strategy: "EMA crossover",
    symbol: "BTCUSDT",
    interval: "15m",
    range: "2024-01-01 → 2024-02-01",
    status: "reported",
    metrics: {
      totalReturnPct: -0.112751,
      maxDrawdownPct: 0.144664,
      tradeCount: 128,
      winRatePct: 47.6,
      buyAndHoldReturnPct: 0.9368,
      sharpeRatio: -0.18,
      profitFactor: 0.91
    },
    equity: [
      { t: "Jan 01", equity: 10000, drawdown: 0 },
      { t: "Jan 05", equity: 10008, drawdown: -0.02 },
      { t: "Jan 09", equity: 9996, drawdown: -0.12 },
      { t: "Jan 13", equity: 10004, drawdown: -0.04 },
      { t: "Jan 17", equity: 9991, drawdown: -0.15 },
      { t: "Jan 21", equity: 10002, drawdown: -0.05 },
      { t: "Jan 25", equity: 9993, drawdown: -0.14 },
      { t: "Jan 31", equity: 9988.72, drawdown: -0.13 }
    ],
    fills: [
      {
        id: "128",
        time: "2024-01-31 18:15",
        side: "SELL",
        price: 42580.42,
        quantity: "0.001",
        fee: "0.0426 USDT",
        reason: "EMA bearish crossover"
      },
      {
        id: "127",
        time: "2024-01-31 09:45",
        side: "BUY",
        price: 42390.18,
        quantity: "0.001",
        fee: "0.0424 USDT",
        reason: "EMA bullish crossover"
      },
      {
        id: "126",
        time: "2024-01-30 22:30",
        side: "SELL",
        price: 42911.77,
        quantity: "0.001",
        fee: "0.0429 USDT",
        reason: "EMA bearish crossover"
      }
    ]
  },
  {
    id: "grid-btc-lab",
    label: "Grid mean reversion · sample report",
    strategy: "Grid mean reversion",
    symbol: "BTCUSDT",
    interval: "1h",
    range: "2024-01-01 → 2024-02-01",
    status: "saved",
    metrics: {
      totalReturnPct: 0.2489,
      maxDrawdownPct: 0.2184,
      tradeCount: 42,
      winRatePct: 54.8,
      buyAndHoldReturnPct: 0.9368,
      sharpeRatio: 0.42,
      profitFactor: 1.18
    },
    equity: [
      { t: "Jan 01", equity: 10000, drawdown: 0 },
      { t: "Jan 05", equity: 10011, drawdown: 0 },
      { t: "Jan 09", equity: 10004, drawdown: -0.07 },
      { t: "Jan 13", equity: 10022, drawdown: 0 },
      { t: "Jan 17", equity: 10018, drawdown: -0.04 },
      { t: "Jan 21", equity: 10031, drawdown: 0 },
      { t: "Jan 25", equity: 10020, drawdown: -0.11 },
      { t: "Jan 31", equity: 10024.89, drawdown: -0.06 }
    ],
    fills: [
      {
        id: "42",
        time: "2024-01-31 20:00",
        side: "SELL",
        price: 42750.0,
        quantity: "0.005",
        fee: "0.2138 USDT",
        reason: "Grid mean-reversion sell"
      },
      {
        id: "41",
        time: "2024-01-30 11:00",
        side: "BUY",
        price: 42120.0,
        quantity: "0.005",
        fee: "0.2106 USDT",
        reason: "Grid mean-reversion buy"
      }
    ]
  },
  {
    id: "ema-atr-sizing-lab",
    label: "EMA with ATR sizing · risk check",
    strategy: "EMA crossover + ATR sizing",
    symbol: "BTCUSDT",
    interval: "15m",
    range: "2024-01-01 → 2024-02-01",
    status: "saved",
    metrics: {
      totalReturnPct: 0.0712,
      maxDrawdownPct: 0.0933,
      tradeCount: 128,
      winRatePct: 47.6,
      buyAndHoldReturnPct: 0.9368,
      sharpeRatio: 0.11,
      profitFactor: 1.04
    },
    equity: [
      { t: "Jan 01", equity: 10000, drawdown: 0 },
      { t: "Jan 05", equity: 10005, drawdown: 0 },
      { t: "Jan 09", equity: 10002, drawdown: -0.03 },
      { t: "Jan 13", equity: 10008, drawdown: 0 },
      { t: "Jan 17", equity: 10001, drawdown: -0.07 },
      { t: "Jan 21", equity: 10009, drawdown: 0 },
      { t: "Jan 25", equity: 10004, drawdown: -0.05 },
      { t: "Jan 31", equity: 10007.12, drawdown: -0.02 }
    ],
    fills: [
      {
        id: "128",
        time: "2024-01-31 18:15",
        side: "SELL",
        price: 42580.42,
        quantity: "0.0014",
        fee: "0.0596 USDT",
        reason: "EMA bearish crossover"
      }
    ]
  }
];
