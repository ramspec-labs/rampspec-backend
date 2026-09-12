import { describe, expect, it } from "vitest";
import { InMemoryOwnershipRepository, OwnershipService } from "./ownership.js";

const organizationId = "organization_00000000-0000-4000-8000-000000000001";
const targetId = "target_00000000-0000-4000-8000-000000000002";

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
