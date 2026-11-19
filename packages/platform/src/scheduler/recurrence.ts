export function nextRun(after: Date, intervalMinutes: number) { if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) throw new Error("Invalid recurrence."); return new Date(after.getTime() + intervalMinutes * 60_000); }

export const misfirePolicies = ["skip", "run-once", "catch-up"] as const;
export type MisfirePolicy = (typeof misfirePolicies)[number];

/** Default policy: missed runs are dropped, never replayed. */
export const DEFAULT_MISFIRE_POLICY: MisfirePolicy = "skip";

/**
 * Hard bound on catch-up executions from a single recovery. Catch-up can
 * never replay more than this many missed occurrences, so a long outage
 * cannot create an unreviewed burst of executions.
 */
export const MAX_MISFIRE_CATCH_UP = 10;

export function isMisfirePolicy(value: unknown): value is MisfirePolicy {
  return (
    typeof value === "string" &&
    (misfirePolicies as readonly string[]).includes(value)
  );
}

function assertIntervalSeconds(intervalSeconds: number): void {
  if (
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < 60 ||
    intervalSeconds > 31_536_000
  ) {
    throw new Error("Invalid recurrence.");
  }
}

/**
 * Counts scheduled occurrences at `firstDueAt + k * interval` (k >= 0) that
 * fall at or before `now`. An occurrence exactly at `now` counts as missed:
 * the run was due and did not execute. Returns 0 when `now` precedes the
 * first due occurrence.
 */
export function countMissedOccurrences(
  firstDueAt: Date,
  now: Date,
  intervalSeconds: number,
): number {
  assertIntervalSeconds(intervalSeconds);
  const elapsedMs = now.getTime() - firstDueAt.getTime();
  if (elapsedMs < 0) return 0;
  return Math.floor(elapsedMs / (intervalSeconds * 1000)) + 1;
}

/** First scheduled occurrence strictly after `now`. */
export function nextOccurrenceAfter(
  firstDueAt: Date,
  now: Date,
  intervalSeconds: number,
): Date {
  assertIntervalSeconds(intervalSeconds);
  const missed = countMissedOccurrences(firstDueAt, now, intervalSeconds);
  return new Date(
    firstDueAt.getTime() + missed * intervalSeconds * 1000,
  );
}

export interface MisfireResolution {
  readonly capped: boolean;
  readonly executionsDue: number;
  readonly missedOccurrences: number;
  readonly nextRunAt: Date;
  readonly policy: MisfirePolicy;
}

export function resolveMisfire(input: {
  readonly firstDueAt: Date;
  readonly intervalSeconds: number;
  readonly maxCatchUp?: number;
  readonly now: Date;
  readonly policy: MisfirePolicy;
}): MisfireResolution {
  if (!isMisfirePolicy(input.policy)) {
    throw new Error("Invalid misfire policy.");
  }
  const maxCatchUp = input.maxCatchUp ?? MAX_MISFIRE_CATCH_UP;
  if (
    !Number.isInteger(maxCatchUp) ||
    maxCatchUp < 1 ||
    maxCatchUp > MAX_MISFIRE_CATCH_UP
  ) {
    throw new Error("Invalid misfire catch-up limit.");
  }
  const missedOccurrences = countMissedOccurrences(
    input.firstDueAt,
    input.now,
    input.intervalSeconds,
  );
  const executionsDue =
    input.policy === "skip"
      ? 0
      : input.policy === "run-once"
        ? Math.min(missedOccurrences, 1)
        : Math.min(missedOccurrences, maxCatchUp);
  const capped =
    input.policy === "catch-up" && missedOccurrences > maxCatchUp;
  return Object.freeze({
    capped,
    executionsDue,
    missedOccurrences,
    nextRunAt: nextOccurrenceAfter(
      input.firstDueAt,
      input.now,
      input.intervalSeconds,
    ),
    policy: input.policy,
  });
}
