import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSignedRequestBuilder } from "./signed-request.js";
import { createEd25519Signer, createHmacSigner } from "./signing.js";
import { createServerTimeClock } from "./server-time-clock.js";

describe("createSignedRequestBuilder", () => {
  const signer = createHmacSigner("test-only-secret");
  const now = () => 1_234;

  it("signs the exact returned payload with an explicit default window", () => {
    const build = createSignedRequestBuilder({ signer, now }).build;
    const parameters = { symbol: "BTCUSDT", quantity: "0.00100000", optional: undefined };
    const payload = "symbol=BTCUSDT&quantity=0.00100000&recvWindow=5000&timestamp=1234";
    expect(build(parameters)).toBe(`${payload}&signature=${signer.sign(payload)}`);
    expect(parameters).toEqual({ symbol: "BTCUSDT", quantity: "0.00100000", optional: undefined });
  });

  it("uses fresh timestamps for each build", () => {
    let timestamp = 1_234;
    const build = createSignedRequestBuilder({ signer, now: () => timestamp++ }).build;
    expect(new URLSearchParams(build({})).get("timestamp")).toBe("1234");
    expect(new URLSearchParams(build({})).get("timestamp")).toBe("1235");
  });

  it.each([1, 60_000])("allows the configured window boundary %i", (recvWindowMs) => {
    const build = createSignedRequestBuilder({ signer, now, recvWindowMs }).build;
    expect(new URLSearchParams(build({})).get("recvWindow")).toBe(String(recvWindowMs));
  });

  it.each([0, -1, 60_001, 0.5, NaN, Infinity])("rejects invalid windows %s", (recvWindowMs) => {
    expect(() => createSignedRequestBuilder({ signer, now, recvWindowMs })).toThrow("recvWindow");
  });

  it.each(["timestamp", "recvWindow", "signature"])("rejects overriding %s", (name) => {
    const build = createSignedRequestBuilder({ signer, now }).build;
    expect(() => build({ [name]: "123" })).toThrow("cannot be overridden");
    expect(() => build({ [name]: undefined })).toThrow("cannot be overridden");
  });

  it("encodes parameter separators, spaces and non-ASCII before signing", () => {
    const sign = vi.fn(() => "a+b/c=");
    const build = createSignedRequestBuilder({ signer: { sign }, now }).build;
    const result = build({ note: "a &b=+", symbol: "\uFF11\uFF12" });
    const payload = "note=a+%26b%3D%2B&symbol=%EF%BC%91%EF%BC%92&recvWindow=5000&timestamp=1234";
    expect(sign).toHaveBeenCalledWith(payload);
    expect(result).toBe(`${payload}&signature=a%2Bb%2Fc%3D`);
    expect(new URLSearchParams(result).get("signature")).toBe("a+b/c=");
  });

  it("transports a verifiable Ed25519 signature", () => {
    const keys = generateKeyPairSync("ed25519");
    const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const build = createSignedRequestBuilder({ signer: createEd25519Signer(pem), now }).build;
    const result = build({ symbol: "BTCUSDT" });
    const payload = result.slice(0, result.lastIndexOf("&signature="));
    const signature = new URLSearchParams(result).get("signature")!;
    expect(
      verify(null, Buffer.from(payload), keys.publicKey, Buffer.from(signature, "base64"))
    ).toBe(true);
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid timestamps %s without signing",
    (timestamp) => {
      const sign = vi.fn(() => "signature");
      const build = createSignedRequestBuilder({ signer: { sign }, now: () => timestamp }).build;
      expect(() => build({})).toThrow("Timestamp");
      expect(sign).not.toHaveBeenCalled();
    }
  );

  it("rejects empty parameter names", () => {
    const build = createSignedRequestBuilder({ signer, now }).build;
    expect(() => build({ "": "value" })).toThrow("nonempty names");
  });

  it("uses synchronized time and refuses builds after expiration", async () => {
    let localNow = 1_000;
    const clock = createServerTimeClock({
      nowMs: () => localNow,
      getServerTime: async () => ({ serverTime: 2_000 })
    });
    const build = createSignedRequestBuilder({ signer, now: clock.now }).build;
    expect(() => build({})).toThrow("not synchronized");
    await clock.synchronize();
    expect(new URLSearchParams(build({})).get("timestamp")).toBe("2000");
    localNow += 60_000;
    expect(() => build({})).toThrow("requires resynchronization");
  });
});
