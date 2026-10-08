import { Decimal, type Signal } from "@meridian/core";
import type { RiskRepository, RiskReservation } from "@meridian/db";
import { describe, expect, it, vi } from "vitest";
import { createRiskEngine, type RiskSnapshot } from "./risk-engine.js";
import { loadRiskConfig } from "./risk-config.js";
import type { RiskFill } from "./risk-accounting.js";

function fixture(env: NodeJS.ProcessEnv = {}) {
  let now = 100_000;
  let engaged = false;
  let peak = new Decimal(1000);
  const reservations: Record<string, unknown>[] = [];
  const repo = {
    getKillState: vi.fn(async () => ({ engaged, reason: "test" })),
    setKillState: vi.fn(async (value: boolean) => {
      engaged = value;
    }),
    recordEvent: vi.fn(async () => undefined),
    updatePeak: vi.fn(async (equity: string) => {
      peak = Decimal.max(peak, equity);
      return peak.toFixed();
    }),
    listFills: vi.fn(async () => []),
    listActiveReservations: vi.fn(async () => reservations),
    countRecentReservations: vi.fn(async () => reservations.length),
    reserve: vi.fn(async (r: RiskReservation) => {
      reservations.push({
        signal_id: r.signalId,
        strategy_id: r.strategyId,
        symbol: r.symbol,
        side: r.side,
        quantity: r.quantity,
        notional: r.notional
      });
    }),
    locked: vi.fn()
  } satisfies RiskRepository;
  let queue = Promise.resolve();
  repo.locked.mockImplementation(async (work) => {
    const before = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await before;
    try {
      return await work(repo);
    } finally {
      release();
    }
  });
  const killSwitch = {
    check: vi.fn(async () => engaged),
    assertSafe: vi.fn(async () => undefined),
    engage: vi.fn(async () => {
      engaged = true;
    }),
    reset: vi.fn(async () => undefined)
  };
  const snapshot: RiskSnapshot = {
    observedAtMs: now,
    equity: new Decimal(1000),
    globalExposure: new Decimal(0),
    positions: new Map([["BTCUSDT", new Decimal(0)]]),
    markets: new Map([["BTCUSDT", { mid: new Decimal(83000), observedAtMs: now }]]),
    openOrderCount: 0,
    fills: [],
    assetPrice: () => new Decimal(1)
  };
  const readSnapshot = vi.fn(async () => snapshot);
  const assertReady = vi.fn(async () => undefined);
  const engine = createRiskEngine({
    repo,
    killSwitch,
    config: loadRiskConfig(env),
    snapshot: readSnapshot,
    assertReady,
    nowMs: () => now
  });
  const signal: Signal = {
    signalId: "signal-1",
    strategyId: "ema",
    createdAtMs: now,
    validUntilMs: now + 5000,
    intent: {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: new Decimal("0.0002"),
      limitPrice: new Decimal(83000),
      reason: "test"
    }
  };
  return {
    engine,
    repo,
    killSwitch,
    snapshot,
    signal,
    reservations,
    readSnapshot,
    assertReady,
    setNow(value: number) {
      now = value;
    }
  };
}
function lossFills(): RiskFill[] {
  const base = {
    strategyId: "ema",
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    quantity: new Decimal(1),
    fee: new Decimal(0),
    feeAsset: "USDT"
  };
  return [
    { ...base, side: "BUY", price: new Decimal(100), eventTimeMs: 1000 },
    { ...base, side: "SELL", price: new Decimal(40), eventTimeMs: 2000 }
  ];
}
describe("Phase 3.4 risk engine", () => {
  it("approves and durably reserves a valid signal", async () => {
    const f = fixture();
    await expect(f.engine.evaluate(f.signal)).resolves.toEqual({ approved: true });
    expect(f.repo.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ signalId: "signal-1", notional: "16.6" })
    );
  });
  it("blocks the kill switch before reading account state", async () => {
    const f = fixture();
    f.killSwitch.check.mockResolvedValue(true);
    await expect(f.engine.evaluate(f.signal)).resolves.toMatchObject({
      reason: "kill-switch-engaged"
    });
    expect(f.readSnapshot).not.toHaveBeenCalled();
  });
  it.each([
    ["EXECUTOR_MIN_NOTIONAL", "20", "notional-below-minimum"],
    ["EXECUTOR_MAX_NOTIONAL", "10", "notional-above-limit"],
    ["EXECUTOR_MAX_QUANTITY", "0.0001", "quantity-above-limit"],
    ["EXECUTOR_MAX_POSITION", "0.0001", "position-above-limit"],
    ["EXECUTOR_MAX_SYMBOL_EXPOSURE", "10", "symbol-exposure-above-limit"],
    ["EXECUTOR_MAX_GLOBAL_EXPOSURE", "10", "global-exposure-above-limit"]
  ])("enforces %s", async (name, value, reason) => {
    const f = fixture({ [name]: value });
    await expect(f.engine.evaluate(f.signal)).resolves.toEqual({ approved: false, reason });
    expect(f.repo.reserve).not.toHaveBeenCalled();
  });
  it("rejects prices outside the mid-price band", async () => {
    const f = fixture();
    await expect(
      f.engine.evaluate({
        ...f.signal,
        intent: { ...f.signal.intent, limitPrice: new Decimal(70000) }
      })
    ).resolves.toMatchObject({ reason: "price-sanity-deviation" });
  });
  it("uses a global open-order limit", async () => {
    const f = fixture();
    f.snapshot.openOrderCount = 1;
    await expect(f.engine.evaluate(f.signal)).resolves.toMatchObject({
      reason: "open-orders-at-limit"
    });
  });
  it("fails closed on stale state", async () => {
    const f = fixture();
    f.snapshot.observedAtMs = 1;
    await expect(f.engine.evaluate(f.signal)).resolves.toMatchObject({ approved: false });
    expect(f.killSwitch.engage).toHaveBeenCalled();
    expect(f.repo.reserve).not.toHaveBeenCalled();
  });
  it("checks market freshness independently", async () => {
    const f = fixture();
    f.snapshot.markets = new Map([["BTCUSDT", { mid: new Decimal(83000), observedAtMs: 1 }]]);
    await expect(f.engine.evaluate(f.signal)).resolves.toMatchObject({
      reason: "risk-check-error:market-data-unavailable-or-stale"
    });
  });
  it("atomically prevents simultaneous approvals crossing the order-rate limit", async () => {
    const f = fixture({ EXECUTOR_MAX_ORDERS_PER_MINUTE: "1", EXECUTOR_MAX_OPEN_ORDERS: "10" });
    const results = await Promise.all([
      f.engine.evaluate(f.signal),
      f.engine.evaluate({ ...f.signal, signalId: "signal-2" })
    ]);
    expect(results).toEqual([
      { approved: true },
      { approved: false, reason: "orders-per-minute-limit" }
    ]);
    expect(f.repo.reserve).toHaveBeenCalledOnce();
  });
  it("reserves projected position across concurrent signals", async () => {
    const f = fixture({ EXECUTOR_MAX_OPEN_ORDERS: "10", EXECUTOR_MAX_POSITION: "0.0003" });
    const results = await Promise.all([
      f.engine.evaluate(f.signal),
      f.engine.evaluate({ ...f.signal, signalId: "signal-2" })
    ]);
    expect(results[1]).toMatchObject({ reason: "position-above-limit" });
  });
  it("allows identical redelivery without consuming another slot", async () => {
    const f = fixture();
    await f.engine.evaluate(f.signal);
    await expect(f.engine.evaluate(f.signal)).resolves.toEqual({ approved: true });
    expect(f.repo.reserve).toHaveBeenCalledOnce();
  });
  it("blocks a changed signal identity", async () => {
    const f = fixture();
    await f.engine.evaluate(f.signal);
    await expect(f.engine.evaluate({ ...f.signal, strategyId: "other" })).resolves.toMatchObject({
      reason: "reservation-identity-conflict"
    });
  });
  it("trips and durably audits the global daily loss breaker", async () => {
    const f = fixture();
    f.snapshot.fills = lossFills();
    await expect(f.engine.evaluate(f.signal)).resolves.toMatchObject({
      reason: "daily-loss-global"
    });
    expect(f.repo.setKillState).toHaveBeenCalledWith(true, "daily-loss-global", "risk-breaker");
    expect(f.killSwitch.engage).toHaveBeenCalledWith("daily-loss-global");
  });
  it("enforces strategy-specific daily loss", async () => {
    const f = fixture({
      EXECUTOR_MAX_DAILY_LOSS: "100",
      EXECUTOR_STRATEGY_RISK_LIMITS: '{"ema":{"dailyLoss":"20"}}'
    });
    f.snapshot.fills = lossFills();
    await expect(f.engine.evaluate(f.signal)).resolves.toMatchObject({
      reason: "daily-loss-strategy:ema"
    });
  });
  it("trips drawdown without waiting for a signal", async () => {
    const f = fixture();
    f.snapshot.equity = new Decimal(900);
    await f.engine.monitor();
    expect(f.killSwitch.engage).toHaveBeenCalledWith("maximum-drawdown");
  });
  it("blocks expiry during snapshot retrieval", async () => {
    const f = fixture();
    f.readSnapshot.mockImplementation(async () => {
      f.setNow(105001);
      f.snapshot.observedAtMs = 105001;
      f.snapshot.markets = new Map([
        ["BTCUSDT", { mid: new Decimal(83000), observedAtMs: 105001 }]
      ]);
      return f.snapshot;
    });
    await expect(f.engine.evaluate(f.signal)).resolves.toMatchObject({ reason: "signal-expired" });
    expect(f.repo.reserve).not.toHaveBeenCalled();
  });
  it("blocks sells exceeding spot inventory", async () => {
    const f = fixture();
    await expect(
      f.engine.evaluate({ ...f.signal, intent: { ...f.signal.intent, side: "SELL" } })
    ).resolves.toMatchObject({ reason: "insufficient-position" });
  });
});
