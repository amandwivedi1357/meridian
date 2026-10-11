import { Registry } from "@meridian/observability";
import { afterEach, expect, it, vi } from "vitest";
import { instrumentPortfolio } from "./portfolio-metrics.js";
import type { PortfolioSnapshot } from "../account/portfolio.js";

afterEach(() => vi.useRealTimers());
it("keeps known realized PnL, excludes unknown unrealized values and never exports wallet equity as allocated PnL", async () => {
  const registry = new Registry();
  const snapshot: PortfolioSnapshot = {
    checkedAt: Date.now(),
    scope: "persisted-fills",
    accounting: "weighted-average",
    environment: "testnet",
    equity: "999999",
    equityReason: null,
    status: "unavailable",
    positions: [],
    totals: [{ quoteAsset: "USDT", realizedPnl: "0", unrealizedPnl: null, marketValue: null }]
  };
  const source = vi.fn(async () => snapshot);
  const read = instrumentPortfolio(source, registry);
  expect(await read()).toBe(snapshot);
  let metrics = await registry.metrics();
  expect(metrics).toContain(
    'pnl_realized{quote_asset="USDT",environment="testnet",scope="persisted-fills"} 0'
  );
  expect(metrics).not.toContain("pnl_unrealized{");
  expect(metrics).not.toContain("999999");
  snapshot.totals[0]!.realizedPnl = "1";
  snapshot.totals[0]!.unrealizedPnl = "-2";
  await read();
  expect(await registry.metrics()).toContain(
    'pnl_unrealized{quote_asset="USDT",environment="testnet",scope="persisted-fills"} -2'
  );
  vi.useFakeTimers();
  vi.setSystemTime(snapshot.checkedAt + 16000);
  await read();
  metrics = await registry.metrics();
  expect(metrics).not.toMatch(
    /pnl_realized\{|pnl_unrealized\{|meridian_portfolio_sample_timestamp_seconds \d/
  );
  snapshot.checkedAt = Date.now();
  snapshot.totals[0]!.realizedPnl = "9".repeat(400);
  await read();
  expect(await registry.metrics()).not.toContain("pnl_realized{");
  source.mockRejectedValueOnce(new Error("private-error"));
  await expect(read()).rejects.toThrow();
  expect(await registry.metrics()).not.toContain("pnl_unrealized{");
});
