export interface RetentionArtifact {
  readonly id: string;
  readonly expiresAt: string;
  readonly status: "deleted" | "finalized" | "pending";
}

export interface ReferenceRun {
  readonly id: string;
  readonly organizationId: string;
  readonly createdAt: string;
  readonly state: "completed" | "failed" | "running" | "pending";
}

export interface CleanupResult {
  readonly deletedCount: number;
  readonly durationMs: number;
  readonly failures: readonly CleanupFailure[];
}

export interface CleanupFailure {
  readonly runId: string;
  readonly reason: string;
}

export function planPurge(
  artifacts: readonly RetentionArtifact[],
  now: Date = new Date(),
): readonly string[] {
  return artifacts
    .filter(
      (artifact) =>
        artifact.status !== "deleted" &&
        Date.parse(artifact.expiresAt) <= now.getTime(),
    )
    .map((artifact) => artifact.id);
}

export function planReferenceRunCleanup(
  runs: readonly ReferenceRun[],
  retentionDays: number,
  now: Date = new Date(),
): readonly string[] {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("Retention days must be a positive integer.");
  }

  const expirationTime =
    now.getTime() - retentionDays * 24 * 60 * 60 * 1000;

  return runs
    .filter(
      (run) =>
        (run.state === "completed" || run.state === "failed") &&
        Date.parse(run.createdAt) <= expirationTime,
    )
    .map((run) => run.id);
}
