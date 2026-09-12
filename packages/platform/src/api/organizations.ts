import { createId, parseId, type OpaqueId } from "../../../domain/src/index.js";

export interface OrganizationPolicy {
  readonly allowPubnet: boolean;
  readonly evidenceRetentionDays: number;
  readonly reportSigningKeyRef?: string;
}

export interface Organization {
  readonly createdAt: string;
  readonly id: OpaqueId<"organization">;
  readonly name: string;
  readonly ownerUserId: string;
  readonly policy: OrganizationPolicy;
  readonly slug: string;
  readonly status: "active" | "deleted" | "suspended";
  readonly updatedAt: string;
}

export interface Membership {
  readonly organizationId: OpaqueId<"organization">;
  readonly role:
    "admin" | "auditor" | "maintainer" | "owner" | "runner" | "viewer";
  readonly status: "active" | "invited" | "suspended";
  readonly userId: string;
}

export interface OrganizationRepository {
  list(): Promise<readonly Organization[]>;
  get(id: OpaqueId<"organization">): Promise<Organization | undefined>;
  insert(organization: Organization): Promise<void>;
  update(organization: Organization): Promise<void>;
  listMemberships(id: OpaqueId<"organization">): Promise<readonly Membership[]>;
  upsertMembership(membership: Membership): Promise<void>;
  deleteMembership(id: OpaqueId<"organization">, userId: string): Promise<void>;
}

export interface OrganizationAudit {
  record(input: {
    readonly action: string;
    readonly organizationId: string;
    readonly targetId: string;
    readonly targetType: string;
  }): Promise<void>;
}

export interface OrganizationServiceOptions {
  readonly audit?: OrganizationAudit;
  readonly clock?: () => Date;
  readonly repository: OrganizationRepository;
}

export interface OrganizationPage {
  readonly items: readonly Organization[];
  readonly nextCursor: string | null;
}

const cursorPrefix = "orgcursor_";

function encodeCursor(index: number): string {
  return `${cursorPrefix}${Buffer.from(String(index), "utf8").toString("base64url")}`;
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!cursor.startsWith(cursorPrefix))
    throw new Error("Invalid organization cursor.");
  const index = Number(
    Buffer.from(cursor.slice(cursorPrefix.length), "base64url").toString(
      "utf8",
    ),
  );
  if (!Number.isSafeInteger(index) || index < 0)
    throw new Error("Invalid organization cursor.");
  return index;
}

function validateSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{2,62}$/u.test(normalized))
    throw new Error("Invalid organization slug.");
  return normalized;
}

function validatePolicy(policy: OrganizationPolicy): OrganizationPolicy {
  if (
    !Number.isInteger(policy.evidenceRetentionDays) ||
    policy.evidenceRetentionDays < 1 ||
    policy.evidenceRetentionDays > 3650
  ) {
    throw new Error("Evidence retention must be between 1 and 3650 days.");
  }
  if (
    policy.reportSigningKeyRef &&
    !/^(?:aws-kms|azure-kv|gcp-kms|local|vault):\/\/[\w./:@-]+$/u.test(
      policy.reportSigningKeyRef,
    )
  ) {
    throw new Error("Report signing key must be a secret reference.");
  }
  return Object.freeze({ ...policy });
}

export class OrganizationService {
  private readonly audit: OrganizationAudit | undefined;
  private readonly clock: () => Date;
  private readonly repository: OrganizationRepository;

  constructor(options: OrganizationServiceOptions) {
    this.audit = options.audit;
    this.clock = options.clock ?? (() => new Date());
    this.repository = options.repository;
  }

  async list(cursor?: string, limit = 25): Promise<OrganizationPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Invalid page limit.");
    const organizations = [...(await this.repository.list())].sort((a, b) =>
      a.id.localeCompare(b.id, "en"),
    );
    const start = decodeCursor(cursor);
    const items = organizations.slice(start, start + limit);
    return {
      items,
      nextCursor:
        start + items.length < organizations.length
          ? encodeCursor(start + items.length)
          : null,
    };
  }

  async create(input: {
    readonly name: string;
    readonly ownerUserId: string;
    readonly policy: OrganizationPolicy;
    readonly slug: string;
  }): Promise<Organization> {
    if (!input.name.trim() || input.name.length > 200)
      throw new Error("Invalid organization name.");
    const now = this.clock().toISOString();
    const organization: Organization = Object.freeze({
      createdAt: now,
      id: createId("organization"),
      name: input.name.trim(),
      ownerUserId: input.ownerUserId,
      policy: validatePolicy(input.policy),
      slug: validateSlug(input.slug),
      status: "active",
      updatedAt: now,
    });
    await this.repository.insert(organization);
    await this.repository.upsertMembership({
      organizationId: organization.id,
      role: "owner",
      status: "active",
      userId: input.ownerUserId,
    });
    await this.audit?.record({
      action: "organization.created",
      organizationId: organization.id,
      targetId: organization.id,
      targetType: "organization",
    });
    return organization;
  }

  async get(id: string): Promise<Organization> {
    const organization = await this.repository.get(parseId("organization", id));
    if (!organization) throw new Error("Organization not found.");
    return organization;
  }

  async update(
    id: string,
    input: {
      readonly name?: string;
      readonly policy?: OrganizationPolicy;
      readonly slug?: string;
    },
  ): Promise<Organization> {
    const organization = await this.get(id);
    if (organization.status !== "active")
      throw new Error("Organization is not active.");
    const updated: Organization = Object.freeze({
      ...organization,
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.policy === undefined
        ? {}
        : { policy: validatePolicy(input.policy) }),
      ...(input.slug === undefined ? {} : { slug: validateSlug(input.slug) }),
      updatedAt: this.clock().toISOString(),
    });
    if (!updated.name || updated.name.length > 200)
      throw new Error("Invalid organization name.");
    await this.repository.update(updated);
    await this.audit?.record({
      action: "organization.updated",
      organizationId: organization.id,
      targetId: organization.id,
      targetType: "organization",
    });
    return updated;
  }

  async delete(id: string): Promise<void> {
    const organization = await this.get(id);
    if (organization.status === "deleted") return;
    const deleted: Organization = Object.freeze({
      ...organization,
      status: "deleted",
      updatedAt: this.clock().toISOString(),
    });
    await this.repository.update(deleted);
    await this.audit?.record({
      action: "organization.deleted",
      organizationId: organization.id,
      targetId: organization.id,
      targetType: "organization",
    });
  }

  async invite(
    organizationId: string,
    userId: string,
    role: Membership["role"] = "viewer",
  ): Promise<void> {
    const organization = await this.get(organizationId);
    if (organization.status !== "active" || role === "owner")
      throw new Error("Invalid organization invitation.");
    await this.repository.upsertMembership({
      organizationId: organization.id,
      role,
      status: "invited",
      userId,
    });
    await this.audit?.record({
      action: "organization.member.invited",
      organizationId,
      targetId: userId,
      targetType: "user",
    });
  }

  async changeRole(
    organizationId: string,
    userId: string,
    role: Membership["role"],
  ): Promise<void> {
    const organization = await this.get(organizationId);
    const memberships = await this.repository.listMemberships(organization.id);
    const current = memberships.find(
      (membership) => membership.userId === userId,
    );
    if (!current || current.status === "invited")
      throw new Error("Membership not found.");
    if (
      current.role === "owner" &&
      role !== "owner" &&
      memberships.filter(
        ({ role: candidate, status }) =>
          candidate === "owner" && status === "active",
      ).length < 2
    ) {
      throw new Error("An organization must retain an active owner.");
    }
    await this.repository.upsertMembership({ ...current, role });
    await this.audit?.record({
      action: "organization.member.role_changed",
      organizationId,
      targetId: userId,
      targetType: "user",
    });
  }

  async removeMember(organizationId: string, userId: string): Promise<void> {
    const organization = await this.get(organizationId);
    const memberships = await this.repository.listMemberships(organization.id);
    const current = memberships.find(
      (membership) => membership.userId === userId,
    );
    if (!current) throw new Error("Membership not found.");
    if (
      current.role === "owner" &&
      memberships.filter(
        ({ role, status }) => role === "owner" && status === "active",
      ).length < 2
    ) {
      throw new Error("The last owner cannot be removed.");
    }
    await this.repository.deleteMembership(organization.id, userId);
    await this.audit?.record({
      action: "organization.member.removed",
      organizationId,
      targetId: userId,
      targetType: "user",
    });
  }
}

export class InMemoryOrganizationRepository implements OrganizationRepository {
  private readonly memberships = new Map<string, Membership>();
  private readonly organizations = new Map<string, Organization>();

  list(): Promise<readonly Organization[]> {
    return Promise.resolve([...this.organizations.values()]);
  }
  get(id: OpaqueId<"organization">): Promise<Organization | undefined> {
    return Promise.resolve(this.organizations.get(id));
  }
  insert(organization: Organization): Promise<void> {
    if (
      [...this.organizations.values()].some(
        ({ slug }) => slug === organization.slug,
      )
    )
      return Promise.reject(new Error("Organization slug already exists."));
    this.organizations.set(organization.id, organization);
    return Promise.resolve();
  }
  update(organization: Organization): Promise<void> {
    this.organizations.set(organization.id, organization);
    return Promise.resolve();
  }
  listMemberships(
    id: OpaqueId<"organization">,
  ): Promise<readonly Membership[]> {
    return Promise.resolve(
      [...this.memberships.values()].filter(
        ({ organizationId }) => organizationId === id,
      ),
    );
  }
  upsertMembership(membership: Membership): Promise<void> {
    this.memberships.set(
      `${membership.organizationId}:${membership.userId}`,
      membership,
    );
    return Promise.resolve();
  }
  deleteMembership(
    id: OpaqueId<"organization">,
    userId: string,
  ): Promise<void> {
    this.memberships.delete(`${id}:${userId}`);
    return Promise.resolve();
  }
}
