import { describe, expect, it } from "vitest";

import { Metrics } from "../observability/metrics.js";
import { WebhookCircuitBreaker } from "./circuit-breaker.js";

const orgA = "org_00000000-0000-4000-8000-000000000001";
const orgB = "org_00000000-0000-4000-8000-000000000002";
const endpoint = "https://hooks.example.com/ramp";
const otherEndpoint = "https://hooks.example.com/other";

function fakeClock(start = "2026-11-19T00:00:00.000Z") {
  let now = new Date(start).getTime();
  return {
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    clock: () => new Date(now),
    now: () => now,
  };
}

describe("webhook delivery circuit breaker", () => {
  it("starts closed and allows delivery", () => {
    const breaker = new WebhookCircuitBreaker();
    expect(breaker.state(orgA, endpoint).state).toBe("closed");
    expect(breaker.allowDelivery(orgA, endpoint)).toBe(true);
  });

  it("rejects invalid configuration", () => {
    expect(() => new WebhookCircuitBreaker({ failureThreshold: 0 })).toThrow(
      "threshold",
    );
    expect(
      () => new WebhookCircuitBreaker({ failureThreshold: 1.5 }),
    ).toThrow("threshold");
    expect(() => new WebhookCircuitBreaker({ failureWindowMs: 0 })).toThrow(
      "window",
    );
    expect(() => new WebhookCircuitBreaker({ cooldownMs: -1 })).toThrow(
      "cooldown",
    );
  });

  it("rejects missing tenant or endpoint scope", () => {
    const breaker = new WebhookCircuitBreaker();
    expect(() => breaker.allowDelivery("", endpoint)).toThrow("organization");
    expect(() => breaker.allowDelivery(orgA, "")).toThrow("endpoint");
    expect(() => breaker.recordFailure(orgA, "")).toThrow("endpoint");
  });

  it("opens exactly at the failure threshold, not before", () => {
    const time = fakeClock();
    const breaker = new WebhookCircuitBreaker({
      clock: time.clock,
      failureThreshold: 3,
    });
    expect(breaker.recordFailure(orgA, endpoint).state).toBe("closed");
    expect(breaker.recordFailure(orgA, endpoint).state).toBe("closed");
    const opened = breaker.recordFailure(orgA, endpoint);
    expect(opened.state).toBe("open");
    expect(opened.failureCount).toBe(3);
    expect(opened.openedAt).toBe("2026-11-19T00:00:00.000Z");
    expect(breaker.allowDelivery(orgA, endpoint)).toBe(false);
  });

  it("does not count failures that fall outside the window", () => {
    const time = fakeClock();
    const breaker = new WebhookCircuitBreaker({
      clock: time.clock,
      failureThreshold: 3,
      failureWindowMs: 10_000,
    });
    breaker.recordFailure(orgA, endpoint);
    time.advance(1_000);
    breaker.recordFailure(orgA, endpoint);
    time.advance(10_000);
    // The first failure is now outside the window, so only two count.
    expect(breaker.recordFailure(orgA, endpoint).state).toBe("closed");
    expect(breaker.state(orgA, endpoint).failureCount).toBe(2);
    time.advance(1_000);
    expect(breaker.recordFailure(orgA, endpoint).state).toBe("closed");
    time.advance(1_000);
    expect(breaker.recordFailure(orgA, endpoint).state).toBe("open");
  });

  it("counts a failure exactly at the window boundary", () => {
    const time = fakeClock();
    const breaker = new WebhookCircuitBreaker({
      clock: time.clock,
      failureThreshold: 2,
      failureWindowMs: 10_000,
    });
    breaker.recordFailure(orgA, endpoint);
    time.advance(10_000);
    expect(breaker.recordFailure(orgA, endpoint).state).toBe("open");
  });

  it("blocks delivery until the cooldown elapses, then admits one probe", () => {
    const time = fakeClock();
    const breaker = new WebhookCircuitBreaker({
      clock: time.clock,
      cooldownMs: 30_000,
      failureThreshold: 1,
    });
    breaker.recordFailure(orgA, endpoint);
    time.advance(29_999);
    expect(breaker.allowDelivery(orgA, endpoint)).toBe(false);
    expect(breaker.state(orgA, endpoint).state).toBe("open");
    time.advance(1);
    expect(breaker.state(orgA, endpoint).state).toBe("half-open");
    expect(breaker.allowDelivery(orgA, endpoint)).toBe(true);
    // Only one probe is admitted while it is in flight.
    expect(breaker.allowDelivery(orgA, endpoint)).toBe(false);
    expect(breaker.allowDelivery(orgA, endpoint)).toBe(false);
  });

  it("closes the circuit when the half-open probe succeeds", () => {
    const time = fakeClock();
    const breaker = new WebhookCircuitBreaker({
      clock: time.clock,
      cooldownMs: 1_000,
      failureThreshold: 1,
    });
    breaker.recordFailure(orgA, endpoint);
    time.advance(1_000);
    expect(breaker.allowDelivery(orgA, endpoint)).toBe(true);
    const closed = breaker.recordSuccess(orgA, endpoint);
    expect(closed.state).toBe("closed");
    expect(closed.failureCount).toBe(0);
    expect(closed.openedAt).toBeNull();
    expect(breaker.allowDelivery(orgA, endpoint)).toBe(true);
  });

  it("re-opens the circuit when the half-open probe fails", () => {
    const time = fakeClock();
    const breaker = new WebhookCircuitBreaker({
      clock: time.clock,
      cooldownMs: 1_000,
      failureThreshold: 1,
    });
    breaker.recordFailure(orgA, endpoint);
    time.advance(1_000);
    expect(breaker.allowDelivery(orgA, endpoint)).toBe(true);
    const reopened = breaker.recordFailure(orgA, endpoint);
    expect(reopened.state).toBe("open");
    expect(reopened.openedAt).toBe("2026-11-19T00:00:01.000Z");
    expect(breaker.allowDelivery(orgA, endpoint)).toBe(false);
    // A fresh cooldown applies after the failed probe.
    time.advance(999);
    expect(breaker.allowDelivery(orgA, endpoint)).toBe(false);
    time.advance(1);
    expect(breaker.allowDelivery(orgA, endpoint)).toBe(true);
  });

  it("resets the failure window after a success in the closed state", () => {
    const breaker = new WebhookCircuitBreaker({ failureThreshold: 2 });
    breaker.recordFailure(orgA, endpoint);
    breaker.recordSuccess(orgA, endpoint);
    expect(breaker.state(orgA, endpoint).failureCount).toBe(0);
    expect(breaker.recordFailure(orgA, endpoint).state).toBe("closed");
  });

  it("isolates circuits per tenant for the same endpoint", () => {
    const breaker = new WebhookCircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure(orgA, endpoint);
    expect(breaker.state(orgA, endpoint).state).toBe("open");
    expect(breaker.state(orgB, endpoint).state).toBe("closed");
    expect(breaker.allowDelivery(orgB, endpoint)).toBe(true);
    expect(breaker.allowDelivery(orgA, endpoint)).toBe(false);
  });

  it("isolates circuits per endpoint within the same tenant", () => {
    const breaker = new WebhookCircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure(orgA, endpoint);
    expect(breaker.state(orgA, endpoint).state).toBe("open");
    expect(breaker.state(orgA, otherEndpoint).state).toBe("closed");
    expect(breaker.allowDelivery(orgA, otherEndpoint)).toBe(true);
  });

  it("exposes transitions, failures, and probes through metrics", () => {
    const time = fakeClock();
    const metrics = new Metrics();
    const breaker = new WebhookCircuitBreaker({
      clock: time.clock,
      cooldownMs: 1_000,
      failureThreshold: 1,
      metrics,
    });
    breaker.recordFailure(orgA, endpoint);
    expect(metrics.counter("webhook_circuit_breaker_failures_total")).toBe(1);
    expect(
      metrics.counter("webhook_circuit_breaker_transitions_total"),
    ).toBe(1);
    time.advance(1_000);
    expect(breaker.allowDelivery(orgA, endpoint)).toBe(true);
    expect(metrics.counter("webhook_circuit_breaker_probes_total")).toBe(1);
    expect(
      metrics.counter("webhook_circuit_breaker_transitions_total"),
    ).toBe(2);
    breaker.recordSuccess(orgA, endpoint);
    expect(
      metrics.counter("webhook_circuit_breaker_transitions_total"),
    ).toBe(3);
  });

  it("snapshots every tracked circuit", () => {
    const breaker = new WebhookCircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure(orgA, endpoint);
    breaker.state(orgB, otherEndpoint);
    const snapshot = breaker.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(
      snapshot.find((entry) => entry.organizationId === orgA)?.state,
    ).toBe("open");
    expect(
      snapshot.find((entry) => entry.organizationId === orgB)?.state,
    ).toBe("closed");
  });
});
