export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetEpochSeconds: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimitHeaders {
  readonly "RateLimit-Limit": string;
  readonly "RateLimit-Remaining": string;
  readonly "RateLimit-Reset": string;
  readonly "Retry-After"?: string;
  readonly "X-RateLimit-Limit": string;
  readonly "X-RateLimit-Remaining": string;
  readonly "X-RateLimit-Reset": string;
}

export function formatRateLimitHeaders(
  decision: RateLimitDecision,
): RateLimitHeaders {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": String(decision.resetEpochSeconds),
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": String(decision.resetEpochSeconds),
  };
  if (!decision.allowed && decision.retryAfterSeconds > 0) {
    headers["Retry-After"] = String(decision.retryAfterSeconds);
  }
  return headers as unknown as RateLimitHeaders;
}

export class RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: () => number;

  public constructor(options: {
    readonly limit: number;
    readonly windowMs: number;
    readonly clock?: () => number;
  }) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.clock = options.clock ?? Date.now;
  }

  public consume(key: string): RateLimitDecision {
    const now = this.clock();
    const active = (this.windows.get(key) ?? []).filter(
      (timestamp) => timestamp > now - this.windowMs,
    );

    if (active.length >= this.limit) {
      const oldest = active[0]!;
      const resetMs = oldest + this.windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((resetMs - now) / 1000));
      const resetEpochSeconds = Math.ceil(resetMs / 1000);
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        resetEpochSeconds,
        retryAfterSeconds,
      };
    }

    active.push(now);
    this.windows.set(key, active);
    const oldest = active[0]!;
    const resetEpochSeconds = Math.ceil((oldest + this.windowMs) / 1000);
    return {
      allowed: true,
      limit: this.limit,
      remaining: this.limit - active.length,
      resetEpochSeconds,
      retryAfterSeconds: 0,
    };
  }
}
