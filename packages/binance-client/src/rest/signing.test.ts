import { describe, expect, it } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { createEd25519Signer, createHmacSigner } from "./signing.js";

// Public illustrative key and vectors from Binance's REST API documentation.
const exampleSecret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
const suffix =
  "&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";

describe("createHmacSigner", () => {
  it.each([
    {
      symbol: "LTCBTC",
      signature: "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71"
    },
    {
      symbol: "%EF%BC%91%EF%BC%92%EF%BC%93%EF%BC%94%EF%BC%95%EF%BC%96",
      signature: "e1353ec6b14d888f1164ae9af8228a3dbd508bc82eb867db8ab6046442f33ef3"
    }
  ])("matches Binance's published vector for $symbol", ({ symbol, signature }) => {
    expect(createHmacSigner(exampleSecret).sign(`symbol=${symbol}${suffix}`)).toBe(signature);
  });

  it.each(["", " ", "\t\r\n"])("rejects a blank secret %j", (secret) => {
    expect(() => createHmacSigner(secret)).toThrow("HMAC secret is required");
  });

  it("produces deterministic lowercase hexadecimal output", () => {
    const signer = createHmacSigner("test-only-secret");
    expect(signer.sign("timestamp=123")).toMatch(/^[a-f0-9]{64}$/);
    expect(signer.sign("timestamp=123")).toBe(signer.sign("timestamp=123"));
  });

  it("signs exact payload bytes without trimming or reordering", () => {
    const signer = createHmacSigner("test-only-secret");
    const payload = "symbol=BTCUSDT&timestamp=123";
    expect(signer.sign(payload)).not.toBe(signer.sign(`${payload}\n`));
    expect(signer.sign(payload)).not.toBe(signer.sign("timestamp=123&symbol=BTCUSDT"));
    expect(signer.sign(payload)).not.toBe(signer.sign(payload.toLowerCase()));
  });

  it("preserves nonblank secret whitespace and case", () => {
    const payload = "timestamp=123";
    expect(createHmacSigner(" test-secret ").sign(payload)).not.toBe(
      createHmacSigner("test-secret").sign(payload)
    );
    expect(createHmacSigner("TEST-SECRET").sign(payload)).not.toBe(
      createHmacSigner("test-secret").sign(payload)
    );
  });
});

describe("createEd25519Signer", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const payload = "symbol=BTCUSDT&timestamp=123";

  it("returns a base64 signature verifiable by the public key", () => {
    const signature = createEd25519Signer(privateKeyPem).sign(payload);
    const bytes = Buffer.from(signature, "base64");
    expect(bytes.length).toBe(64);
    expect(bytes.toString("base64")).toBe(signature);
    expect(verify(null, Buffer.from(payload, "utf8"), publicKey, bytes)).toBe(true);
  });

  it("produces identical signatures for identical inputs", () => {
    const signer = createEd25519Signer(privateKeyPem);
    expect(signer.sign(payload)).toBe(signer.sign(payload));
    expect(signer.sign(payload)).toBe(createEd25519Signer(privateKeyPem).sign(payload));
  });

  it("preserves exact payload bytes", () => {
    const signer = createEd25519Signer(privateKeyPem);
    const bytes = Buffer.from(signer.sign(payload), "base64");
    for (const altered of [`${payload}\n`, payload.toLowerCase(), "timestamp=123&symbol=BTCUSDT"]) {
      expect(verify(null, Buffer.from(altered, "utf8"), publicKey, bytes)).toBe(false);
    }
  });

  it("does not verify under an unrelated public key", () => {
    const other = generateKeyPairSync("ed25519");
    const signature = createEd25519Signer(privateKeyPem).sign(payload);
    expect(
      verify(null, Buffer.from(payload), other.publicKey, Buffer.from(signature, "base64"))
    ).toBe(false);
  });

  it.each(["", " ", "\t\r\n"])("rejects a blank private key %j", (pem) => {
    expect(() => createEd25519Signer(pem)).toThrow("Ed25519 private key is required");
  });

  it("rejects malformed PEM without exposing key material in errors", () => {
    expect(() => createEd25519Signer("not-a-private-key")).toThrow(
      "Invalid Ed25519 private key PEM"
    );
  });

  it("rejects a different asymmetric key type", () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pem = other.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => createEd25519Signer(pem)).toThrow("Private key must use Ed25519");
  });

  it("rejects public-key PEM", () => {
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => createEd25519Signer(pem)).toThrow("Invalid Ed25519 private key PEM");
  });
});
