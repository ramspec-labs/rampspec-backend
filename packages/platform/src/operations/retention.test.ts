import { describe, expect, it } from "vitest";
import { planPurge, planReferenceRunCleanup } from "./retention.js";

describe("retention purge", () => {
  it("selects only expired non-deleted artifacts", () => {
    expect(
      planPurge(
        [
          { id: "a", expiresAt: "2026-09-11T00:00:00.000Z", status: "finalized" },
          { id: "b", expiresAt: "2026-09-13T00:00:00.000Z", status: "finalized" },
          { id: "c", expiresAt: "2026-09-10T00:00:00.000Z", status: "deleted" },
        ],
        new Date("2026-09-12T00:00:00.000Z"),
      ),
    ).toEqual(["a"]);
  });
});

describe("reference run cleanup", () => {
  it("selects only expired completed/failed runs", () => {
    const now = new Date("2026-12-01T00:00:00.000Z");
    expect(
      planReferenceRunCleanup(
        [
          {
            id: "run_1",
            organizationId: "org_1",
            createdAt: "2026-11-01T00:00:00.000Z",
            state: "completed",
          },
          {
            id: "run_2",
            organizationId: "org_1",
            createdAt: "2026-11-20T00:00:00.000Z",
            state: "completed",
          },
          {
            id: "run_3",
            organizationId: "org_1",
            createdAt: "2026-10-01T00:00:00.000Z",
            state: "failed",
          },
          {
            id: "run_4",
            organizationId: "org_1",
            createdAt: "2026-10-01T00:00:00.000Z",
            state: "running",
          },
          {
            id: "run_5",
            organizationId: "org_1",
            createdAt: "2026-10-01T00:00:00.000Z",
            state: "pending",
          },
        ],
        30,
        now,
      ),
    ).toEqual(["run_1", "run_3"]);
  });

  it("rejects invalid retention days", () => {
    expect(() => planReferenceRunCleanup([], 0)).toThrow("positive integer");
    expect(() => planReferenceRunCleanup([], -5)).toThrow("positive integer");
    expect(() => planReferenceRunCleanup([], 3.5)).toThrow("positive integer");
  });

  it("handles boundary: run expires exactly at retention threshold", () => {
    const now = new Date("2026-12-01T00:00:00.000Z");
    // 30 days before = 2026-11-01T00:00:00.000Z
    const result = planReferenceRunCleanup(
      [
        {
          id: "run_boundary",
          organizationId: "org_1",
          createdAt: "2026-11-01T00:00:00.000Z",
          state: "completed",
        },
      ],
      30,
      now,
    );
    expect(result).toEqual(["run_boundary"]);
  });

  it("handles boundary: run created just after retention threshold", () => {
    const now = new Date("2026-12-01T00:00:00.000Z");
    // 30 days before = 2026-11-01T00:00:00.000Z
    const result = planReferenceRunCleanup(
      [
        {
          id: "run_recent",
          organizationId: "org_1",
          createdAt: "2026-11-01T00:00:01.000Z",
          state: "completed",
        },
      ],
      30,
      now,
    );
    expect(result).toEqual([]);
  });
});
