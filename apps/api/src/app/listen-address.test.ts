import { describe, expect, it } from "vitest";
import { apiListenAddress } from "./listen-address.js";

describe("API listen address", () => {
  it("keeps local startup loopback-only", () => {
    expect(apiListenAddress({})).toEqual({ host: "127.0.0.1", port: 3000 });
  });
  it("allows explicit container and IPv6 addresses", () => {
    expect(apiListenAddress({ API_HOST: "0.0.0.0", API_PORT: "8080" })).toEqual({
      host: "0.0.0.0",
      port: 8080
    });
    expect(apiListenAddress({ API_HOST: "::1" }).host).toBe("::1");
  });
  it.each(["0", "65536", "1.5", "", "oops"])("rejects invalid port %s", (API_PORT) => {
    expect(() => apiListenAddress({ API_PORT })).toThrow("API_PORT");
  });
  it("rejects an invalid host", () => {
    expect(() => apiListenAddress({ API_HOST: "invalid" })).toThrow("API_HOST");
  });
});
