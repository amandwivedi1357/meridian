export interface RetryOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly shouldRetry?: (error: unknown) => boolean;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < options.maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      attempt += 1;

      if (attempt >= options.maxAttempts || !shouldRetry(error, options)) {
        throw error;
      }

      const delayMs = calculateBackoffDelayMs({
        attempt,
        baseDelayMs: options.baseDelayMs,
        maxDelayMs: options.maxDelayMs
      });

      await sleep(delayMs);
    }
  }

  throw lastError;
}

function shouldRetry(error: unknown, options: RetryOptions): boolean {
  return options.shouldRetry ? options.shouldRetry(error) : true;
}

export interface BackoffDelayOptions {
  readonly attempt: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export function calculateBackoffDelayMs({
  attempt,
  baseDelayMs,
  maxDelayMs
}: BackoffDelayOptions): number {
  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(attempt - 1, 0));
  const jitter = Math.random() * exponentialDelay;

  return Math.ceil(jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
