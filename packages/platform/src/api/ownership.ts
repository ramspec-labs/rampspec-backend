import { createHash, randomBytes } from "node:crypto";

import { createId, parseId, type OpaqueId } from "../../../domain/src/index.js";

export type ChallengeMethod = "dns_txt" | "well_known";
export type ChallengeStatus = "expired" | "pending" | "revoked" | "verified";

export interface OwnershipChallenge {
  readonly createdAt: string;
  readonly evidenceHash: string | null;
  readonly expiresAt: string;
  readonly id: OpaqueId<"verification">;
  readonly method: ChallengeMethod;
  readonly organizationId: OpaqueId<"organization">;
  readonly status: ChallengeStatus;
  readonly targetId: OpaqueId<"target">;
  readonly tokenHash: string;
  readonly verifiedAt: string | null;
}

export interface OwnershipRepository {
  insert(challenge: OwnershipChallenge): Promise<void>;
  get(organizationId: OpaqueId<"organization">, id: OpaqueId<"verification">): Promise<OwnershipChallenge | undefined>;
  update(challenge: OwnershipChallenge): Promise<void>;
  list(organizationId: OpaqueId<"organization">, targetId: OpaqueId<"target">): Promise<readonly OwnershipChallenge[]>;
}

export interface OwnershipAudit { record(input: { readonly action: string; readonly organizationId: string; readonly targetId: string; readonly targetType: string }): Promise<void>; }

function digest(token: string): string { return createHash("sha256").update(token, "utf8").digest("hex"); }

export class OwnershipService {
  private readonly audit: OwnershipAudit | undefined;
  private readonly clock: () => Date;
  private readonly repository: OwnershipRepository;
  constructor(options: { readonly audit?: OwnershipAudit; readonly clock?: () => Date; readonly repository: OwnershipRepository }) {
    this.audit = options.audit;
    this.clock = options.clock ?? (() => new Date());
    this.repository = options.repository;
  }

  async create(input: { readonly organizationId: string; readonly targetId: string; readonly method: ChallengeMethod; readonly ttlSeconds?: number }): Promise<{ readonly challenge: OwnershipChallenge; readonly token: string }> {
    const organizationId = parseId("organization", input.organizationId);
    const targetId = parseId("target", input.targetId);
    const ttlSeconds = input.ttlSeconds ?? 900;
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86_400) throw new Error("Challenge TTL must be between 60 and 86400 seconds.");
    const now = this.clock();
    const token = `rampverify_${randomBytes(24).toString("base64url")}`;
    const challenge: OwnershipChallenge = Object.freeze({ createdAt: now.toISOString(), evidenceHash: null, expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(), id: createId("verification"), method: input.method, organizationId, status: "pending", targetId, tokenHash: digest(token), verifiedAt: null });
    await this.repository.insert(challenge);
    await this.audit?.record({ action: "target.ownership_challenge.created", organizationId, targetId: challenge.id, targetType: "verification" });
    return { challenge, token };
  }

  async verify(organizationId: string, id: string, token: string, evidence?: string): Promise<OwnershipChallenge> {
    const organization = parseId("organization", organizationId);
    const challenge = await this.repository.get(organization, parseId("verification", id));
    if (!challenge) throw new Error("Ownership challenge not found.");
    if (challenge.status !== "pending") throw new Error("Ownership challenge is not pending.");
    if (this.clock().getTime() >= Date.parse(challenge.expiresAt)) {
      const expired = Object.freeze({ ...challenge, status: "expired" as const });
      await this.repository.update(expired);
      throw new Error("Ownership challenge has expired.");
    }
    if (!token || digest(token) !== challenge.tokenHash) throw new Error("Invalid ownership proof.");
    const verifiedAt = this.clock().toISOString();
    const verified = Object.freeze({ ...challenge, evidenceHash: evidence ? digest(evidence) : null, status: "verified" as const, verifiedAt });
    await this.repository.update(verified);
    await this.audit?.record({ action: "target.ownership_challenge.verified", organizationId, targetId: challenge.id, targetType: "verification" });
    return verified;
  }

  async revoke(organizationId: string, id: string): Promise<void> {
    const organization = parseId("organization", organizationId);
    const challenge = await this.repository.get(organization, parseId("verification", id));
    if (!challenge) throw new Error("Ownership challenge not found.");
    if (challenge.status === "pending") await this.repository.update(Object.freeze({ ...challenge, status: "revoked" as const }));
    await this.audit?.record({ action: "target.ownership_challenge.revoked", organizationId, targetId: challenge.id, targetType: "verification" });
  }

  list(organizationId: string, targetId: string): Promise<readonly OwnershipChallenge[]> { return this.repository.list(parseId("organization", organizationId), parseId("target", targetId)); }
}

export class InMemoryOwnershipRepository implements OwnershipRepository {
  private readonly challenges = new Map<string, OwnershipChallenge>();
  insert(challenge: OwnershipChallenge): Promise<void> { if ([...this.challenges.values()].some((candidate) => candidate.organizationId === challenge.organizationId && candidate.targetId === challenge.targetId && candidate.method === challenge.method && candidate.status === "pending")) return Promise.reject(new Error("A pending challenge already exists.")); this.challenges.set(challenge.id, challenge); return Promise.resolve(); }
  get(organizationId: OpaqueId<"organization">, id: OpaqueId<"verification">): Promise<OwnershipChallenge | undefined> { const challenge = this.challenges.get(id); return Promise.resolve(challenge?.organizationId === organizationId ? challenge : undefined); }
  update(challenge: OwnershipChallenge): Promise<void> { this.challenges.set(challenge.id, challenge); return Promise.resolve(); }
  list(organizationId: OpaqueId<"organization">, targetId: OpaqueId<"target">): Promise<readonly OwnershipChallenge[]> { return Promise.resolve([...this.challenges.values()].filter((challenge) => challenge.organizationId === organizationId && challenge.targetId === targetId)); }
}
