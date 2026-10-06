import type { RequestSigner } from "./signing.js";

export interface SignedRequestBuilderOptions {
  readonly signer: RequestSigner;
  readonly now: () => number;
  readonly recvWindowMs?: number;
}

export function createSignedRequestBuilder(options: SignedRequestBuilderOptions) {
  const { signer, now } = options;
  const recvWindowMs = options.recvWindowMs ?? 5_000;
  if (!Number.isSafeInteger(recvWindowMs) || recvWindowMs <= 0 || recvWindowMs > 60_000) {
    throw new Error("recvWindow must be an integer from 1 to 60000 milliseconds");
  }

  return {
    build(parameters: Readonly<Record<string, string | undefined>>): string {
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(parameters)) {
        if (["timestamp", "recvWindow", "signature"].includes(name)) {
          throw new Error("Signing parameters cannot be overridden");
        }
        if (value !== undefined) {
          if (name === "" || typeof value !== "string") {
            throw new Error("Request parameters must have nonempty names and string values");
          }
          query.set(name, value);
        }
      }

      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        throw new Error("Timestamp must be a nonnegative safe integer");
      }
      query.set("recvWindow", String(recvWindowMs));
      query.set("timestamp", String(timestamp));
      const payload = query.toString();
      // Append the signature without re-encoding or changing the signed payload.
      const signature = new URLSearchParams({ signature: signer.sign(payload) });
      return `${payload}&${signature.toString()}`;
    }
  };
}
