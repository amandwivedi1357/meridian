import { Decimal } from "@meridian/core";
import type {
  BinanceSymbolInfo,
  BinanceOrderResponse,
  BinanceDepthResponse
} from "@meridian/binance-client";
import { describe, expect, it, vi } from "vitest";
import { createRiskSnapshotReader } from "./risk-snapshot.js";

function symbol(symbol: string, baseAsset: string, quoteAsset: string): BinanceSymbolInfo {
  return {
    symbol,
    baseAsset,
    quoteAsset,
    status: "TRADING",
    baseAssetPrecision: 8,
    quotePrecision: 8,
    quoteAssetPrecision: 8,
    orderTypes: ["LIMIT", "MARKET"],
    icebergAllowed: false,
    ocoAllowed: false,
    quoteOrderQtyMarketAllowed: false,
    allowTrailingStop: false,
    cancelReplaceAllowed: false,
    isSpotTradingAllowed: true,
    isMarginTradingAllowed: false,
    filters: [],
    permissions: [],
    defaultSelfTradePreventionMode: "NONE"
  };
}
function fixture() {
  const publicClient = {
    getExchangeInfo: vi.fn(async () => ({
      timezone: "UTC",
      serverTime: 100000,
      rateLimits: [],
      exchangeFilters: [],
      symbols: [symbol("BTCUSDT", "BTC", "USDT")]
    })),
    getDepth: vi.fn(async (): Promise<BinanceDepthResponse> => ({
      lastUpdateId: 1,
      bids: [["100", "1"]],
      asks: [["102", "1"]]
    }))
  };
  const tradingClient = {
    getBalances: vi.fn(async () => [
      { asset: "USDT", free: new Decimal(1000), locked: new Decimal(0) },
      { asset: "BTC", free: new Decimal(1), locked: new Decimal(0) }
    ]),
    openOrders: vi.fn(async (): Promise<BinanceOrderResponse[]> => [])
  };
  const repo = { listFills: vi.fn(async (): Promise<Record<string, unknown>[]> => []) };
  const read = createRiskSnapshotReader({
    publicClient,
    tradingClient,
    repo,
    symbols: ["BTCUSDT"],
    quoteAsset: "USDT",
    nowMs: () => 100000
  });
  return { publicClient, tradingClient, repo, read };
}
describe("runtime risk snapshot", () => {
  it("values only explicitly allocated capital, while checking real backing", async () => {
    const f = fixture();
    f.tradingClient.getBalances.mockResolvedValue([
      { asset: "USDT", free: new Decimal(1000), locked: new Decimal(0) },
      { asset: "BTC", free: new Decimal(1), locked: new Decimal(0) },
      { asset: "FAUCET", free: new Decimal(1000), locked: new Decimal(0) }
    ]);
    const assertPolicy = vi.fn(async () => {});
    const read = createRiskSnapshotReader({
      publicClient: f.publicClient,
      tradingClient: f.tradingClient,
      repo: f.repo,
      symbols: ["BTCUSDT"],
      quoteAsset: "USDT",
      nowMs: () => 100000,
      allocation: {
        policy: { id: "check", quoteAsset: "USDT", initialQuote: "100", symbols: ["BTCUSDT"] },
        assertPolicy,
        backingBaseline: async () => ({ USDT: "1000", BTC: "1" }),
        listManagedOrders: async () => []
      }
    });
    const snapshot = await read();
    expect(snapshot.equity.toFixed()).toBe("100");
    expect(snapshot.globalExposure.toFixed()).toBe("0");
    expect(snapshot.positions.get("BTCUSDT")?.toFixed()).toBe("0");
    assertPolicy.mockRejectedValueOnce(new Error("policy drift"));
    await expect(read()).rejects.toThrow("policy drift");
    await expect(f.read()).rejects.toThrow("valuation unavailable");
  });
  it("marks all holdings using exchange metadata and bid/ask midpoint", async () => {
    const f = fixture();
    const snapshot = await f.read();
    expect(snapshot.equity.toFixed()).toBe("1101");
    expect(snapshot.globalExposure.toFixed()).toBe("101");
    expect(snapshot.positions.get("BTCUSDT")?.toFixed()).toBe("1");
    expect(snapshot.markets.get("BTCUSDT")?.mid.toFixed()).toBe("101");
    expect(f.publicClient.getDepth).toHaveBeenCalledOnce();
    expect(f.tradingClient.openOrders).toHaveBeenCalledWith();
  });
  it("does not silently ignore unpriceable assets", async () => {
    const f = fixture();
    f.tradingClient.getBalances.mockResolvedValue([
      { asset: "MISSING", free: new Decimal(1), locked: new Decimal(0) }
    ]);
    await expect(f.read()).rejects.toThrow("valuation unavailable");
  });
  it("blocks missing base-asset balances and crossed books", async () => {
    const f = fixture();
    f.tradingClient.getBalances.mockResolvedValueOnce([
      { asset: "USDT", free: new Decimal(100), locked: new Decimal(0) }
    ]);
    await expect(f.read()).rejects.toThrow("Position balance unavailable");
    f.publicClient.getDepth.mockResolvedValue({
      lastUpdateId: 1,
      bids: [["102", "1"]],
      asks: [["100", "1"]]
    });
    await expect(f.read()).rejects.toThrow("Invalid market book");
  });
  it("includes remaining open BUY exposure but never treats it as filled sellable inventory", async () => {
    const f = fixture();
    f.tradingClient.openOrders.mockResolvedValue([
      {
        symbol: "BTCUSDT",
        orderId: 1,
        orderListId: -1,
        clientOrderId: "pending",
        price: "100",
        origQty: "1",
        executedQty: "0.2",
        cummulativeQuoteQty: "20",
        status: "PARTIALLY_FILLED",
        timeInForce: "GTC",
        type: "LIMIT",
        side: "BUY"
      }
    ]);
    const snapshot = await f.read();
    expect(snapshot.pendingBuys?.get("BTCUSDT")?.toFixed()).toBe("0.8");
    expect(snapshot.positions.get("BTCUSDT")?.toFixed()).toBe("1");
    expect(snapshot.globalExposure.toFixed()).toBe("182.6");
  });
  it("refuses invented historical third-asset fee conversion", async () => {
    const f = fixture();
    f.repo.listFills.mockResolvedValue([
      {
        symbol: "BTCUSDT",
        strategy_id: "ema",
        fee_asset: "BNB",
        side: "BUY",
        quantity: "0.1",
        price: "100",
        fee: "0.01",
        event_time_ms: "1000"
      }
    ]);
    await expect(f.read()).rejects.toThrow("Historical fee valuation unavailable");
  });
});
