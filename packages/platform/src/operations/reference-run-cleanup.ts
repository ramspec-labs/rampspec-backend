import { createId, type OpaqueId } from "../../../domain/src/index.js";
import type { Organization } from "../api/organizations.js";
import { planReferenceRunCleanup, type CleanupFailure } from "./retention.js";

export interface ReferenceRunCleanupOptions {
  readonly clock?: () => Date;
  readonly referenceRunRepository?: ReferenceRunRepository;
}

export interface ReferenceRunRepository {
  listExpiredRuns(
    organizationId: OpaqueId<"organization">,
    beforeDate: string,
  ): Promise<readonly string[]>;
  deleteRun(runId: string): Promise<void>;
  recordCleanup(record: CleanupJobRecord): Promise<void>;
}

export interface CleanupJobRecord {
  readonly id: string;
  readonly organizationId: OpaqueId<"organization">;
  readonly jobType: "reference_run_retention";
  readonly status: "completed" | "failed";
  readonly retentionDays: number;
  readonly deletedCount: number;
  readonly durationMs: number;
  readonly errorMessage?: string;
  readonly lastRunAt: string;
  readonly nextRunAt: string;
  readonly createdAt: string;
}

export class ReferenceRunCleanupService {
  private readonly clock: () => Date;
  private readonly repository: ReferenceRunRepository;

  constructor(
    options: Required<Pick<ReferenceRunCleanupOptions, "referenceRunRepository">> &
      ReferenceRunCleanupOptions,
  ) {
    this.repository = options.referenceRunRepository;
    this.clock = options.clock ?? (() => new Date());
  }

  async executeCleanup(
    organization: Organization,
    maxDeletionsPerRun: number = 1000,
  ): Promise<{
    readonly deletedCount: number;
    readonly durationMs: number;
    readonly failures: readonly CleanupFailure[];
  }> {
    const startTime = Date.now();
    const deletionDeadline = new Date(
      this.clock().getTime() -
        organization.policy.evidenceRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const expiredRunIds = await this.repository.listExpiredRuns(
      organization.id,
      deletionDeadline,
    );

    const toDelete = expiredRunIds.slice(0, maxDeletionsPerRun);
    const failures: CleanupFailure[] = [];
    let deletedCount = 0;

    for (const runId of toDelete) {
      try {
        await this.repository.deleteRun(runId);
        deletedCount++;
      } catch (error) {
        failures.push({
          runId,
          reason:
            error instanceof Error
              ? error.message
              : "Unknown deletion error",
        });
      }
    }

    const durationMs = Date.now() - startTime;

    // Record the cleanup job without logging evidence content
    const cleanupRecord: CleanupJobRecord = Object.freeze({
      id: createId("cleanup"),
      organizationId: organization.id,
      jobType: "reference_run_retention",
      status: failures.length > 0 ? "failed" : "completed",
      retentionDays: organization.policy.evidenceRetentionDays,
      deletedCount,
      durationMs,
      ...(failures.length > 0
        ? {
            errorMessage: `${failures.length} deletion(s) failed; ${deletedCount} succeeded`,
          }
        : {}),
      lastRunAt: this.clock().toISOString(),
      nextRunAt: new Date(
        this.clock().getTime() + 24 * 60 * 60 * 1000,
      ).toISOString(),
      createdAt: this.clock().toISOString(),
    });

    await this.repository.recordCleanup(cleanupRecord);

    return {
      deletedCount,
      durationMs,
      failures,
    };
  }
}
