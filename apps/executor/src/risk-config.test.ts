import { describe, expect, it } from "vitest";
import { loadRiskConfig } from "./risk-config.js";
import { authorizeRiskControl } from "./risk-control-cli.js";

describe("risk configuration and control authentication", () => {
  it("supports per-symbol and per-strategy overrides", () => {
    const config = loadRiskConfig({
      EXECUTOR_SYMBOL_RISK_LIMITS: '{"ETHUSDT":{"maxQuantity":"0.1","maxPosition":"1"}}',
      EXECUTOR_STRATEGY_RISK_LIMITS: '{"ema":{"ordersPerMinute":2,"dailyLoss":"10"}}'
    });
    expect(config.symbol("ETHUSDT").maxQuantity.toFixed()).toBe("0.1");
    expect(config.symbol("BTCUSDT").maxQuantity.toFixed()).toBe("0.0002");
    expect(config.strategy("ema").ordersPerMinute).toBe(2);
    expect(config.strategy("ema").dailyLoss.toFixed()).toBe("10");
  });
  it.each([
    { EXECUTOR_MAX_DRAWDOWN: "1.1" },
    { EXECUTOR_MAX_ORDERS_PER_MINUTE: "0" },
    { EXECUTOR_MAX_POSITION: "NaN" },
    { EXECUTOR_SYMBOL_RISK_LIMITS: '{"BTCUSDT":{"unknown":"1"}}' },
    { EXECUTOR_STRATEGY_RISK_LIMITS: "[]" },
    { EXECUTOR_MIN_NOTIONAL: "100", EXECUTOR_MAX_NOTIONAL: "10" }
  ])("rejects invalid configuration", (env) => {
    expect(() => loadRiskConfig(env)).toThrow();
  });
  it("rejects missing, short and incorrect control credentials", () => {
    expect(() => authorizeRiskControl({})).toThrow("authentication failed");
    expect(() =>
      authorizeRiskControl({
        MERIDIAN_RISK_ADMIN_TOKEN: "short",
        MERIDIAN_RISK_CONTROL_TOKEN: "short"
      })
    ).toThrow();
    expect(() =>
      authorizeRiskControl({
        MERIDIAN_RISK_ADMIN_TOKEN: "a".repeat(32),
        MERIDIAN_RISK_CONTROL_TOKEN: "b".repeat(32)
      })
    ).toThrow();
    expect(() =>
      authorizeRiskControl({
        MERIDIAN_RISK_ADMIN_TOKEN: "a".repeat(32),
        MERIDIAN_RISK_CONTROL_TOKEN: "a".repeat(32)
      })
    ).not.toThrow();
  });
});
