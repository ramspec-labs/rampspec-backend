export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export interface QuotaDecision {
  readonly allowed: boolean;
  readonly concurrentUsage: number;
  readonly concurrentLimit: number;
  readonly retryAfterSeconds: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: () => number;

  constructor(options: {
    readonly limit: number;
    readonly windowMs: number;
    readonly clock?: () => number;
  }) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.clock = options.clock ?? Date.now;
  }

  consume(key: string): RateLimitDecision {
    const now = this.clock();
    const active = (this.windows.get(key) ?? []).filter(
      (timestamp) => timestamp > now - this.windowMs,
    );

    if (active.length >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((active[0]! + this.windowMs - now) / 1000),
        ),
      };
    }

    active.push(now);
    this.windows.set(key, active);

    return {
      allowed: true,
      remaining: this.limit - active.length,
      retryAfterSeconds: 0,
    };
  }
}

export class RunQuotaManager {
  private readonly concurrentRuns = new Map<string, number>();
  private readonly windowedRuns = new Map<string, number[]>();
  private readonly concurrentLimit: number;
  private readonly windowedLimit: number;
  private readonly windowMs: number;
  private readonly clock: () => number;

  constructor(options: {
    readonly concurrentLimit: number;
    readonly windowedLimit: number;
    readonly windowMs: number;
    readonly clock?: () => number;
  }) {
    this.concurrentLimit = options.concurrentLimit;
    this.windowedLimit = options.windowedLimit;
    this.windowMs = options.windowMs;
    this.clock = options.clock ?? Date.now;
  }

  checkConcurrent(tenantId: string): QuotaDecision {
    const current = this.concurrentRuns.get(tenantId) ?? 0;

    if (current >= this.concurrentLimit) {
      return {
        allowed: false,
        concurrentUsage: current,
        concurrentLimit: this.concurrentLimit,
        retryAfterSeconds: 1,
      };
    }

    return {
      allowed: true,
      concurrentUsage: current,
      concurrentLimit: this.concurrentLimit,
      retryAfterSeconds: 0,
    };
  }

  checkWindowed(tenantId: string): QuotaDecision {
    const now = this.clock();
    const key = `windowed:${tenantId}`;
    const active = (this.windowedRuns.get(key) ?? []).filter(
      (timestamp) => timestamp > now - this.windowMs,
    );

    if (active.length >= this.windowedLimit) {
      return {
        allowed: false,
        concurrentUsage: active.length,
        concurrentLimit: this.windowedLimit,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((active[0]! + this.windowMs - now) / 1000),
        ),
      };
    }

    return {
      allowed: true,
      concurrentUsage: active.length,
      concurrentLimit: this.windowedLimit,
      retryAfterSeconds: 0,
    };
  }

  acquireConcurrent(tenantId: string): boolean {
    const decision = this.checkConcurrent(tenantId);
    if (!decision.allowed) return false;

    this.concurrentRuns.set(tenantId, (this.concurrentRuns.get(tenantId) ?? 0) + 1);
    return true;
  }

  recordWindowed(tenantId: string): void {
    const now = this.clock();
    const key = `windowed:${tenantId}`;
    const active = (this.windowedRuns.get(key) ?? []).filter(
      (timestamp) => timestamp > now - this.windowMs,
    );
    active.push(now);
    this.windowedRuns.set(key, active);
  }

  releaseConcurrent(tenantId: string): void {
    const current = this.concurrentRuns.get(tenantId) ?? 0;
    if (current > 0) {
      this.concurrentRuns.set(tenantId, current - 1);
    }
  }
}
