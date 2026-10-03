export interface TokenBucketRateLimiterOptions {
  readonly capacity: number;
  readonly refillIntervalMs: number;
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillMs: number;

  constructor(private readonly options: TokenBucketRateLimiterOptions) {
    this.tokens = options.capacity;
    this.lastRefillMs = Date.now();
  }

  async acquire(weight = 1): Promise<void> {
    if (weight > this.options.capacity) {
      throw new Error(`Request weight ${weight} exceeds bucket capacity ${this.options.capacity}`);
    }

    while (true) {
      this.refill();
      if (this.tokens >= weight) {
        this.tokens -= weight;
        return;
      }

      const missingTokens = weight - this.tokens;
      const waitMs = Math.ceil(
        (missingTokens / this.options.capacity) * this.options.refillIntervalMs
      );

      await sleep(Math.max(waitMs, 1));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillMs;

    if (elapsedMs <= 0) {
      return;
    }

    const refillTokens = (elapsedMs / this.options.refillIntervalMs) * this.options.capacity;

    this.tokens = Math.min(this.options.capacity, this.tokens + refillTokens);
    this.lastRefillMs = now;
  }
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
