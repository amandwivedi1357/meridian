import { describe, expect, it } from "vitest";
import depthFixture from "../../fixtures/depth-btcusdt.json" with { type: "json" };
import klinesFixture from "../../fixtures/klines-btcusdt-1m.json" with { type: "json" };
import serverTimeFixture from "../../fixtures/server-time.json" with { type: "json" };
import { parseDepthResponse, parseKlineResponse } from "./parsers.js";
import type {
  BinanceDepthResponse,
  BinanceKlinesResponse,
  BinanceServerTimeResponse
} from "./types.js";

describe("binance response fixtures", () => {
  it("matches the server time response contract", () => {
    const fixture = serverTimeFixture as unknown as BinanceServerTimeResponse;

    expect(typeof fixture.serverTime).toBe("number");
  });

  it("matches the depth response contract and parses decimals safely", () => {
    const fixture = depthFixture as unknown as BinanceDepthResponse;
    const parsed = parseDepthResponse("BTCUSDT", fixture, 123);

    expect(fixture.bids[0]?.[0]).toBe("83981.87000000");
    expect(parsed.bids[0]?.price.toString()).toBe("83981.87");
  });

  it("matches the klines response contract and parses decimals safely", () => {
    const fixture = klinesFixture as unknown as BinanceKlinesResponse;
    const parsed = parseKlineResponse("BTCUSDT", "1m", fixture[0]!);

    expect(fixture[0]?.[1]).toBe("83981.88000000");
    expect(parsed.open.toString()).toBe("83981.88");
  });
});
