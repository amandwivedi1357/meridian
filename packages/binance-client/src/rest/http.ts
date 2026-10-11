import { withRetry } from "./retry.js";

export class BinanceHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
    this.name = "BinanceHttpError";
  }
}

export interface HttpGetOptions {
  readonly baseUrl: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch | undefined;
}

export async function httpGetJson<TResponse>({
  baseUrl,
  path,
  query,
  timeoutMs,
  fetch: fetchRequest = globalThis.fetch
}: HttpGetOptions): Promise<TResponse> {
  return withRetry(
    async () => {
      const url = new URL(path, baseUrl);

      for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }

      const response = await fetchRequest(
        url,
        timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined
      );

      if (!response.ok) {
        const body = await response.text();
        throw new BinanceHttpError(
          `Binance request failed: ${response.status}`,
          response.status,
          body
        );
      }

      return (await response.json()) as TResponse;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 5_000,
      shouldRetry: (error) =>
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
          ? false
          : error instanceof BinanceHttpError
            ? isRetryableHttpStatus(error.status)
            : true
    }
  );
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 418 || status >= 500;
}
