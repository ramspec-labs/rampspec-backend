import { describe, expect, it, vi } from "vitest";

import { webhookRetryDelay } from "../webhooks/retry.js";
import { WebhookCircuitBreaker } from "./circuit-breaker.js";
import { DeliveryService } from "./service.js";
import { deliverWebhook } from "./webhook.js";

const reportId = "report_00000000-0000-4000-8000-000000000001";
const orgA = "org_00000000-0000-4000-8000-000000000001";
const orgB = "org_00000000-0000-4000-8000-000000000002";
const endpoint = "https://hooks.example.com/ramp";
const secret = new TextEncoder().encode("secret");

function fakeClock(start = "2026-11-19T00:00:00.000Z") {
  let now = new Date(start).getTime();
  return {
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    clock: () => new Date(now),
  };
}

describe("delivery records", () => {
  it("creates immutable hashed deliveries and tracks retries", () => {
    const service = new DeliveryService();
    const delivery = service.create(reportId, "webhook", { ok: true });
    expect(delivery.payloadHash).toHaveLength(64);
    expect(service.update(delivery.id, "failed").retryCount).toBe(1);
    expect(service.update(delivery.id, "delivered").state).toBe("delivered");
    expect(() => service.update(delivery.id, "failed")).toThrow("terminal");
  });

  it("allows every delivery without a circuit breaker", () => {
    const service = new DeliveryService();
    expect(service.canDeliver(orgA, endpoint)).toBe(true);
    const delivery = service.create(reportId, "webhook", { ok: true });
    const outcome = service.recordDeliveryOutcome(
      delivery.id,
      orgA,
      endpoint,
      "failed",
    );
    expect(outcome.circuit).toBeNull();
    expect(outcome.delivery.retryCount).toBe(1);
    expect(service.circuitState(orgA, endpoint)).toBeNull();
  });
});

describe("delivery circuit breaker integration", () => {
  it("pauses a failing endpoint and resumes after a successful probe", async () => {
    const time = fakeClock();
    const breaker = new WebhookCircuitBreaker({
      clock: time.clock,
      cooldownMs: 5_000,
      failureThreshold: 3,
      failureWindowMs: 60_000,
    });
    const service = new DeliveryService({
      circuitBreaker: breaker,
      clock: time.clock,
    });
    const failingFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const succeedingFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));

    // Three consecutive failures trip the breaker.
    for (const attempt of [1, 2, 3]) {
      expect(service.canDeliver(orgA, endpoint)).toBe(true);
      const delivery = service.create(reportId, "webhook", { attempt });
      const result = await deliverWebhook(endpoint, "{}", secret, {
        fetcher: failingFetch,
      });
      expect(result.delivered).toBe(false);
      expect(result.retryable).toBe(true);
      const outcome = service.recordDeliveryOutcome(
        delivery.id,
        orgA,
        endpoint,
        "failed",
      );
      expect(outcome.delivery.retryCount).toBe(1);
      expect(webhookRetryDelay(outcome.delivery.retryCount)).toBe(2_000);
      if (attempt < 3) {
        expect(outcome.circuit?.state).toBe("closed");
      } else {
        expect(outcome.circuit?.state).toBe("open");
      }
    }

    // The open circuit pauses delivery; the queued delivery is never dropped.
    const queued = service.create(reportId, "webhook", { queued: true });
    expect(service.canDeliver(orgA, endpoint)).toBe(false);
    expect(service.get(queued.id)?.state).toBe("pending");
    expect(service.get(queued.id)?.retryCount).toBe(0);

    // After the cooldown a single probe is admitted and closes the circuit.
    time.advance(5_000);
    expect(service.canDeliver(orgA, endpoint)).toBe(true);
    const probe = await deliverWebhook(endpoint, "{}", secret, {
      fetcher: succeedingFetch,
    });
    expect(probe.delivered).toBe(true);
    const resumed = service.recordDeliveryOutcome(
      queued.id,
      orgA,
      endpoint,
      "delivered",
    );
    expect(resumed.circuit?.state).toBe("closed");
    expect(resumed.delivery.state).toBe("delivered");
    expect(service.canDeliver(orgA, endpoint)).toBe(true);
  });

  it("keeps one tenant's open circuit from pausing another tenant", () => {
    const breaker = new WebhookCircuitBreaker({ failureThreshold: 1 });
    const service = new DeliveryService({ circuitBreaker: breaker });
    const delivery = service.create(reportId, "webhook", { ok: true });
    service.recordDeliveryOutcome(delivery.id, orgA, endpoint, "failed");
    expect(service.circuitState(orgA, endpoint)?.state).toBe("open");
    expect(service.canDeliver(orgA, endpoint)).toBe(false);
    expect(service.circuitState(orgB, endpoint)?.state).toBe("closed");
    expect(service.canDeliver(orgB, endpoint)).toBe(true);
  });
});
