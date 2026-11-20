import { randomUUID } from "node:crypto";

import {
  authorize,
  type AuthorizationActor,
} from "../auth/authorization.js";

export interface Schedule {
  readonly enabled: boolean;
  readonly id: string;
  readonly intervalSeconds: number;
  readonly nextRunAt: string;
}

/**
 * A scheduler lease grants one scheduler instance exclusive ownership of a
 * schedule for the duration of one job. The lease is a compare-and-set
 * record: every renewal or release must present the owning scheduler's id,
 * the current token, and the current version. A renewal that presents a
 * stale token or version fails instead of extending a lease another
 * scheduler has taken over.
 */
export interface SchedulerLease {
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly organizationId: string;
  readonly ownerId: string;
  readonly renewalCount: number;
  readonly renewedAt?: string;
  readonly scheduleId: string;
  readonly token: string;
  readonly version: number;
}

export type SchedulerLeaseEventType =
  | "job.aborted"
  | "job.completed"
  | "lease.acquired"
  | "lease.expired"
  | "lease.renewal_failed"
  | "lease.renewed"
  | "lease.released";

export interface SchedulerLeaseEvent {
  readonly at: string;
  readonly leaseVersion?: number;
  readonly organizationId: string;
  readonly ownerId: string;
  readonly reason?: string;
  readonly scheduleId: string;
  readonly type: SchedulerLeaseEventType;
}

/** The compare-and-set identity a caller must present to renew or release. */
export interface LeaseOwner {
  readonly ownerId: string;
  readonly scheduleId: string;
  readonly token: string;
  readonly version: number;
}

/**
 * Durable lease storage. The compare-and-set methods must be atomic against
 * the backing store: a SQL implementation performs them as a single
 * `UPDATE ... WHERE owner_id = $1 AND token = $2 AND version = $3 AND
 * expires_at > now()` (or the equivalent delete), so two schedulers can
 * never both win a renewal.
 */
export interface SchedulerLeaseStore {
  compareAndDelete(expected: LeaseOwner): Promise<boolean>;
  compareAndSwap(
    expected: LeaseOwner,
    next: SchedulerLease,
  ): Promise<boolean>;
  find(scheduleId: string): Promise<SchedulerLease | undefined>;
  insert(lease: SchedulerLease): Promise<boolean>;
}

export class InMemorySchedulerLeaseStore implements SchedulerLeaseStore {
  private readonly clock: () => Date;
  private readonly leases = new Map<string, SchedulerLease>();

  constructor(options: { readonly clock?: () => Date } = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  compareAndDelete(expected: LeaseOwner): Promise<boolean> {
    const current = this.leases.get(expected.scheduleId);
    if (!current) return Promise.resolve(false);
    if (
      current.ownerId !== expected.ownerId ||
      current.token !== expected.token ||
      current.version !== expected.version
    ) {
      return Promise.resolve(false);
    }
    this.leases.delete(expected.scheduleId);
    return Promise.resolve(true);
  }

  compareAndSwap(
    expected: LeaseOwner,
    next: SchedulerLease,
  ): Promise<boolean> {
    const current = this.leases.get(next.scheduleId);
    if (!current) return Promise.resolve(false);
    if (
      current.ownerId !== expected.ownerId ||
      current.token !== expected.token ||
      current.version !== expected.version
    ) {
      return Promise.resolve(false);
    }
    if (
      new Date(current.expiresAt).getTime() <= this.clock().getTime()
    ) {
      return Promise.resolve(false);
    }
    this.leases.set(next.scheduleId, next);
    return Promise.resolve(true);
  }

  find(scheduleId: string): Promise<SchedulerLease | undefined> {
    return Promise.resolve(this.leases.get(scheduleId));
  }

  insert(lease: SchedulerLease): Promise<boolean> {
    const existing = this.leases.get(lease.scheduleId);
    if (
      existing &&
      new Date(existing.expiresAt).getTime() > this.clock().getTime()
    ) {
      return Promise.resolve(false);
    }
    this.leases.set(lease.scheduleId, lease);
    return Promise.resolve(true);
  }
}

export type LeaseAcquisition =
  | { readonly acquired: true; readonly lease: SchedulerLease }
  | {
      readonly acquired: false;
      readonly expiresAt: string;
      readonly ownerId: string;
      readonly reason: "already_leased";
    };

export type LeaseRenewalOutcome =
  | { readonly lease: SchedulerLease; readonly renewed: true }
  | {
      readonly reason: "expired" | "not_found" | "ownership_changed" | "stale_token";
      readonly renewed: false;
    };

export type LeaseReleaseOutcome =
  | { readonly released: true }
  | {
      readonly reason: "not_found" | "ownership_changed" | "stale_token";
      readonly released: false;
    };

export interface AcquireSchedulerLeaseInput {
  readonly actor: AuthorizationActor;
  readonly leaseTtlSeconds: number;
  readonly organizationId: string;
  readonly ownerId: string;
  readonly scheduleId: string;
}

export interface RenewSchedulerLeaseInput {
  readonly actor: AuthorizationActor;
  readonly leaseTtlSeconds: number;
  readonly organizationId: string;
  readonly ownerId: string;
  readonly scheduleId: string;
  readonly token: string;
}

export interface ReleaseSchedulerLeaseInput {
  readonly actor: AuthorizationActor;
  readonly organizationId: string;
  readonly ownerId: string;
  readonly scheduleId: string;
  readonly token: string;
}

export interface RunLeasedJobInput<T> {
  readonly actor: AuthorizationActor;
  readonly job: (signal: AbortSignal) => Promise<T>;
  readonly leaseTtlSeconds: number;
  readonly maxDurationMs?: number;
  readonly maxRenewals?: number;
  readonly organizationId: string;
  readonly ownerId: string;
  readonly renewalIntervalMs: number;
  readonly scheduleId: string;
}

export type LeasedJobOutcome<T> =
  | {
      readonly completed: true;
      readonly lease: SchedulerLease;
      readonly renewals: number;
      readonly result: T;
    }
  | {
      readonly completed: false;
      readonly error?: unknown;
      readonly reason:
        | "already_leased"
        | "job_failed"
        | "lease_lost"
        | "max_duration"
        | "max_renewals";
      readonly renewals: number;
    };

/** Lease TTL bounds in seconds: long enough to survive a slow tick, short enough to bound takeover delay. */
export const minimumLeaseTtlSeconds = 30;
export const maximumLeaseTtlSeconds = 3600;
/** Default cap on renewals per leased job, so a runaway job cannot renew forever. */
export const defaultMaxLeaseRenewals = 100;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

export class ScheduleService {
  private readonly clock: () => Date;
  private readonly leaseStore: SchedulerLeaseStore;
  private readonly onLeaseEvent: (event: SchedulerLeaseEvent) => void;
  private readonly schedules = new Map<string, Schedule>();
  private readonly tokenFactory: () => string;

  constructor(options: {
    readonly clock?: () => Date;
    readonly leaseStore?: SchedulerLeaseStore;
    readonly onLeaseEvent?: (event: SchedulerLeaseEvent) => void;
    readonly tokenFactory?: () => string;
  } = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.leaseStore =
      options.leaseStore ??
      new InMemorySchedulerLeaseStore({ clock: this.clock });
    this.onLeaseEvent = options.onLeaseEvent ?? (() => undefined);
    this.tokenFactory = options.tokenFactory ?? (() => randomUUID());
  }

  create(id: string, intervalSeconds: number): Schedule {
    if (
      !/^[a-z][a-z0-9_-]{2,63}$/u.test(id) ||
      !Number.isInteger(intervalSeconds) ||
      intervalSeconds < 60 ||
      intervalSeconds > 31_536_000
    )
      throw new Error("Invalid schedule.");
    const nextRunAt = new Date(
      this.clock().getTime() + intervalSeconds * 1000,
    ).toISOString();
    const schedule = Object.freeze({
      enabled: true,
      id,
      intervalSeconds,
      nextRunAt,
    });
    this.schedules.set(id, schedule);
    return schedule;
  }

  disable(id: string): Schedule {
    const schedule = this.schedules.get(id);
    if (!schedule) throw new Error("Schedule not found.");
    const updated = Object.freeze({ ...schedule, enabled: false });
    this.schedules.set(id, updated);
    return updated;
  }

  /**
   * Acquires exclusive ownership of a schedule for one job. A second
   * scheduler (or the same scheduler re-acquiring) receives
   * `already_leased` instead of a second token, so at most one owner can
   * hold a live lease. An expired lease may be taken over.
   *
   * Disabling a schedule stops new acquisitions; it does not revoke a
   * lease that is already held, so in-flight work runs to completion or
   * lease expiry.
   */
  async acquireLease(
    input: AcquireSchedulerLeaseInput,
  ): Promise<LeaseAcquisition> {
    this.authorizeLease(input.actor, input.organizationId, input.organizationId);
    this.validateLeaseTtl(input.leaseTtlSeconds);
    this.validateOwnerId(input.ownerId);
    const schedule = this.schedules.get(input.scheduleId);
    if (!schedule) throw new Error("Schedule not found.");
    if (!schedule.enabled) throw new Error("Schedule is disabled.");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const now = this.clock();
      const existing = await this.leaseStore.find(input.scheduleId);
      if (existing && !this.isExpired(existing, now)) {
        return {
          acquired: false,
          expiresAt: existing.expiresAt,
          ownerId: existing.ownerId,
          reason: "already_leased",
        };
      }
      const lease: SchedulerLease = Object.freeze({
        acquiredAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() + input.leaseTtlSeconds * 1000,
        ).toISOString(),
        organizationId: input.organizationId,
        ownerId: input.ownerId,
        renewalCount: 0,
        scheduleId: input.scheduleId,
        token: this.tokenFactory(),
        version: 1,
      });
      if (await this.leaseStore.insert(lease)) {
        this.emit({
          at: now.toISOString(),
          leaseVersion: lease.version,
          organizationId: input.organizationId,
          ownerId: input.ownerId,
          scheduleId: input.scheduleId,
          type: "lease.acquired",
        });
        return { acquired: true, lease };
      }
    }
    const latest = await this.leaseStore.find(input.scheduleId);
    if (latest && !this.isExpired(latest, this.clock())) {
      return {
        acquired: false,
        expiresAt: latest.expiresAt,
        ownerId: latest.ownerId,
        reason: "already_leased",
      };
    }
    throw new Error("Lease acquisition failed.");
  }

  /**
   * Renews a lease with compare-and-set semantics: the renewal succeeds
   * only when the caller still owns the lease with the expected token and
   * version and the lease has not expired. Any other outcome leaves the
   * stored lease untouched and the caller must stop its work.
   */
  async renewLease(
    input: RenewSchedulerLeaseInput,
  ): Promise<LeaseRenewalOutcome> {
    this.authorizeLease(input.actor, input.organizationId, input.organizationId);
    this.validateLeaseTtl(input.leaseTtlSeconds);
    this.validateOwnerId(input.ownerId);
    this.validateToken(input.token);
    const now = this.clock();
    const current = await this.leaseStore.find(input.scheduleId);
    if (!current) {
      return { reason: "not_found", renewed: false };
    }
    this.authorizeLease(
      input.actor,
      input.organizationId,
      current.organizationId,
    );
    if (current.ownerId !== input.ownerId) {
      return this.renewalFailed(input, "ownership_changed");
    }
    if (current.token !== input.token) {
      return this.renewalFailed(input, "stale_token");
    }
    if (this.isExpired(current, now)) {
      this.emit({
        at: now.toISOString(),
        leaseVersion: current.version,
        organizationId: current.organizationId,
        ownerId: current.ownerId,
        reason: "expired",
        scheduleId: input.scheduleId,
        type: "lease.expired",
      });
      return { reason: "expired", renewed: false };
    }
    const next: SchedulerLease = Object.freeze({
      ...current,
      expiresAt: new Date(
        now.getTime() + input.leaseTtlSeconds * 1000,
      ).toISOString(),
      renewalCount: current.renewalCount + 1,
      renewedAt: now.toISOString(),
      version: current.version + 1,
    });
    const swapped = await this.leaseStore.compareAndSwap(
      {
        ownerId: current.ownerId,
        scheduleId: current.scheduleId,
        token: current.token,
        version: current.version,
      },
      next,
    );
    if (swapped) {
      this.emit({
        at: now.toISOString(),
        leaseVersion: next.version,
        organizationId: next.organizationId,
        ownerId: next.ownerId,
        scheduleId: input.scheduleId,
        type: "lease.renewed",
      });
      return { lease: next, renewed: true };
    }
    const reason = await this.renewalFailureReason(input, current);
    if (reason === "expired") {
      this.emit({
        at: this.clock().toISOString(),
        leaseVersion: current.version,
        organizationId: current.organizationId,
        ownerId: current.ownerId,
        reason: "expired",
        scheduleId: input.scheduleId,
        type: "lease.expired",
      });
      return { reason: "expired", renewed: false };
    }
    if (reason === "not_found") {
      return { reason: "not_found", renewed: false };
    }
    return this.renewalFailed(input, reason);
  }

  /**
   * Releases a lease with compare-and-set semantics. Only the owner
   * holding the current token and version can release; a stale token or a
   * transferred lease is left untouched.
   */
  async releaseLease(
    input: ReleaseSchedulerLeaseInput,
  ): Promise<LeaseReleaseOutcome> {
    this.authorizeLease(input.actor, input.organizationId, input.organizationId);
    this.validateOwnerId(input.ownerId);
    this.validateToken(input.token);
    const current = await this.leaseStore.find(input.scheduleId);
    if (!current) {
      return { reason: "not_found", released: false };
    }
    this.authorizeLease(
      input.actor,
      input.organizationId,
      current.organizationId,
    );
    if (current.ownerId !== input.ownerId) {
      return { reason: "ownership_changed", released: false };
    }
    if (current.token !== input.token) {
      return { reason: "stale_token", released: false };
    }
    const deleted = await this.leaseStore.compareAndDelete({
      ownerId: current.ownerId,
      scheduleId: current.scheduleId,
      token: current.token,
      version: current.version,
    });
    if (deleted) {
      this.emit({
        at: this.clock().toISOString(),
        leaseVersion: current.version,
        organizationId: current.organizationId,
        ownerId: current.ownerId,
        scheduleId: input.scheduleId,
        type: "lease.released",
      });
      return { released: true };
    }
    const latest = await this.leaseStore.find(input.scheduleId);
    if (!latest) return { reason: "not_found", released: false };
    if (latest.ownerId !== input.ownerId) {
      return { reason: "ownership_changed", released: false };
    }
    return { reason: "stale_token", released: false };
  }

  /**
   * Runs one job under a lease: acquires exclusive ownership, renews the
   * lease while the job is active, and aborts the job when a renewal fails
   * or ownership changes. A completion event is emitted only when the
   * caller still owns the lease at the moment the job finishes, so a job
   * that lost ownership can never emit an orphaned completion event. The
   * lease is released when the job settles, whether it completed, failed,
   * or was aborted. Renewals and total runtime are bounded by
   * `maxRenewals` and `maxDurationMs`.
   */
  async runLeasedJob<T>(
    input: RunLeasedJobInput<T>,
  ): Promise<LeasedJobOutcome<T>> {
    this.validateLeaseTtl(input.leaseTtlSeconds);
    if (
      !Number.isInteger(input.renewalIntervalMs) ||
      input.renewalIntervalMs <= 0 ||
      input.renewalIntervalMs >= input.leaseTtlSeconds * 1000
    ) {
      throw new Error("Lease renewal interval must be shorter than the lease TTL.");
    }
    const maxRenewals = input.maxRenewals ?? defaultMaxLeaseRenewals;
    if (!Number.isInteger(maxRenewals) || maxRenewals < 0) {
      throw new Error("Invalid maximum lease renewals.");
    }
    const maxDurationMs =
      input.maxDurationMs ?? (maxRenewals + 1) * input.leaseTtlSeconds * 1000;
    if (!Number.isInteger(maxDurationMs) || maxDurationMs <= 0) {
      throw new Error("Invalid maximum leased job duration.");
    }
    if (typeof input.job !== "function") {
      throw new Error("Leased job is required.");
    }

    const acquisition = await this.acquireLease({
      actor: input.actor,
      leaseTtlSeconds: input.leaseTtlSeconds,
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      scheduleId: input.scheduleId,
    });
    if (!acquisition.acquired) {
      return { completed: false, reason: "already_leased", renewals: 0 };
    }

    let lease = acquisition.lease;
    let renewals = 0;
    const controller = new AbortController();
    const startMs = this.clock().getTime();
    const deadlineMs = startMs + maxDurationMs;
    let lastRenewalMs = startMs;
    let jobSettled:
      | { readonly error: unknown; readonly status: "rejected" }
      | { readonly result: T; readonly status: "resolved" }
      | undefined;
    let jobPromise: Promise<T>;
    try {
      jobPromise = Promise.resolve(input.job(controller.signal));
    } catch (error) {
      jobPromise = Promise.reject(
        error instanceof Error
          ? error
          : new Error("Leased job threw a non-Error value.", { cause: error }),
      );
    }
    const jobDone = jobPromise.then(
      (result) => {
        jobSettled = { result, status: "resolved" };
      },
      (error: unknown) => {
        jobSettled = { error, status: "rejected" };
      },
    );

    let outcome: LeasedJobOutcome<T> | undefined;
    try {
      while (jobSettled === undefined && outcome === undefined) {
        const nowMs = this.clock().getTime();
        const waitMs = Math.min(
          Math.max(lastRenewalMs + input.renewalIntervalMs - nowMs, 0),
          Math.max(deadlineMs - nowMs, 0),
        );
        await Promise.race([jobDone, sleep(waitMs)]);
        if (jobSettled !== undefined) break;
        const afterMs = this.clock().getTime();
        if (afterMs >= deadlineMs) {
          controller.abort();
          await jobDone;
          this.emitJobAborted(input, lease, "max_duration");
          outcome = { completed: false, reason: "max_duration", renewals };
          break;
        }
        if (renewals >= maxRenewals) {
          controller.abort();
          await jobDone;
          this.emitJobAborted(input, lease, "max_renewals");
          outcome = { completed: false, reason: "max_renewals", renewals };
          break;
        }
        if (afterMs < lastRenewalMs + input.renewalIntervalMs) continue;
        const renewed = await this.renewLease({
          actor: input.actor,
          leaseTtlSeconds: input.leaseTtlSeconds,
          organizationId: input.organizationId,
          ownerId: input.ownerId,
          scheduleId: input.scheduleId,
          token: lease.token,
        });
        if (!renewed.renewed) {
          controller.abort();
          await jobDone;
          this.emitJobAborted(input, lease, "lease_lost");
          outcome = { completed: false, reason: "lease_lost", renewals };
          break;
        }
        lease = renewed.lease;
        renewals += 1;
        lastRenewalMs = this.clock().getTime();
      }

      if (outcome === undefined) {
        if (jobSettled?.status === "resolved") {
          const current = await this.leaseStore.find(input.scheduleId);
          const stillOwner =
            current !== undefined &&
            current.ownerId === input.ownerId &&
            current.token === lease.token &&
            current.version === lease.version &&
            !this.isExpired(current, this.clock());
          if (stillOwner) {
            this.emit({
              at: this.clock().toISOString(),
              leaseVersion: lease.version,
              organizationId: input.organizationId,
              ownerId: input.ownerId,
              scheduleId: input.scheduleId,
              type: "job.completed",
            });
            outcome = {
              completed: true,
              lease,
              renewals,
              result: jobSettled.result,
            };
          } else {
            this.emitJobAborted(input, lease, "lease_lost");
            outcome = { completed: false, reason: "lease_lost", renewals };
          }
        } else {
          this.emitJobAborted(input, lease, "job_failed");
          outcome = {
            completed: false,
            ...(jobSettled === undefined
              ? {}
              : { error: jobSettled.error }),
            reason: "job_failed",
            renewals,
          };
        }
      }
      return outcome;
    } finally {
      await this.releaseLease({
        actor: input.actor,
        organizationId: input.organizationId,
        ownerId: input.ownerId,
        scheduleId: input.scheduleId,
        token: lease.token,
      }).catch(() => undefined);
    }
  }

  private authorizeLease(
    actor: AuthorizationActor,
    organizationId: string,
    resourceOrganizationId: string,
  ): void {
    authorize({
      action: "schedule.lease",
      actor,
      organizationId,
      resourceOrganizationId,
    });
  }

  private emit(event: SchedulerLeaseEvent): void {
    try {
      this.onLeaseEvent(event);
    } catch {
      // Observability must never break lease handling.
    }
  }

  private emitJobAborted(
    input: {
      readonly organizationId: string;
      readonly ownerId: string;
      readonly scheduleId: string;
    },
    lease: SchedulerLease,
    reason: string,
  ): void {
    this.emit({
      at: this.clock().toISOString(),
      leaseVersion: lease.version,
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      reason,
      scheduleId: input.scheduleId,
      type: "job.aborted",
    });
  }

  private isExpired(lease: SchedulerLease, now: Date): boolean {
    return new Date(lease.expiresAt).getTime() <= now.getTime();
  }

  private renewalFailed(
    input: RenewSchedulerLeaseInput,
    reason: "ownership_changed" | "stale_token",
  ): LeaseRenewalOutcome {
    this.emit({
      at: this.clock().toISOString(),
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      reason,
      scheduleId: input.scheduleId,
      type: "lease.renewal_failed",
    });
    return { reason, renewed: false };
  }

  private async renewalFailureReason(
    input: RenewSchedulerLeaseInput,
    previous: SchedulerLease,
  ): Promise<"expired" | "not_found" | "ownership_changed" | "stale_token"> {
    const current = await this.leaseStore.find(input.scheduleId);
    if (!current) return "not_found";
    if (this.isExpired(current, this.clock())) return "expired";
    if (current.ownerId !== previous.ownerId) return "ownership_changed";
    return "stale_token";
  }

  private validateLeaseTtl(leaseTtlSeconds: number): void {
    if (
      !Number.isInteger(leaseTtlSeconds) ||
      leaseTtlSeconds < minimumLeaseTtlSeconds ||
      leaseTtlSeconds > maximumLeaseTtlSeconds
    ) {
      throw new Error("Invalid lease TTL.");
    }
  }

  private validateOwnerId(ownerId: string): void {
    if (
      typeof ownerId !== "string" ||
      ownerId.trim().length === 0 ||
      ownerId.length > 128
    ) {
      throw new Error("Invalid lease owner.");
    }
  }

  private validateToken(token: string): void {
    if (
      typeof token !== "string" ||
      token.trim().length === 0 ||
      token.length > 128
    ) {
      throw new Error("Invalid lease token.");
    }
  }
}
