import { describe, expect, it } from "vitest";

import {
  AuditService,
  InMemoryAuditStore,
  verifyMetadataHash,
} from "./service.js";

const base = {
  action: "run.created",
  actorId: "user_1",
  actorType: "user" as const,
  now: new Date("2026-09-12T18:00:00.000Z"),
  organizationId: "organization_a",
  requestId: "request_1",
  targetId: "run_1",
  targetType: "run",
};

describe("audit service", () => {
  it("records actor, tenant, request, trace, and deterministic metadata hash", async () => {
    const service = new AuditService(new InMemoryAuditStore());
    const event = await service.record({
      ...base,
      metadata: { zeta: "last", alpha: "first" },
      traceId: "trace_1",
    });
    expect(event).toMatchObject({
      action: "run.created",
      occurredAt: "2026-09-12T18:00:00.000Z",
      organizationId: "organization_a",
      requestId: "request_1",
      traceId: "trace_1",
    });
    expect(event.metadataHash).toMatch(/^[a-f\d]{64}$/u);
    expect(verifyMetadataHash(event)).toBe(true);
    expect(await service.list("organization_b")).toEqual([]);
  });

  it("hashes semantically identical metadata independently of key order", async () => {
    const service = new AuditService(new InMemoryAuditStore());
    const first = await service.record({ ...base, metadata: { a: "1", b: 2 } });
    const second = await service.record({
      ...base,
      metadata: { b: 2, a: "1" },
    });
    expect(first.metadataHash).toBe(second.metadataHash);
  });

  it.each([
    { authorization: "Bearer secret" },
    { client_secret: "secret" },
    { password: "secret" },
    { email: "person@example.test" },
    { walletToken: "rsk_sensitive" },
  ])("rejects sensitive metadata %j", async (metadata) => {
    await expect(
      new AuditService(new InMemoryAuditStore()).record({ ...base, metadata }),
    ).rejects.toThrow("prohibited");
  });

  it("rejects malformed actions and missing identity context", async () => {
    const service = new AuditService(new InMemoryAuditStore());
    await expect(
      service.record({ ...base, action: "RUN CREATED" }),
    ).rejects.toThrow("action");
    await expect(
      service.record({ ...base, organizationId: "" }),
    ).rejects.toThrow("required");
  });

  it("keeps stored events append-only", async () => {
    const store = new InMemoryAuditStore();
    const service = new AuditService(store);
    const event = await service.record({ ...base, metadata: { key: "value" } });
    const listed = await service.list("organization_a");
    expect(listed).toEqual([event]);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(listed[0])).toBe(true);
  });
});
