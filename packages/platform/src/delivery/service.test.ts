import { describe, expect, it } from "vitest";
import {
  DeliveryService,
  MAX_DELIVERY_ATTEMPTS,
} from "./service.js";

const reportId = "report_00000000-0000-4000-8000-000000000001";

describe("delivery records", () => { it("creates immutable hashed deliveries and tracks retries", () => { const service = new DeliveryService(); const delivery = service.create("report_00000000-0000-4000-8000-000000000001", "webhook", { ok: true }); expect(delivery.payloadHash).toHaveLength(64); expect(service.update(delivery.id, "failed").retryCount).toBe(1); expect(service.update(delivery.id, "delivered").state).toBe("delivered"); expect(() => service.update(delivery.id, "failed")).toThrow("terminal"); }); });

function exhaust(service: DeliveryService, id: string) {
  for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    service.update(id, "failed");
  }
}

describe("dead-letter state", () => {
  it("parks a delivery as dead-letter after the maximum failed attempts", () => {
    const service = new DeliveryService();
    const delivery = service.create(reportId, "webhook", { ok: true });
    for (let attempt = 1; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      const updated = service.update(delivery.id, "failed");
      expect(updated.state).toBe("failed");
      expect(updated.retryCount).toBe(attempt);
      expect(updated.deadLetterAt).toBeNull();
    }
    const exhausted = service.update(delivery.id, "failed");
    expect(exhausted.state).toBe("dead-letter");
    expect(exhausted.retryCount).toBe(MAX_DELIVERY_ATTEMPTS);
    expect(exhausted.deadLetterAt).not.toBeNull();
    expect(service.listDeadLetter().map(({ id }) => id)).toEqual([
      delivery.id,
    ]);
  });

  it("allows an explicit dead-letter transition and treats it as terminal", () => {
    const service = new DeliveryService();
    const delivery = service.create(reportId, "webhook", { ok: true });
    service.update(delivery.id, "failed");
    const dead = service.update(delivery.id, "dead-letter");
    expect(dead.state).toBe("dead-letter");
    expect(dead.deadLetterAt).not.toBeNull();
    expect(() => service.update(delivery.id, "failed")).toThrow("terminal");
    expect(() => service.update(delivery.id, "delivered")).toThrow(
      "terminal",
    );
    expect(() => service.update(delivery.id, "dead-letter")).toThrow(
      "terminal",
    );
  });

  it("keeps delivered deliveries terminal and rejects unknown ids", () => {
    const service = new DeliveryService();
    const delivery = service.create(reportId, "webhook", { ok: true });
    service.update(delivery.id, "delivered");
    expect(() => service.update(delivery.id, "dead-letter")).toThrow(
      "terminal",
    );
    expect(() => service.update("delivery_missing", "failed")).toThrow(
      "Delivery not found.",
    );
  });
});

describe("dead-letter replay lineage", () => {
  it("creates a fresh lineage that preserves the payload hash", () => {
    const service = new DeliveryService();
    const original = service.create(reportId, "webhook", { ok: true });
    exhaust(service, original.id);
    const before = service.get(original.id);
    const replayed = service.replay(original.id);
    expect(replayed.id).not.toBe(original.id);
    expect(replayed.attemptLineageId).not.toBe(original.attemptLineageId);
    expect(replayed.attemptLineageId).toBe(replayed.id);
    expect(replayed.replayedFromId).toBe(original.id);
    expect(replayed.reportId).toBe(original.reportId);
    expect(replayed.kind).toBe(original.kind);
    expect(replayed.payloadHash).toBe(original.payloadHash);
    expect(replayed.retryCount).toBe(0);
    expect(replayed.state).toBe("pending");
    expect(replayed.deadLetterAt).toBeNull();
    expect(service.get(original.id)).toEqual(before);
    expect(service.listReplays(original.id).map(({ id }) => id)).toEqual([
      replayed.id,
    ]);
  });

  it("rejects replay of deliveries that are not dead-letter", () => {
    const service = new DeliveryService();
    const pending = service.create(reportId, "webhook", { ok: true });
    expect(() => service.replay(pending.id)).toThrow(
      "Only dead-letter deliveries can be replayed.",
    );
    service.update(pending.id, "failed");
    expect(() => service.replay(pending.id)).toThrow(
      "Only dead-letter deliveries can be replayed.",
    );
    const delivered = service.create(reportId, "webhook", { ok: true });
    service.update(delivered.id, "delivered");
    expect(() => service.replay(delivered.id)).toThrow(
      "Only dead-letter deliveries can be replayed.",
    );
    expect(() => service.replay("delivery_missing")).toThrow(
      "Delivery not found.",
    );
  });

  it("allows a replay that exhausts again to be replayed under a new lineage", () => {
    const service = new DeliveryService();
    const original = service.create(reportId, "webhook", { ok: true });
    exhaust(service, original.id);
    const first = service.replay(original.id);
    exhaust(service, first.id);
    const second = service.replay(first.id);
    expect(second.replayedFromId).toBe(first.id);
    expect(second.attemptLineageId).not.toBe(first.attemptLineageId);
    expect(second.payloadHash).toBe(original.payloadHash);
    expect(service.listReplays(original.id)).toHaveLength(1);
    expect(service.listReplays(first.id).map(({ id }) => id)).toEqual([
      second.id,
    ]);
  });
});
