import { describe, expect, it } from "vitest";

import {
  InMemoryOrganizationRepository,
  OrganizationService,
} from "./organizations.js";

const policy = { allowPubnet: false, evidenceRetentionDays: 30 } as const;

describe("organization service", () => {
  function service() {
    return new OrganizationService({
      clock: () => new Date("2026-09-12T18:00:00.000Z"),
      repository: new InMemoryOrganizationRepository(),
    });
  }

  it("creates, reads, updates, and paginates organizations with opaque cursors", async () => {
    const auth = service();
    const first = await auth.create({
      name: " Primary Org ",
      ownerUserId: "user_1",
      policy,
      slug: "Primary-Org",
    });
    await auth.create({
      name: "Second Org",
      ownerUserId: "user_2",
      policy,
      slug: "second-org",
    });
    expect((await auth.get(first.id)).name).toBe("Primary Org");
    expect((await auth.update(first.id, { name: "Renamed" })).name).toBe(
      "Renamed",
    );
    const page = await auth.list(undefined, 1);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toMatch(/^orgcursor_[A-Za-z0-9_-]+$/u);
    await expect(auth.list("not-a-cursor")).rejects.toThrow("cursor");
  });

  it("enforces slug, retention, signing-reference, and pubnet policy boundaries", async () => {
    const auth = service();
    await expect(
      auth.create({ name: "Org", ownerUserId: "user", policy, slug: "x" }),
    ).rejects.toThrow("slug");
    await expect(
      auth.create({
        name: "Org",
        ownerUserId: "user",
        policy: { ...policy, evidenceRetentionDays: 0 },
        slug: "valid-org",
      }),
    ).rejects.toThrow("retention");
    await expect(
      auth.create({
        name: "Org",
        ownerUserId: "user",
        policy: { ...policy, reportSigningKeyRef: "raw-secret" },
        slug: "valid-org",
      }),
    ).rejects.toThrow("secret reference");
  });

  it("invites members, changes roles, and protects the last owner", async () => {
    const auth = service();
    const organization = await auth.create({
      name: "Org",
      ownerUserId: "owner",
      policy,
      slug: "valid-org",
    });
    await auth.invite(organization.id, "member", "viewer");
    await expect(
      auth.changeRole(organization.id, "member", "maintainer"),
    ).rejects.toThrow("Membership not found");
    const repository = new InMemoryOrganizationRepository();
    const managed = new OrganizationService({ repository });
    const created = await managed.create({
      name: "Managed",
      ownerUserId: "owner",
      policy,
      slug: "managed-org",
    });
    await managed.invite(created.id, "member", "viewer");
    await repository.upsertMembership({
      organizationId: created.id,
      role: "viewer",
      status: "active",
      userId: "member",
    });
    await managed.changeRole(created.id, "member", "maintainer");
    await expect(managed.removeMember(created.id, "owner")).rejects.toThrow(
      "last owner",
    );
    await expect(
      managed.changeRole(created.id, "owner", "viewer"),
    ).rejects.toThrow("active owner");
  });

  it("rejects duplicate slugs and missing organizations", async () => {
    const auth = service();
    await auth.create({
      name: "Org",
      ownerUserId: "owner",
      policy,
      slug: "valid-org",
    });
    await expect(
      auth.create({
        name: "Other",
        ownerUserId: "other",
        policy,
        slug: "valid-org",
      }),
    ).rejects.toThrow("already exists");
    await expect(
      auth.get("organization_00000000-0000-4000-8000-000000000099"),
    ).rejects.toThrow("not found");
  });

  it("archives an organization and makes deletion idempotent", async () => {
    const auth = service();
    const organization = await auth.create({
      name: "Org",
      ownerUserId: "owner",
      policy,
      slug: "valid-org",
    });
    await auth.delete(organization.id);
    expect((await auth.get(organization.id)).status).toBe("deleted");
    await expect(auth.delete(organization.id)).resolves.toBeUndefined();
    await expect(auth.update(organization.id, { name: "Nope" })).rejects.toThrow(
      "not active",
    );
  });
});
