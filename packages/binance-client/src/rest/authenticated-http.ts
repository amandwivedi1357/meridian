import { BINANCE_REST_BASE_URLS, type BinanceEnvironment } from "../constants.js";
import { createSignedRequestBuilder } from "./signed-request.js";
import type { RequestSigner } from "./signing.js";

export interface AuthenticatedHttpOptions {
  readonly apiKey: string;
  readonly signer: RequestSigner;
  readonly now: () => number;
  readonly environment?: BinanceEnvironment;
  readonly recvWindowMs?: number;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export interface AuthenticatedHttpRequest {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly parameters?: Readonly<Record<string, string | undefined>>;
}

export class BinanceSignedRequestError extends Error {
  constructor(
    readonly outcome: "rejected" | "unknown",
    readonly status: number | undefined = undefined,
    readonly code: number | undefined = undefined,
    readonly retryAfter: string | undefined = undefined
  ) {
    super(
      outcome === "unknown"
        ? "Binance request outcome is unknown; reconcile before retrying"
        : "Binance rejected the signed request"
    );
    this.name = "BinanceSignedRequestError";
  }
}

export function createAuthenticatedHttp(options: AuthenticatedHttpOptions) {
  const environment = options.environment ?? "testnet";
  if (environment !== "testnet") {
    throw new Error("Authenticated transport supports Testnet only");
  }
  const baseUrl = new URL(BINANCE_REST_BASE_URLS.testnet);
  if (baseUrl.href !== "https://testnet.binance.vision/") {
    throw new Error("Authenticated transport requires the Binance Testnet origin");
  }
  const { apiKey } = options;
  if (apiKey.trim() === "" || /[^\x21-\x7e]/.test(apiKey)) {
    throw new Error("API key must be a nonempty printable ASCII token");
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new Error("Request timeout must be a positive timer-safe integer");
  }
  const fetchRequest = options.fetch ?? globalThis.fetch;
  const builder = createSignedRequestBuilder(options);

  return {
    async request<TResponse>(request: AuthenticatedHttpRequest): Promise<TResponse> {
      if (!["GET", "POST", "DELETE"].includes(request.method)) {
        throw new Error("Unsupported authenticated HTTP method");
      }
      if (!/^\/api\/v3\/[A-Za-z0-9]+(?:\/[A-Za-z0-9]+)*$/.test(request.path)) {
        throw new Error("Authenticated request requires a plain /api/v3/ endpoint path");
      }
      const signedParameters = builder.build(request.parameters ?? {});
      const url = new URL(request.path, baseUrl);
      const headers = new Headers({ "X-MBX-APIKEY": apiKey });
      let body: string | undefined;
      if (request.method === "POST") {
        headers.set("Content-Type", "application/x-www-form-urlencoded");
        body = signedParameters;
      } else {
        url.search = signedParameters;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // Signed operations are deliberately single-attempt, including HTTP errors.
        const response = await fetchRequest(url, {
          method: request.method,
          headers,
          ...(body === undefined ? {} : { body }),
          redirect: "error",
          signal: controller.signal
        });
        const text = await response.text();
        let decoded: unknown;
        try {
          decoded = JSON.parse(text);
        } catch {
          throw new BinanceSignedRequestError("unknown", response.status);
        }
        const code = readErrorCode(decoded);
        if (!response.ok || (code !== undefined && code < 0)) {
          const ambiguous =
            response.status >= 500 ||
            response.status < 400 ||
            response.status === 408 ||
            response.status === 409 ||
            code === -1006 ||
            code === -1007;
          throw new BinanceSignedRequestError(
            ambiguous ? "unknown" : "rejected",
            response.status,
            code,
            response.headers.get("Retry-After") ?? undefined
          );
        }
        return decoded as TResponse;
      } catch (error) {
        if (error instanceof BinanceSignedRequestError) throw error;
        // Do not retain fetch errors: they may contain signed URLs or credentials.
        throw new BinanceSignedRequestError("unknown");
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function readErrorCode(value: unknown): number | undefined {
  if (value === null || typeof value !== "object" || !("code" in value)) return undefined;
  return typeof value.code === "number" && Number.isSafeInteger(value.code)
    ? value.code
    : undefined;
}
