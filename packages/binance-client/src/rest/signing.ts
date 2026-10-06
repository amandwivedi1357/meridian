import { createHmac, createPrivateKey, sign as signPayload } from "node:crypto";

export interface RequestSigner {
  readonly sign: (payload: string) => string;
}

export function createHmacSigner(secret: string): RequestSigner {
  if (secret.trim() === "") {
    throw new Error("HMAC secret is required");
  }

  return {
    sign(payload) {
      return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
    }
  };
}

export function createEd25519Signer(privateKeyPem: string): RequestSigner {
  if (privateKeyPem.trim() === "") {
    throw new Error("Ed25519 private key is required");
  }

  const key = parseEd25519PrivateKey(privateKeyPem);
  return {
    sign(payload) {
      return signPayload(null, Buffer.from(payload, "utf8"), key).toString("base64");
    }
  };
}

function parseEd25519PrivateKey(privateKeyPem: string) {
  let key;
  try {
    key = createPrivateKey(privateKeyPem);
  } catch {
    throw new Error("Invalid Ed25519 private key PEM");
  }

  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("Private key must use Ed25519");
  }
  return key;
}
