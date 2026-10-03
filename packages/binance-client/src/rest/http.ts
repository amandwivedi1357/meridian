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
}

export async function httpGetJson<TResponse>({
  baseUrl,
  path,
  query
}: HttpGetOptions): Promise<TResponse> {
  return withRetry(
    async () => {
      const url = new URL(path, baseUrl);

      for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }

      const response = await fetch(url);

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
        error instanceof BinanceHttpError ? isRetryableHttpStatus(error.status) : true
    }
  );
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 418 || status >= 500;
}