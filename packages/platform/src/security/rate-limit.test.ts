import { describe, expect, it } from "vitest";

import { formatRateLimitHeaders, RateLimiter } from "./rate-limit.js";

describe("rate limiting", () => {
  it("enforces a bounded organization and actor window", () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({
      clock: () => now,
      limit: 2,
      windowMs: 1000,
    });

    const first = limiter.consume("org:user");
    expect(first.allowed).toBe(true);
    expect(first.limit).toBe(2);
    expect(first.remaining).toBe(1);
    expect(first.retryAfterSeconds).toBe(0);

    const second = limiter.consume("org:user");
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);

    const blocked = limiter.consume("org:user");
    expect(blocked).toMatchObject({
      allowed: false,
      limit: 2,
      remaining: 0,
      retryAfterSeconds: 1,
    });

    now = 1_001_001;
    expect(limiter.consume("org:user").allowed).toBe(true);
  });

  it("formats standard and vendor rate limit headers", () => {
    const now = 10_000;
    const limiter = new RateLimiter({
      clock: () => now,
      limit: 5,
      windowMs: 2000,
    });

    const allowed = limiter.consume("tenant_a");
    const allowedHeaders = formatRateLimitHeaders(allowed);
    expect(allowedHeaders["RateLimit-Limit"]).toBe("5");
    expect(allowedHeaders["RateLimit-Remaining"]).toBe("4");
    expect(allowedHeaders["RateLimit-Reset"]).toBe("12");
    expect(allowedHeaders["X-RateLimit-Limit"]).toBe("5");
    expect(allowedHeaders["X-RateLimit-Remaining"]).toBe("4");
    expect(allowedHeaders["X-RateLimit-Reset"]).toBe("12");
    expect(allowedHeaders["Retry-After"]).toBeUndefined();

    // Consume until exhausted
    limiter.consume("tenant_a");
    limiter.consume("tenant_a");
    limiter.consume("tenant_a");
    limiter.consume("tenant_a");
    const blocked = limiter.consume("tenant_a");
    expect(blocked.allowed).toBe(false);

    const blockedHeaders = formatRateLimitHeaders(blocked);
    expect(blockedHeaders["RateLimit-Remaining"]).toBe("0");
    expect(blockedHeaders["Retry-After"]).toBe("2");
    expect(blockedHeaders["X-RateLimit-Remaining"]).toBe("0");
  });

  it("maintains strict tenant isolation across rate limit keys", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 5000 });
    const tenant1 = limiter.consume("org_1");
    const tenant2 = limiter.consume("org_2");
    expect(tenant1.allowed).toBe(true);
    expect(tenant2.allowed).toBe(true);
    expect(limiter.consume("org_1").allowed).toBe(false);
    expect(limiter.consume("org_2").allowed).toBe(false);
  });
});
