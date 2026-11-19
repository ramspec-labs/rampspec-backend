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
  /**
   * Runs `work` atomically with respect to other transactions: the read,
   * terminal-state transition, and write of one verification are never
   * interleaved with another transaction on the same challenge. If `work`
   * throws, none of its repository effects are committed.
   */
  transact<T>(work: (repository: OwnershipRepository) => Promise<T>): Promise<T>;
}

export interface OwnershipAudit { record(input: { readonly action: string; readonly organizationId: string; readonly targetId: string; readonly targetType: string }): Promise<void>; }

function digest(token: string): string { return createHash("sha256").update(token, "utf8").digest("hex"); }

function assertTtlSeconds(ttlSeconds: number | undefined): number {
  const ttl = ttlSeconds ?? 900;
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86_400) throw new Error("Challenge TTL must be between 60 and 86400 seconds.");
  return ttl;
}

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
    const ttlSeconds = assertTtlSeconds(input.ttlSeconds);
    const now = this.clock();
    const token = `rampverify_${randomBytes(24).toString("base64url")}`;
    const challenge: OwnershipChallenge = Object.freeze({ createdAt: now.toISOString(), evidenceHash: null, expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(), id: createId("verification"), method: input.method, organizationId, status: "pending", targetId, tokenHash: digest(token), verifiedAt: null });
    await this.repository.insert(challenge);
    await this.audit?.record({ action: "target.ownership_challenge.created", organizationId, targetId: challenge.id, targetType: "verification" });
    return { challenge, token };
  }

  async verify(organizationId: string, id: string, token: string, evidence?: string): Promise<OwnershipChallenge> {
    const organization = parseId("organization", organizationId);
    const challengeId = parseId("verification", id);
    // The expiry check and the terminal-state transition commit together, so
    // two concurrent proofs cannot both succeed and a proof presented at
    // exactly expiresAt is expired: the lifetime is exclusive.
    return this.repository.transact(async (repository) => {
      const challenge = await repository.get(organization, challengeId);
      if (!challenge) throw new Error("Ownership challenge not found.");
      if (challenge.status !== "pending") throw new Error("Ownership challenge is not pending.");
      if (this.clock().getTime() >= Date.parse(challenge.expiresAt)) {
        const expired = Object.freeze({ ...challenge, status: "expired" as const });
        await repository.update(expired);
        throw new Error("Ownership challenge has expired.");
      }
      if (!token || digest(token) !== challenge.tokenHash) throw new Error("Invalid ownership proof.");
      const verifiedAt = this.clock().toISOString();
      const verified = Object.freeze({ ...challenge, evidenceHash: evidence ? digest(evidence) : null, status: "verified" as const, verifiedAt });
      await repository.update(verified);
      await this.audit?.record({ action: "target.ownership_challenge.verified", organizationId, targetId: challenge.id, targetType: "verification" });
      return verified;
    });
  }

  /**
   * Issues a fresh challenge for the same target and method and moves the
   * previous challenge to a terminal state: `revoked` while it is still
   * current, `expired` once its lifetime has lapsed. The previous token is
   * never usable again, and renewing a verified or revoked challenge is
   * refused, so renewal can never revive expired proof material.
   */
  async renew(organizationId: string, id: string, options?: { readonly ttlSeconds?: number }): Promise<{ readonly challenge: OwnershipChallenge; readonly previous: OwnershipChallenge; readonly token: string }> {
    const organization = parseId("organization", organizationId);
    const challengeId = parseId("verification", id);
    const ttlSeconds = assertTtlSeconds(options?.ttlSeconds);
    return this.repository.transact(async (repository) => {
      const existing = await repository.get(organization, challengeId);
      if (!existing) throw new Error("Ownership challenge not found.");
      if (existing.status === "verified") throw new Error("Ownership challenge is already verified.");
      if (existing.status === "revoked") throw new Error("Ownership challenge is revoked.");
      const now = this.clock();
      const terminalStatus = existing.status === "pending"
        ? (now.getTime() >= Date.parse(existing.expiresAt) ? "expired" as const : "revoked" as const)
        : existing.status;
      const previous = terminalStatus === existing.status ? existing : Object.freeze({ ...existing, status: terminalStatus });
      if (previous !== existing) await repository.update(previous);
      const token = `rampverify_${randomBytes(24).toString("base64url")}`;
      const challenge: OwnershipChallenge = Object.freeze({ createdAt: now.toISOString(), evidenceHash: null, expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(), id: createId("verification"), method: existing.method, organizationId: existing.organizationId, status: "pending", targetId: existing.targetId, tokenHash: digest(token), verifiedAt: null });
      await repository.insert(challenge);
      await this.audit?.record({ action: "target.ownership_challenge.renewed", organizationId, targetId: existing.id, targetType: "verification" });
      await this.audit?.record({ action: "target.ownership_challenge.created", organizationId, targetId: challenge.id, targetType: "verification" });
      return { challenge, previous, token };
    });
  }

  async revoke(organizationId: string, id: string): Promise<void> {
    const organization = parseId("organization", organizationId);
    const challengeId = parseId("verification", id);
    await this.repository.transact(async (repository) => {
      const challenge = await repository.get(organization, challengeId);
      if (!challenge) throw new Error("Ownership challenge not found.");
      if (challenge.status === "pending") await repository.update(Object.freeze({ ...challenge, status: "revoked" as const }));
    });
    await this.audit?.record({ action: "target.ownership_challenge.revoked", organizationId, targetId: challengeId, targetType: "verification" });
  }

  list(organizationId: string, targetId: string): Promise<readonly OwnershipChallenge[]> { return this.repository.list(parseId("organization", organizationId), parseId("target", targetId)); }
}

export class InMemoryOwnershipRepository implements OwnershipRepository {
  private readonly challenges = new Map<string, OwnershipChallenge>();
  private queue: Promise<void> = Promise.resolve();
  insert(challenge: OwnershipChallenge): Promise<void> { if ([...this.challenges.values()].some((candidate) => candidate.organizationId === challenge.organizationId && candidate.targetId === challenge.targetId && candidate.method === challenge.method && candidate.status === "pending")) return Promise.reject(new Error("A pending challenge already exists.")); this.challenges.set(challenge.id, challenge); return Promise.resolve(); }
  get(organizationId: OpaqueId<"organization">, id: OpaqueId<"verification">): Promise<OwnershipChallenge | undefined> { const challenge = this.challenges.get(id); return Promise.resolve(challenge?.organizationId === organizationId ? challenge : undefined); }
  update(challenge: OwnershipChallenge): Promise<void> { this.challenges.set(challenge.id, challenge); return Promise.resolve(); }
  list(organizationId: OpaqueId<"organization">, targetId: OpaqueId<"target">): Promise<readonly OwnershipChallenge[]> { return Promise.resolve([...this.challenges.values()].filter((challenge) => challenge.organizationId === organizationId && challenge.targetId === targetId)); }
  transact<T>(work: (repository: OwnershipRepository) => Promise<T>): Promise<T> {
    // Serialize transactions through a promise chain. A failing transaction
    // still releases the queue so later work is not blocked behind it.
    const run = this.queue.then(() => work(this));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
