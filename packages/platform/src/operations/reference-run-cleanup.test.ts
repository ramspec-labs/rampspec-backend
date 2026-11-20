import { describe, expect, it } from "vitest";
import type { Organization } from "../api/organizations.js";
import type { CleanupJobRecord, ReferenceRunRepository } from "./reference-run-cleanup.js";
import { ReferenceRunCleanupService } from "./reference-run-cleanup.js";

const mockOrganization: Organization = {
  id: "organization_12345678-1234-4000-8000-123456789012",
  name: "Test Org",
  slug: "test-org",
  ownerUserId: "user_1",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  policy: {
    allowPubnet: false,
    evidenceRetentionDays: 30,
  },
};

describe("ReferenceRunCleanupService", () => {
  it("deletes expired runs and records cleanup metrics", async () => {
    const expiredIds = [
      "run_aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa",
      "run_bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb",
    ];
    const deletedRuns: string[] = [];
    const recordedCleanups: CleanupJobRecord[] = [];

    const repository: ReferenceRunRepository = {
      async listExpiredRuns(orgId, beforeDate) {
        expect(orgId).toBe(mockOrganization.id);
        expect(beforeDate).toBeDefined();
        return expiredIds;
      },
      async deleteRun(runId) {
        deletedRuns.push(runId);
      },
      async recordCleanup(record) {
        recordedCleanups.push(record);
      },
    };

    const service = new ReferenceRunCleanupService({
      referenceRunRepository: repository,
      clock: () => new Date("2026-12-01T00:00:00.000Z"),
    });

    const result = await service.executeCleanup(mockOrganization);

    expect(result.deletedCount).toBe(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.failures).toHaveLength(0);
    expect(deletedRuns).toEqual(expiredIds);
    expect(recordedCleanups).toHaveLength(1);

    const record = recordedCleanups[0]!;
    expect(record.status).toBe("completed");
    expect(record.deletedCount).toBe(2);
    expect(record.retentionDays).toBe(30);
    expect(record.jobType).toBe("reference_run_retention");
  });

  it("respects maxDeletionsPerRun limit", async () => {
    const expiredIds = Array.from({ length: 100 }, (_, i) =>
      `run_${String(i).padStart(8, "0")}-1234-4000-8000-123456789012`.slice(0, 40),
    );
    const deletedRuns: string[] = [];

    const repository: ReferenceRunRepository = {
      async listExpiredRuns() {
        return expiredIds;
      },
      async deleteRun(runId) {
        deletedRuns.push(runId);
      },
      async recordCleanup() {},
    };

    const service = new ReferenceRunCleanupService({
      referenceRunRepository: repository,
    });

    const result = await service.executeCleanup(mockOrganization, 25);

    expect(result.deletedCount).toBe(25);
    expect(deletedRuns).toHaveLength(25);
  });

  it("handles deletion failures gracefully", async () => {
    const expiredIds = [
      "run_aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa",
      "run_bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb",
      "run_cccccccc-cccc-4000-8000-cccccccccccc",
    ];
    let deleteCallCount = 0;
    const recordedCleanups: CleanupJobRecord[] = [];

    const repository: ReferenceRunRepository = {
      async listExpiredRuns() {
        return expiredIds;
      },
      async deleteRun(runId) {
        deleteCallCount++;
        if (runId.includes("bbbb")) {
          throw new Error("Access denied");
        }
      },
      async recordCleanup(record) {
        recordedCleanups.push(record);
      },
    };

    const service = new ReferenceRunCleanupService({
      referenceRunRepository: repository,
    });

    const result = await service.executeCleanup(mockOrganization);

    expect(result.deletedCount).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.runId).toContain("bbbb");
    expect(result.failures[0]?.reason).toBe("Access denied");

    const record = recordedCleanups[0]!;
    expect(record.status).toBe("failed");
    expect(record.errorMessage).toContain("1 deletion(s) failed");
    expect(record.deletedCount).toBe(2);
  });

  it("records cleanup job with correct retention days from organization policy", async () => {
    const recordedCleanups: CleanupJobRecord[] = [];

    const repository: ReferenceRunRepository = {
      async listExpiredRuns() {
        return [];
      },
      async deleteRun() {},
      async recordCleanup(record) {
        recordedCleanups.push(record);
      },
    };

    const orgWith60Days: Organization = {
      ...mockOrganization,
      policy: {
        ...mockOrganization.policy,
        evidenceRetentionDays: 60,
      },
    };

    const service = new ReferenceRunCleanupService({
      referenceRunRepository: repository,
    });

    await service.executeCleanup(orgWith60Days);

    expect(recordedCleanups[0]?.retentionDays).toBe(60);
  });

  it("calculates deadline based on retention days", async () => {
    const capturedDates: string[] = [];

    const repository: ReferenceRunRepository = {
      async listExpiredRuns(_orgId, beforeDate) {
        capturedDates.push(beforeDate);
        return [];
      },
      async deleteRun() {},
      async recordCleanup() {},
    };

    const service = new ReferenceRunCleanupService({
      referenceRunRepository: repository,
      clock: () => new Date("2026-12-01T00:00:00.000Z"),
    });

    await service.executeCleanup(mockOrganization); // 30-day retention

    expect(capturedDates).toHaveLength(1);
    const deadline = new Date(capturedDates[0]!);
    const expectedDeadline = new Date("2026-11-01T00:00:00.000Z");
    expect(deadline.getTime()).toBe(expectedDeadline.getTime());
  });

  it("records next_run_at as 24 hours from now", async () => {
    const recordedCleanups: CleanupJobRecord[] = [];
    const now = new Date("2026-12-01T12:30:45.000Z");

    const repository: ReferenceRunRepository = {
      async listExpiredRuns() {
        return [];
      },
      async deleteRun() {},
      async recordCleanup(record) {
        recordedCleanups.push(record);
      },
    };

    const service = new ReferenceRunCleanupService({
      referenceRunRepository: repository,
      clock: () => now,
    });

    await service.executeCleanup(mockOrganization);

    const record = recordedCleanups[0]!;
    const nextRun = new Date(record.nextRunAt);
    const expectedNext = new Date(
      now.getTime() + 24 * 60 * 60 * 1000,
    );
    expect(nextRun.getTime()).toBe(expectedNext.getTime());
  });
});
