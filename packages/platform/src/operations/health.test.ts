import { describe, expect, it } from "vitest";
import {
  liveness,
  readiness,
  WorkerHeartbeatTracker,
} from "./health.js";

describe("operational health", () => {
  it("reports liveness and aggregate readiness", async () => {
    expect(liveness()).toEqual({ status: "ok" });
    await expect(
      readiness([
        { check: () => Promise.resolve(true), name: "database" },
        { check: () => Promise.resolve(true), name: "temporal" },
      ]),
    ).resolves.toEqual({
      checks: { database: true, temporal: true },
      status: "ready",
    });
  });

  it("fails readiness closed when a dependency errors", async () => {
    await expect(
      readiness([{ check: () => Promise.reject(new Error("down")), name: "database" }]),
    ).resolves.toMatchObject({
      checks: { database: false },
      status: "not_ready",
    });
  });

  describe("worker heartbeat tracking", () => {
    it("tracks worker lifecycle through healthy, delayed, and offline states", () => {
      let currentTime = 1_000_000;
      const tracker = new WorkerHeartbeatTracker({
        clock: () => currentTime,
        delayedThresholdMs: 5_000,
        maxClockSkewMs: 2_000,
        offlineThresholdMs: 15_000,
      });

      // Initially unknown worker is offline
      expect(tracker.getWorkerStatus("w-1")).toMatchObject({
        isAssignable: false,
        state: "offline",
        workerId: "w-1",
      });
      expect(tracker.canAssignWork("w-1")).toBe(false);

      // Record first heartbeat
      tracker.recordHeartbeat("w-1");
      expect(tracker.getWorkerStatus("w-1")).toMatchObject({
        elapsedMs: 0,
        isAssignable: true,
        lastHeartbeat: 1_000_000,
        state: "healthy",
      });
      expect(tracker.canAssignWork("w-1")).toBe(true);

      // Advance clock into delayed threshold
      currentTime += 6_000;
      expect(tracker.getWorkerStatus("w-1")).toMatchObject({
        elapsedMs: 6_000,
        isAssignable: true,
        state: "delayed",
      });

      // Advance clock into offline threshold (expired)
      currentTime += 10_000; // now 16_000 elapsed
      expect(tracker.getWorkerStatus("w-1")).toMatchObject({
        elapsedMs: 16_000,
        isAssignable: false,
        state: "offline",
      });
      expect(tracker.canAssignWork("w-1")).toBe(false);

      // Subsequent heartbeat recovers worker
      currentTime += 1_000;
      tracker.recordHeartbeat("w-1");
      expect(tracker.getWorkerStatus("w-1")).toMatchObject({
        elapsedMs: 0,
        isAssignable: true,
        state: "healthy",
      });
    });

    it("exposes aggregate operational metrics", () => {
      const currentTime = 10_000;
      const tracker = new WorkerHeartbeatTracker({
        clock: () => currentTime,
        delayedThresholdMs: 5_000,
        offlineThresholdMs: 20_000,
      });

      tracker.recordHeartbeat("worker-healthy");
      tracker.recordHeartbeat("worker-delayed", currentTime - 6_000);
      tracker.recordHeartbeat("worker-offline", currentTime - 25_000);

      expect(tracker.getOperationalMetrics()).toEqual({
        delayed: 1,
        healthy: 1,
        offline: 1,
        totalTracked: 3,
      });
    });

    it("guards against clock skew beyond configured threshold", () => {
      const now = 50_000;
      const tracker = new WorkerHeartbeatTracker({
        clock: () => now,
        maxClockSkewMs: 3_000,
      });

      // Within skew threshold is capped to now
      tracker.recordHeartbeat("w-skewed", now + 2_000);
      expect(tracker.getWorkerStatus("w-skewed").lastHeartbeat).toBe(now);

      // Exceeding clock skew throws failure
      expect(() => tracker.recordHeartbeat("w-skewed", now + 10_000)).toThrow(
        "exceeds acceptable clock skew",
      );
    });

    it("rejects invalid configuration and invalid worker IDs", () => {
      expect(() => new WorkerHeartbeatTracker({ delayedThresholdMs: 10_000, offlineThresholdMs: 5_000 })).toThrow(
        "Invalid timeout thresholds",
      );
      expect(() => new WorkerHeartbeatTracker({ delayedThresholdMs: -1 })).toThrow(
        "Invalid timeout thresholds",
      );

      const tracker = new WorkerHeartbeatTracker();
      expect(() => tracker.recordHeartbeat("")).toThrow("Worker ID");
      expect(() => tracker.recordHeartbeat("   ")).toThrow("Worker ID");
      expect(() => tracker.recordHeartbeat("w-1", Number.NaN)).toThrow("Invalid heartbeat timestamp");
    });

    it("ignores out-of-order older heartbeats", () => {
      const tracker = new WorkerHeartbeatTracker({ clock: () => 100_000 });
      tracker.recordHeartbeat("w-1", 90_000);
      tracker.recordHeartbeat("w-1", 80_000); // older than current recorded 90_000
      expect(tracker.getWorkerStatus("w-1").lastHeartbeat).toBe(90_000);
    });

    it("supports removing workers cleanly", () => {
      const tracker = new WorkerHeartbeatTracker();
      tracker.recordHeartbeat("w-remove");
      expect(tracker.removeWorker("w-remove")).toBe(true);
      expect(tracker.removeWorker("w-remove")).toBe(false);
      expect(tracker.getWorkerStatus("w-remove").state).toBe("offline");
    });
  });
});
