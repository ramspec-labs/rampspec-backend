import {
  DEFAULT_MISFIRE_POLICY,
  MAX_MISFIRE_CATCH_UP,
  isMisfirePolicy,
  resolveMisfire,
  type MisfirePolicy,
} from "./recurrence.js";
import type { Run, RunService } from "../runs/service.js";

export {
  DEFAULT_MISFIRE_POLICY,
  MAX_MISFIRE_CATCH_UP,
  misfirePolicies,
  type MisfirePolicy,
} from "./recurrence.js";

export interface MisfireRecord {
  readonly auditMetadata: Readonly<
    Record<string, boolean | number | string>
  >;
  readonly capped: boolean;
  readonly executionsDue: number;
  readonly missedOccurrences: number;
  readonly policy: MisfirePolicy;
  readonly recoveredAt: string;
}

export interface Schedule {
  readonly enabled: boolean;
  readonly id: string;
  readonly intervalSeconds: number;
  readonly lastMisfire: MisfireRecord | null;
  readonly maxCatchUp: number;
  readonly misfirePolicy: MisfirePolicy;
  readonly nextRunAt: string;
}

export interface MisfireRecovery {
  readonly auditMetadata: Readonly<
    Record<string, boolean | number | string>
  >;
  readonly capped: boolean;
  readonly executionsDue: number;
  readonly missedOccurrences: number;
  readonly nextRunAt: string;
  readonly policy: MisfirePolicy;
  readonly scheduleId: string;
}

export interface ScheduleOptions {
  readonly maxCatchUp?: number;
  readonly misfirePolicy?: MisfirePolicy;
}

const scheduleIdPattern = /^[a-z][a-z0-9_-]{2,63}$/u;

/**
 * Derive the stable occurrence key for one scheduled execution.
 *
 * The key is a pure function of the schedule id and the occurrence instant,
 * so every scheduler replica and every retry derives the same key for the
 * same occurrence. Used as the run idempotency key, it makes the run store
 * the unique-claim arbiter: at most one run exists per schedule occurrence,
 * and a duplicate claim returns the original run. The key stays within the
 * 16-128 character idempotency-key range and the OpenAPI key pattern.
 */
export function deriveOccurrenceKey(
  scheduleId: string,
  occurrenceAt: string | Date,
): string {
  if (!scheduleIdPattern.test(scheduleId)) throw new Error("Invalid schedule.");
  const occurrence =
    occurrenceAt instanceof Date ? occurrenceAt : new Date(occurrenceAt);
  if (Number.isNaN(occurrence.getTime())) throw new Error("Invalid occurrence.");
  return `schedule:${scheduleId}:${occurrence.toISOString()}`;
}

export interface OccurrenceClaim {
  /**
   * True when this call won the in-process claim for the occurrence.
   * False when this occurrence was already claimed here; the caller must
   * still resolve through the run claim, which returns the original run.
   */
  readonly claimed: boolean;
  readonly occurrenceAt: string;
  readonly occurrenceKey: string;
  readonly schedule: Schedule;
}

export interface ScheduledRunInput {
  readonly effectiveConfig: Readonly<Record<string, unknown>>;
  readonly organizationId: string;
  readonly projectId: string;
  readonly suiteId: string;
  readonly suiteVersion: string;
  readonly targetId: string;
}

export interface ScheduledRunResult {
  /** True when this call won the scheduler-level claim for the occurrence. */
  readonly claimed: boolean;
  /** True when this call created the run; false when it returned the original. */
  readonly created: boolean;
  readonly occurrenceAt: string;
  readonly occurrenceKey: string;
  readonly run: Run;
}

export class ScheduleService {
  private readonly schedules = new Map<string, Schedule>();
  private readonly claimedOccurrences = new Set<string>();
  private readonly clock: () => Date;

  constructor(options: { readonly clock?: () => Date } = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  create(
    id: string,
    intervalSeconds: number,
    options: ScheduleOptions = {},
  ): Schedule {
    if (
      !scheduleIdPattern.test(id) ||
      !Number.isInteger(intervalSeconds) ||
      intervalSeconds < 60 ||
      intervalSeconds > 31_536_000
    ) {
      throw new Error("Invalid schedule.");
    }
    const misfirePolicy = options.misfirePolicy ?? DEFAULT_MISFIRE_POLICY;
    if (!isMisfirePolicy(misfirePolicy)) {
      throw new Error("Invalid misfire policy.");
    }
    const maxCatchUp = options.maxCatchUp ?? MAX_MISFIRE_CATCH_UP;
    if (
      !Number.isInteger(maxCatchUp) ||
      maxCatchUp < 1 ||
      maxCatchUp > MAX_MISFIRE_CATCH_UP
    ) {
      throw new Error("Invalid misfire catch-up limit.");
    }
    const nextRunAt = new Date(
      this.clock().getTime() + intervalSeconds * 1000,
    ).toISOString();
    const schedule = Object.freeze({
      enabled: true,
      id,
      intervalSeconds,
      lastMisfire: null,
      maxCatchUp,
      misfirePolicy,
      nextRunAt,
    });
    this.schedules.set(id, schedule);
    return schedule;
  }

  get(id: string): Schedule {
    const schedule = this.schedules.get(id);
    if (!schedule) throw new Error("Schedule not found.");
    return schedule;
  }

  disable(id: string): Schedule {
    const schedule = this.get(id);
    const updated = Object.freeze({ ...schedule, enabled: false });
    this.schedules.set(id, updated);
    return updated;
  }

  /**
   * Applies the schedule's misfire policy after downtime. Deterministic for
   * a given clock reading: the same recovery instant always yields the same
   * missed count, executions due, and next run. The returned audit metadata
   * records the selected policy and missed occurrence count for the audit
   * trail; the service itself executes nothing, so catch-up stays bounded
   * and cannot burst. A second recovery at the same instant is a no-op:
   * the next run already lies in the future, so zero occurrences are missed.
   */
  recover(id: string, now: Date = this.clock()): MisfireRecovery {
    const schedule = this.get(id);
    if (!schedule.enabled) throw new Error("Schedule is disabled.");
    const resolution = resolveMisfire({
      firstDueAt: new Date(schedule.nextRunAt),
      intervalSeconds: schedule.intervalSeconds,
      maxCatchUp: schedule.maxCatchUp,
      now,
      policy: schedule.misfirePolicy,
    });
    const auditMetadata = Object.freeze({
      executions_due: resolution.executionsDue,
      misfire_capped: resolution.capped,
      misfire_policy: resolution.policy,
      missed_occurrences: resolution.missedOccurrences,
      schedule_id: schedule.id,
    });
    const record = Object.freeze({
      auditMetadata,
      capped: resolution.capped,
      executionsDue: resolution.executionsDue,
      missedOccurrences: resolution.missedOccurrences,
      policy: resolution.policy,
      recoveredAt: now.toISOString(),
    });
    this.schedules.set(
      id,
      Object.freeze({
        ...schedule,
        lastMisfire: record,
        nextRunAt: resolution.nextRunAt.toISOString(),
      }),
    );
    return Object.freeze({
      auditMetadata,
      capped: resolution.capped,
      executionsDue: resolution.executionsDue,
      missedOccurrences: resolution.missedOccurrences,
      nextRunAt: resolution.nextRunAt.toISOString(),
      policy: resolution.policy,
      scheduleId: schedule.id,
    });
  }

  /** Enabled schedules whose next occurrence is due at `now`. */
  due(now: Date = this.clock()): Schedule[] {
    const nowTime = now.getTime();
    return [...this.schedules.values()].filter(
      (schedule) =>
        schedule.enabled && new Date(schedule.nextRunAt).getTime() <= nowTime,
    );
  }

  /**
   * Claim one schedule occurrence for execution.
   *
   * The occurrence defaults to the schedule's next run and must match it:
   * only the due occurrence can be claimed, never a future or skipped one.
   * Claiming records the occurrence key in this process so a second local
   * trigger reports `claimed: false`. Claiming never advances `nextRunAt`:
   * the schedule advances only once the run claim succeeds (see
   * {@link advance}), so a crash or failed run claim leaves the occurrence
   * due and the next sweep retries it idempotently.
   */
  claimOccurrence(id: string, occurrenceAt?: string | Date): OccurrenceClaim {
    const schedule = this.schedules.get(id);
    if (!schedule) throw new Error("Schedule not found.");
    if (!schedule.enabled) throw new Error("Schedule is disabled.");
    const occurrence = canonicalOccurrence(occurrenceAt ?? schedule.nextRunAt);
    if (occurrence !== schedule.nextRunAt) {
      throw new Error("Invalid occurrence.");
    }
    const occurrenceKey = deriveOccurrenceKey(id, occurrence);
    if (this.claimedOccurrences.has(occurrenceKey)) {
      return {
        claimed: false,
        occurrenceAt: occurrence,
        occurrenceKey,
        schedule,
      };
    }
    this.claimedOccurrences.add(occurrenceKey);
    return {
      claimed: true,
      occurrenceAt: occurrence,
      occurrenceKey,
      schedule,
    };
  }

  /**
   * Move a schedule past one occurrence, exactly one interval forward.
   *
   * Idempotent: when `nextRunAt` already passed the occurrence (another
   * replica advanced it, or this call is a retry), the schedule is returned
   * unchanged. An occurrence after `nextRunAt` is rejected so a schedule
   * can never skip an unclaimed occurrence.
   */
  advance(id: string, occurrenceAt: string | Date): Schedule {
    const schedule = this.schedules.get(id);
    if (!schedule) throw new Error("Schedule not found.");
    const occurrence = canonicalOccurrence(occurrenceAt);
    const nextRunTime = new Date(schedule.nextRunAt).getTime();
    const occurrenceTime = new Date(occurrence).getTime();
    if (occurrenceTime > nextRunTime) throw new Error("Invalid occurrence.");
    if (occurrenceTime < nextRunTime) return schedule;
    const advanced = Object.freeze({
      ...schedule,
      nextRunAt: new Date(
        occurrenceTime + schedule.intervalSeconds * 1000,
      ).toISOString(),
    });
    this.schedules.set(id, advanced);
    this.pruneClaimedOccurrences(id, advanced.nextRunAt);
    return advanced;
  }

  private pruneClaimedOccurrences(scheduleId: string, nextRunAt: string): void {
    const prefix = `schedule:${scheduleId}:`;
    for (const key of this.claimedOccurrences) {
      // ISO-8601 UTC timestamps sort chronologically as strings.
      if (key.startsWith(prefix) && key.slice(prefix.length) < nextRunAt) {
        this.claimedOccurrences.delete(key);
      }
    }
  }
}

function canonicalOccurrence(occurrenceAt: string | Date): string {
  const occurrence =
    occurrenceAt instanceof Date ? occurrenceAt : new Date(occurrenceAt);
  if (Number.isNaN(occurrence.getTime())) throw new Error("Invalid occurrence.");
  return occurrence.toISOString();
}

/**
 * Triggers due schedule occurrences as runs, with at most one run per
 * occurrence. The run store's atomic claim is the cross-process arbiter:
 * concurrent triggers and failover replicas all derive the same occurrence
 * key, so exactly one of them creates the run and the rest receive the
 * original run reference.
 */
export class ScheduledRunTrigger {
  private readonly runs: RunService;
  private readonly schedules: ScheduleService;

  constructor(options: {
    readonly runs: RunService;
    readonly schedules: ScheduleService;
  }) {
    this.runs = options.runs;
    this.schedules = options.schedules;
  }

  async trigger(
    scheduleId: string,
    input: ScheduledRunInput,
  ): Promise<ScheduledRunResult> {
    const claim = this.schedules.claimOccurrence(scheduleId);
    const { created, run } = await this.runs.createClaim({
      ...input,
      idempotencyKey: claim.occurrenceKey,
    });
    this.schedules.advance(scheduleId, claim.occurrenceAt);
    return {
      claimed: claim.claimed,
      created,
      occurrenceAt: claim.occurrenceAt,
      occurrenceKey: claim.occurrenceKey,
      run,
    };
  }
}
