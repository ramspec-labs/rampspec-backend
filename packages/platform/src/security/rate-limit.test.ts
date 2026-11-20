import { describe, expect, it } from "vitest";
import { RateLimiter, RunQuotaManager } from "./rate-limit.js";

describe("rate limiting", () => {
  it("enforces a bounded organization and actor window", () => {
    let now = 0;
    const limiter = new RateLimiter({
      limit: 2,
      windowMs: 1000,
      clock: () => now,
    });

    expect(limiter.consume("org:user").allowed).toBe(true);
    expect(limiter.consume("org:user").remaining).toBe(0);
    expect(limiter.consume("org:user")).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });

    now = 1001;
    expect(limiter.consume("org:user").allowed).toBe(true);
  });
});

describe("run quota management", () => {
  it("enforces concurrent quota per tenant", () => {
    let now = 0;
    const manager = new RunQuotaManager({
      concurrentLimit: 2,
      windowedLimit: 10,
      windowMs: 60_000,
      clock: () => now,
    });

    expect(manager.checkConcurrent("tenant_1")).toMatchObject({
      allowed: true,
      concurrentUsage: 0,
      concurrentLimit: 2,
    });

    expect(manager.acquireConcurrent("tenant_1")).toBe(true);
    expect(manager.acquireConcurrent("tenant_1")).toBe(true);
    expect(manager.acquireConcurrent("tenant_1")).toBe(false);

    manager.releaseConcurrent("tenant_1");
    expect(manager.acquireConcurrent("tenant_1")).toBe(true);
  });

  it("enforces windowed quota per tenant with time-based expiry", () => {
    let now = 0;
    const manager = new RunQuotaManager({
      concurrentLimit: 10,
      windowedLimit: 3,
      windowMs: 1000,
      clock: () => now,
    });

    manager.recordWindowed("tenant_1");
    manager.recordWindowed("tenant_1");
    manager.recordWindowed("tenant_1");

    expect(manager.checkWindowed("tenant_1")).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });

    now = 1001;
    expect(manager.checkWindowed("tenant_1")).toMatchObject({
      allowed: true,
      concurrentUsage: 0,
    });
  });

  it("isolates quotas between tenants", () => {
    const manager = new RunQuotaManager({
      concurrentLimit: 2,
      windowedLimit: 3,
      windowMs: 60_000,
    });

    expect(manager.acquireConcurrent("tenant_1")).toBe(true);
    expect(manager.acquireConcurrent("tenant_2")).toBe(true);
    expect(manager.acquireConcurrent("tenant_1")).toBe(true);
    expect(manager.acquireConcurrent("tenant_2")).toBe(true);

    // tenant_1 at limit
    expect(manager.checkConcurrent("tenant_1")).toMatchObject({
      allowed: false,
    });
    // tenant_2 at limit
    expect(manager.checkConcurrent("tenant_2")).toMatchObject({
      allowed: false,
    });
  });
});
