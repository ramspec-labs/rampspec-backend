import { describe, expect, it, vi } from "vitest";

import {
  AuditService,
  InMemoryAuditStore,
  type AuditStore,
} from "../audit/service.js";
import type { AuthorizationActor } from "../auth/authorization.js";
import { DeliveryService, MAX_DELIVERY_ATTEMPTS } from "./service.js";
import { DeadLetterReplayService } from "./replay.js";
import type { WebhookResult } from "./webhook.js";

const reportId = "report_00000000-0000-4000-8000-000000000001";
const organizationId = "organization_a";

const owner: AuthorizationActor = {
  amr: ["pwd", "mfa"],
  kind: "user",
  role: "owner",
  userId: "user_operator",
};
const viewer: AuthorizationActor = {
  amr: ["pwd", "mfa"],
  kind: "user",
  role: "viewer",
  userId: "user_viewer",
};
const replayServiceAccount: AuthorizationActor = {
  kind: "service_account",
  scopes: new Set(["delivery:replay"]),
  serviceAccountId: "service_account_replay",
};
const unscopedServiceAccount: AuthorizationActor = {
  kind: "service_account",
  scopes: new Set(["run:create"]),
  serviceAccountId: "service_account_runner",
};

function deliveredResult(status = 200): WebhookResult {
  return { delivered: true, retryable: false, signature: "sig", status };
}

function setup(options: { maxConcurrentReplays?: number } = {}) {
  const deliveries = new DeliveryService();
  const store = new InMemoryAuditStore();
  const audit = new AuditService(store);
  const sender = vi.fn(() => Promise.resolve(deliveredResult()));
  const replays = new DeadLetterReplayService({
    audit,
    deliveries,
    maxConcurrentReplays: options.maxConcurrentReplays,
    sender,
  });
  return { audit, deliveries, replays, sender, store };
}

function deadLetter(deliveries: DeliveryService) {
  const original = deliveries.create(reportId, "webhook", { ok: true });
  for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    deliveries.update(original.id, "failed");
  }
  return original;
}

function replayRequest(
  deliveryId: string,
  actor: AuthorizationActor = owner,
) {
  return {
    actor,
    deliveryId,
    organizationId,
    requestId: "request_replay",
    resourceOrganizationId: organizationId,
  };
}

describe("authorized dead-letter replay", () => {
  it("replays a selected dead-letter delivery and records its outcome", async () => {
    const { deliveries, replays, sender } = setup();
    const original = deadLetter(deliveries);
    const { completed, delivery } = await replays.replay(
      replayRequest(original.id),
    );
    expect(delivery.state).toBe("pending");
    expect(delivery.replayedFromId).toBe(original.id);
    expect(replays.inspect(delivery.id).outcome).toBeNull();
    const outcome = await completed;
    expect(outcome).toMatchObject({
      attemptLineageId: delivery.attemptLineageId,
      delivered: true,
      deliveryId: delivery.id,
      originalDeliveryId: original.id,
      status: 200,
    });
    expect(deliveries.get(delivery.id)?.state).toBe("delivered");
    expect(replays.inspect(delivery.id).outcome).toEqual(outcome);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({ id: delivery.id }),
    );
  });

  it("keeps the original dead-letter record and its audit event unchanged", async () => {
    const { audit, deliveries, replays } = setup();
    const original = deadLetter(deliveries);
    const originalEvent = await audit.record({
      action: "delivery.dead-letter",
      actorId: "system",
      actorType: "system",
      metadata: { payloadHash: original.payloadHash },
      organizationId,
      requestId: "request_original",
      targetId: original.id,
      targetType: "delivery",
    });
    const before = deliveries.get(original.id);
    const { completed } = await replays.replay(replayRequest(original.id));
    await completed;
    expect(deliveries.get(original.id)).toEqual(before);
    const events = await audit.list(organizationId);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(originalEvent);
    expect(events[1]).toMatchObject({
      action: "delivery.replay",
      actorId: "user_operator",
      targetType: "delivery",
    });
    expect(events[1]?.metadata.originalDeliveryId).toBe(original.id);
    expect(events[1]?.metadata.payloadHash).toBe(original.payloadHash);
  });

  it("preserves idempotency: replays share the original payload hash", async () => {
    const { deliveries, replays } = setup();
    const original = deadLetter(deliveries);
    const first = await replays.replay(replayRequest(original.id));
    const second = await replays.replay(replayRequest(original.id));
    await Promise.all([first.completed, second.completed]);
    expect(first.delivery.payloadHash).toBe(original.payloadHash);
    expect(second.delivery.payloadHash).toBe(original.payloadHash);
    expect(first.delivery.id).not.toBe(second.delivery.id);
    expect(first.delivery.attemptLineageId).not.toBe(
      second.delivery.attemptLineageId,
    );
    expect(replays.listReplays(original.id)).toHaveLength(2);
  });
});

describe("replay authorization", () => {
  it("denies viewers, unscoped service accounts, and cross-tenant actors", async () => {
    const { deliveries, replays, sender } = setup();
    const original = deadLetter(deliveries);
    await expect(
      replays.replay(replayRequest(original.id, viewer)),
    ).rejects.toThrow("not authorized");
    await expect(
      replays.replay(replayRequest(original.id, unscopedServiceAccount)),
    ).rejects.toThrow("not authorized");
    await expect(
      replays.replay({
        ...replayRequest(original.id),
        resourceOrganizationId: "organization_b",
      }),
    ).rejects.toThrow("not authorized");
    expect(sender).not.toHaveBeenCalled();
    expect(replays.listReplays(original.id)).toHaveLength(0);
  });

  it("authorizes a service account holding the delivery replay scope", async () => {
    const { deliveries, replays } = setup();
    const original = deadLetter(deliveries);
    const { completed, delivery } = await replays.replay(
      replayRequest(original.id, replayServiceAccount),
    );
    await expect(completed).resolves.toMatchObject({ delivered: true });
    expect(delivery.state).toBe("pending");
  });
});

describe("replay failures and boundaries", () => {
  it("rejects replay of live deliveries and unknown ids", async () => {
    const { deliveries, replays } = setup();
    const pending = deliveries.create(reportId, "webhook", { ok: true });
    await expect(replays.replay(replayRequest(pending.id))).rejects.toThrow(
      "Only dead-letter deliveries can be replayed.",
    );
    await expect(
      replays.replay(replayRequest("delivery_missing")),
    ).rejects.toThrow("Delivery not found.");
  });

  it("records a failed outcome when the send fails and keeps the replay retryable", async () => {
    const { deliveries, replays, sender } = setup();
    sender.mockRejectedValueOnce(new Error("receiver down"));
    const original = deadLetter(deliveries);
    const { completed, delivery } = await replays.replay(
      replayRequest(original.id),
    );
    const outcome = await completed;
    expect(outcome).toMatchObject({
      delivered: false,
      deliveryId: delivery.id,
      status: null,
    });
    const updated = deliveries.get(delivery.id);
    expect(updated?.state).toBe("failed");
    expect(updated?.retryCount).toBe(1);
  });

  it("does not start a send when the audit record cannot be written", async () => {
    const deliveries = new DeliveryService();
    const failingStore: AuditStore = {
      append: () => Promise.reject(new Error("audit unavailable")),
      list: () => Promise.resolve([]),
    };
    const audit = new AuditService(failingStore);
    const sender = vi.fn(() => Promise.resolve(deliveredResult()));
    const replays = new DeadLetterReplayService({
      audit,
      deliveries,
      sender,
    });
    const original = deadLetter(deliveries);
    await expect(replays.replay(replayRequest(original.id))).rejects.toThrow(
      "audit unavailable",
    );
    expect(sender).not.toHaveBeenCalled();
  });

  it("rejects a concurrency bound below one", () => {
    const { audit, deliveries } = setup();
    expect(
      () =>
        new DeadLetterReplayService({
          audit,
          deliveries,
          maxConcurrentReplays: 0,
          sender: () => Promise.resolve(deliveredResult()),
        }),
    ).toThrow("Replay concurrency must be at least 1.");
  });

  it("serializes replays when the concurrency bound is one", async () => {
    const { deliveries, replays, sender } = setup({ maxConcurrentReplays: 1 });
    const first = deadLetter(deliveries);
    const second = deadLetter(deliveries);
    let releaseFirst!: () => void;
    const firstSend = new Promise<WebhookResult>((resolve) => {
      releaseFirst = () =>
        resolve(deliveredResult());
    });
    sender.mockImplementationOnce(() => firstSend);
    const firstReplay = await replays.replay(replayRequest(first.id));
    const secondReplay = await replays.replay(replayRequest(second.id));
    await vi.waitFor(() => {
      expect(sender).toHaveBeenCalledTimes(1);
    });
    expect(replays.activeReplays).toBe(1);
    expect(replays.queuedReplays).toBe(1);
    releaseFirst();
    await Promise.all([firstReplay.completed, secondReplay.completed]);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(replays.activeReplays).toBe(0);
    expect(replays.queuedReplays).toBe(0);
  });

  it("never exceeds the configured concurrent replay bound", async () => {
    const { deliveries, replays, sender } = setup({ maxConcurrentReplays: 2 });
    const originals = [deadLetter(deliveries), deadLetter(deliveries), deadLetter(deliveries)];
    let running = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];
    sender.mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      running -= 1;
      return deliveredResult();
    });
    const started = await Promise.all(
      originals.map((original) => replays.replay(replayRequest(original.id))),
    );
    await vi.waitFor(() => {
      expect(sender).toHaveBeenCalledTimes(2);
    });
    expect(replays.activeReplays).toBe(2);
    expect(replays.queuedReplays).toBe(1);
    for (const resolve of resolvers.splice(0)) resolve();
    await vi.waitFor(() => {
      expect(sender).toHaveBeenCalledTimes(3);
    });
    for (const resolve of resolvers.splice(0)) resolve();
    await Promise.all(started.map(({ completed }) => completed));
    expect(peak).toBe(2);
    expect(replays.activeReplays).toBe(0);
  });

  it("lets an exhausted replay be replayed again under a new lineage", async () => {
    const { deliveries, replays, sender } = setup();
    const original = deadLetter(deliveries);
    sender.mockRejectedValueOnce(new Error("receiver down"));
    const first = await replays.replay(replayRequest(original.id));
    await first.completed;
    expect(deliveries.get(first.delivery.id)?.state).toBe("failed");
    for (let attempt = 1; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      deliveries.update(first.delivery.id, "failed");
    }
    expect(deliveries.get(first.delivery.id)?.state).toBe("dead-letter");
    const second = await replays.replay(replayRequest(first.delivery.id));
    const outcome = await second.completed;
    expect(second.delivery.replayedFromId).toBe(first.delivery.id);
    expect(second.delivery.attemptLineageId).not.toBe(
      first.delivery.attemptLineageId,
    );
    expect(outcome.delivered).toBe(true);
  });
});

describe("replay inspection", () => {
  it("lists dead-letter deliveries and inspects replay outcomes", async () => {
    const { deliveries, replays } = setup();
    const original = deadLetter(deliveries);
    expect(replays.listDeadLetter().map(({ id }) => id)).toEqual([
      original.id,
    ]);
    const { completed, delivery } = await replays.replay(
      replayRequest(original.id),
    );
    await completed;
    expect(replays.listDeadLetter().map(({ id }) => id)).toEqual([
      original.id,
    ]);
    expect(replays.inspect(delivery.id).delivery.state).toBe("delivered");
    expect(replays.inspect(delivery.id).outcome?.delivered).toBe(true);
    expect(() => replays.inspect("delivery_missing")).toThrow(
      "Delivery not found.",
    );
  });
});
