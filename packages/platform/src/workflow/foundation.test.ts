import { describe, expect, it } from "vitest";

import { InMemoryWorkflowClient, workflowId } from "./foundation.js";

describe("workflow foundation", () => {
  it("derives stable ids and idempotent starts", async () => {
    const client = new InMemoryWorkflowClient({
      clock: () => new Date("2026-09-12T18:00:00.000Z"),
    });
    expect(workflowId("run_1")).toBe(workflowId("run_1"));
    const first = await client.start("run_1", {});
    expect(await client.start("run_1", {})).toEqual(first);
    expect((await client.update(first.workflowId, "completed")).status).toBe(
      "completed",
    );
    await expect(client.update(first.workflowId, "failed")).rejects.toThrow(
      "terminal",
    );
  });

  it("rejects unknown workflows", async () => {
    const client = new InMemoryWorkflowClient();
    await expect(client.update("missing", "running")).rejects.toThrow(
      "not found",
    );
  });

  describe("orphaned step and execution recovery", () => {
    it("leases steps, completes work, and preserves lineage", async () => {
      const currentTime = new Date("2026-09-12T18:00:00.000Z");
      const client = new InMemoryWorkflowClient({
        clock: () => currentTime,
      });

      const exec = await client.start("run_2", {});
      const step = await client.acquireStepLease(exec.workflowId, {
        leaseDurationMs: 10_000,
        maxAttempts: 2,
        stepId: "step_1",
        workerId: "worker_a",
      });

      expect(step.status).toBe("running");
      expect(step.attemptCount).toBe(1);

      // Cannot acquire while lease active
      await expect(
        client.acquireStepLease(exec.workflowId, {
          stepId: "step_1",
          workerId: "worker_b",
        }),
      ).rejects.toThrow("active");

      // Complete step
      const completed = await client.completeStep(
        exec.workflowId,
        "step_1",
        "worker_a",
      );
      expect(completed.status).toBe("completed");

      // Cannot complete twice or mutate terminal step
      await expect(
        client.completeStep(exec.workflowId, "step_1", "worker_a"),
      ).rejects.toThrow("terminal");
      await expect(
        client.acquireStepLease(exec.workflowId, {
          stepId: "step_1",
          workerId: "worker_c",
        }),
      ).rejects.toThrow("terminal");
    });

    it("detects expired step leases and recovers or fails according to policy", async () => {
      let currentTime = new Date("2026-09-12T18:00:00.000Z");
      const client = new InMemoryWorkflowClient({
        clock: () => currentTime,
      });

      const exec = await client.start("run_3", {});
      await client.acquireStepLease(exec.workflowId, {
        leaseDurationMs: 5_000,
        maxAttempts: 2,
        stepId: "step_retryable",
        workerId: "worker_dead",
      });

      // No recovery if lease not expired
      currentTime = new Date("2026-09-12T18:00:02.000Z");
      const noneRecovered = await client.recoverOrphanedExecutions();
      expect(noneRecovered).toHaveLength(0);

      // Advance past lease expiry: attempt 1 recovers to pending
      currentTime = new Date("2026-09-12T18:00:06.000Z");
      const firstRecovery = await client.recoverOrphanedExecutions();
      expect(firstRecovery).toHaveLength(1);
      expect(firstRecovery[0]?.recoveryCount).toBe(1);
      expect(firstRecovery[0]?.originalWorkflowId).toBe(exec.workflowId);
      expect(firstRecovery[0]?.steps?.[0]?.status).toBe("pending");

      // Second worker acquires step (attempt 2)
      await client.acquireStepLease(exec.workflowId, {
        leaseDurationMs: 5_000,
        maxAttempts: 2,
        stepId: "step_retryable",
        workerId: "worker_second",
      });

      // Second worker dies and lease expires again: capped at maxAttempts (2), fails workflow
      currentTime = new Date("2026-09-12T18:00:15.000Z");
      const secondRecovery = await client.recoverOrphanedExecutions({
        actionOnExceeded: "fail",
      });
      expect(secondRecovery).toHaveLength(1);
      expect(secondRecovery[0]?.status).toBe("failed");
      expect(secondRecovery[0]?.steps?.[0]?.status).toBe("failed");

      // Terminal workflow cannot be recovered again
      currentTime = new Date("2026-09-12T18:00:20.000Z");
      const thirdRecovery = await client.recoverOrphanedExecutions();
      expect(thirdRecovery).toHaveLength(0);
    });

    it("prevents lease acquisition on terminal workflows", async () => {
      const client = new InMemoryWorkflowClient();
      const exec = await client.start("run_4", {});
      await client.update(exec.workflowId, "cancelled");

      await expect(
        client.acquireStepLease(exec.workflowId, {
          stepId: "step_1",
          workerId: "worker_a",
        }),
      ).rejects.toThrow("terminal");
    });
  });
});
