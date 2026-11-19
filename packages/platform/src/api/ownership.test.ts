import { describe, expect, it } from "vitest";
import {
  InMemoryOwnershipRepository,
  OwnershipService,
  type OwnershipAudit,
} from "./ownership.js";

const organizationId = "organization_00000000-0000-4000-8000-000000000001";
const targetId = "target_00000000-0000-4000-8000-000000000002";
const otherOrganizationId =
  "organization_00000000-0000-4000-8000-000000000003";

function controllableService(audit?: OwnershipAudit) {
  let now = new Date("2026-09-12T18:00:00.000Z");
  const repository = new InMemoryOwnershipRepository();
  const service = new OwnershipService({
    ...(audit === undefined ? {} : { audit }),
    clock: () => now,
    repository,
  });
  return {
    repository,
    service,
    setNow: (value: string) => {
      now = new Date(value);
    },
  };
}

describe("ownership verification", () => {
  it("creates a short-lived challenge and verifies only the secret proof", async () => {
    const service = new OwnershipService({ clock: () => new Date("2026-09-12T18:00:00.000Z"), repository: new InMemoryOwnershipRepository() });
    const { challenge, token } = await service.create({ organizationId, targetId, method: "dns_txt" });
    expect(challenge.tokenHash).not.toContain(token);
    await expect(service.verify(organizationId, challenge.id, "wrong")).rejects.toThrow("Invalid");
    expect((await service.verify(organizationId, challenge.id, token, "dns-record")).status).toBe("verified");
    await expect(service.verify(organizationId, challenge.id, token)).rejects.toThrow("not pending");
  });

  it("enforces TTL, duplicate pending challenges, expiry, revocation, and tenant isolation", async () => {
    const repository = new InMemoryOwnershipRepository();
    let now = new Date("2026-09-12T18:00:00.000Z");
    const service = new OwnershipService({ clock: () => now, repository });
    await expect(service.create({ organizationId, targetId, method: "well_known", ttlSeconds: 30 })).rejects.toThrow("TTL");
    const first = await service.create({ organizationId, targetId, method: "well_known" });
    await expect(service.create({ organizationId, targetId, method: "well_known" })).rejects.toThrow("pending");
    await expect(service.verify("organization_00000000-0000-4000-8000-000000000003", first.challenge.id, first.token)).rejects.toThrow("not found");
    now = new Date("2026-09-12T18:16:00.000Z");
    await expect(service.verify(organizationId, first.challenge.id, first.token)).rejects.toThrow("expired");
    const second = await service.create({ organizationId, targetId, method: "well_known" });
    await service.revoke(organizationId, second.challenge.id);
    await expect(service.verify(organizationId, second.challenge.id, second.token)).rejects.toThrow("not pending");
  });
});

describe("ownership challenge expiry boundaries", () => {
  it("treats expiry as exclusive: one millisecond before expiry verifies, at exactly expiry it expires", async () => {
    const { service, setNow } = controllableService();
    const { challenge, token } = await service.create({
      organizationId,
      targetId,
      method: "dns_txt",
      ttlSeconds: 60,
    });
    expect(challenge.expiresAt).toBe("2026-09-12T18:01:00.000Z");
    setNow("2026-09-12T18:00:59.999Z");
    expect(
      (await service.verify(organizationId, challenge.id, token)).status,
    ).toBe("verified");

    const second = controllableService();
    const created = await second.service.create({
      organizationId,
      targetId,
      method: "dns_txt",
      ttlSeconds: 60,
    });
    second.setNow("2026-09-12T18:01:00.000Z");
    await expect(
      second.service.verify(organizationId, created.challenge.id, created.token),
    ).rejects.toThrow("expired");
    const stored = await second.service.list(organizationId, targetId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe("expired");
    expect(stored[0]?.verifiedAt).toBeNull();
  });

  it("admits exactly one winner when two proofs race", async () => {
    const { service } = controllableService();
    const { challenge, token } = await service.create({
      organizationId,
      targetId,
      method: "well_known",
    });
    const results = await Promise.allSettled([
      service.verify(organizationId, challenge.id, token),
      service.verify(organizationId, challenge.id, token),
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof service.verify>>
      > => result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]?.value.status).toBe("verified");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(Error);
    expect((rejected[0]?.reason as Error).message).toContain("not pending");
    const stored = await service.list(organizationId, targetId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe("verified");
    expect(stored[0]?.verifiedAt).toBe("2026-09-12T18:00:00.000Z");
  });

  it("rejects every concurrent proof once the challenge has expired", async () => {
    const { service, setNow } = controllableService();
    const { challenge, token } = await service.create({
      organizationId,
      targetId,
      method: "dns_txt",
      ttlSeconds: 60,
    });
    setNow("2026-09-12T18:02:00.000Z");
    const results = await Promise.allSettled([
      service.verify(organizationId, challenge.id, token),
      service.verify(organizationId, challenge.id, token),
    ]);
    expect(
      results.every((result) => result.status === "rejected"),
    ).toBe(true);
    const messages = results.map((result) =>
      result.status === "rejected" ? (result.reason as Error).message : "",
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("expired"),
        expect.stringContaining("not pending"),
      ]),
    );
    const stored = await service.list(organizationId, targetId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe("expired");
  });

  it("never verifies a target from an expired challenge, however often the proof is retried", async () => {
    const { service, setNow } = controllableService();
    const { challenge, token } = await service.create({
      organizationId,
      targetId,
      method: "well_known",
      ttlSeconds: 60,
    });
    setNow("2026-09-12T18:02:00.000Z");
    await expect(
      service.verify(organizationId, challenge.id, token),
    ).rejects.toThrow("expired");
    await expect(
      service.verify(organizationId, challenge.id, token),
    ).rejects.toThrow("not pending");
    const stored = await service.list(organizationId, targetId);
    expect(stored.filter((entry) => entry.status === "verified")).toHaveLength(
      0,
    );
    expect(stored[0]?.verifiedAt).toBeNull();
  });
});

describe("ownership challenge renewal", () => {
  it("renews a pending challenge and retires its proof material", async () => {
    const { service, setNow } = controllableService();
    const first = await service.create({
      organizationId,
      targetId,
      method: "well_known",
      ttlSeconds: 900,
    });
    setNow("2026-09-12T18:01:00.000Z");
    const renewed = await service.renew(organizationId, first.challenge.id, {
      ttlSeconds: 3600,
    });
    expect(renewed.previous.id).toBe(first.challenge.id);
    expect(renewed.previous.status).toBe("revoked");
    expect(renewed.challenge.id).not.toBe(first.challenge.id);
    expect(renewed.challenge.status).toBe("pending");
    expect(renewed.challenge.method).toBe("well_known");
    expect(renewed.challenge.targetId).toBe(targetId);
    expect(renewed.challenge.createdAt).toBe("2026-09-12T18:01:00.000Z");
    expect(renewed.challenge.expiresAt).toBe("2026-09-12T19:01:00.000Z");
    expect(renewed.challenge.tokenHash).not.toBe(first.challenge.tokenHash);
    expect(renewed.token).not.toBe(first.token);

    await expect(
      service.verify(organizationId, first.challenge.id, first.token),
    ).rejects.toThrow("not pending");
    await expect(
      service.verify(organizationId, renewed.challenge.id, first.token),
    ).rejects.toThrow("Invalid");
    expect(
      (
        await service.verify(
          organizationId,
          renewed.challenge.id,
          renewed.token,
        )
      ).status,
    ).toBe("verified");
  });

  it("renews an expired challenge and leaves the expired record terminal", async () => {
    const { service, setNow } = controllableService();
    const first = await service.create({
      organizationId,
      targetId,
      method: "dns_txt",
      ttlSeconds: 60,
    });
    setNow("2026-09-12T18:02:00.000Z");
    const renewed = await service.renew(organizationId, first.challenge.id);
    expect(renewed.previous.status).toBe("expired");
    expect(renewed.challenge.status).toBe("pending");
    expect(renewed.challenge.expiresAt).toBe("2026-09-12T18:17:00.000Z");
    const stored = await service.list(organizationId, targetId);
    expect(
      stored.find((entry) => entry.id === first.challenge.id)?.status,
    ).toBe("expired");
    await expect(
      service.verify(organizationId, first.challenge.id, first.token),
    ).rejects.toThrow("not pending");
    expect(
      (
        await service.verify(
          organizationId,
          renewed.challenge.id,
          renewed.token,
        )
      ).status,
    ).toBe("verified");
  });

  it("refuses to renew verified or revoked challenges", async () => {
    const { service } = controllableService();
    const verified = await service.create({
      organizationId,
      targetId,
      method: "dns_txt",
    });
    await service.verify(organizationId, verified.challenge.id, verified.token);
    await expect(
      service.renew(organizationId, verified.challenge.id),
    ).rejects.toThrow("already verified");

    const revoked = await service.create({
      organizationId,
      targetId,
      method: "well_known",
    });
    await service.revoke(organizationId, revoked.challenge.id);
    await expect(
      service.renew(organizationId, revoked.challenge.id),
    ).rejects.toThrow("revoked");
  });

  it("enforces TTL bounds and tenant isolation on renewal", async () => {
    const { service } = controllableService();
    const { challenge } = await service.create({
      organizationId,
      targetId,
      method: "dns_txt",
    });
    await expect(
      service.renew(organizationId, challenge.id, { ttlSeconds: 30 }),
    ).rejects.toThrow("TTL");
    await expect(
      service.renew(organizationId, challenge.id, { ttlSeconds: 86_401 }),
    ).rejects.toThrow("TTL");
    await expect(
      service.renew(
        organizationId,
        "verification_00000000-0000-4000-8000-000000000099",
      ),
    ).rejects.toThrow("not found");
    await expect(
      service.renew(otherOrganizationId, challenge.id),
    ).rejects.toThrow("not found");
  });

  it("records renewal, creation, and verification in the audit history", async () => {
    const actions: string[] = [];
    const audit: OwnershipAudit = {
      record: (input) => {
        actions.push(input.action);
        return Promise.resolve();
      },
    };
    const { service } = controllableService(audit);
    const first = await service.create({
      organizationId,
      targetId,
      method: "dns_txt",
    });
    const renewed = await service.renew(organizationId, first.challenge.id);
    await service.verify(organizationId, renewed.challenge.id, renewed.token);
    expect(actions).toEqual([
      "target.ownership_challenge.created",
      "target.ownership_challenge.renewed",
      "target.ownership_challenge.created",
      "target.ownership_challenge.verified",
    ]);
  });
});
