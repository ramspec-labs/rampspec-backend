import { describe, expect, it } from "vitest";
import { checkStandardReadiness, liveness, readiness } from "./health.js";

describe("operational health", () => {
  it("reports liveness and aggregate readiness", async () => {
    expect(liveness()).toEqual({ status: "ok" });
    const result = await readiness([
      { check: () => Promise.resolve(true), name: "database" },
      { check: () => Promise.resolve(true), name: "temporal" },
    ]);
    expect(result).toEqual({
      checks: { database: true, temporal: true },
      components: {
        database: { ready: true, status: "ready" },
        temporal: { ready: true, status: "ready" },
      },
      status: "ready",
    });
  });

  it("fails readiness closed when a dependency errors", async () => {
    const result = await readiness([
      { check: () => Promise.reject(new Error("down")), name: "database" },
      { check: () => Promise.resolve(true), name: "scheduler" },
    ]);
    expect(result).toEqual({
      checks: { database: false, scheduler: true },
      components: {
        database: { ready: false, status: "not_ready" },
        scheduler: { ready: true, status: "ready" },
      },
      status: "not_ready",
    });
  });

  it("breaks down readiness for database, objectStore, scheduler, and signing", async () => {
    const allGreen = await checkStandardReadiness({
      database: () => Promise.resolve(true),
      objectStore: () => Promise.resolve(true),
      scheduler: () => Promise.resolve(true),
      signing: () => Promise.resolve(true),
    });
    expect(allGreen.status).toBe("ready");
    expect(allGreen.components.database?.ready).toBe(true);
    expect(allGreen.components.objectStore?.ready).toBe(true);
    expect(allGreen.components.scheduler?.ready).toBe(true);
    expect(allGreen.components.signing?.ready).toBe(true);

    const degraded = await checkStandardReadiness({
      database: () => Promise.resolve(true),
      objectStore: () => Promise.reject(new Error("s3 credentials invalid: secret_key")),
      scheduler: () => Promise.resolve(true),
      signing: () => Promise.resolve(false),
    });
    expect(degraded.status).toBe("not_ready");
    expect(degraded.checks.database).toBe(true);
    expect(degraded.checks.objectStore).toBe(false);
    expect(degraded.checks.signing).toBe(false);
    // Safe output: no exception text or credentials leaked in response
    const jsonStr = JSON.stringify(degraded);
    expect(jsonStr).not.toContain("secret_key");
    expect(jsonStr).not.toContain("s3 credentials invalid");
  });

  it("bounds probe execution with a timeout", async () => {
    const timedOut = await readiness(
      [
        {
          check: () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 200)),
          name: "slowDependency",
          timeoutMs: 20,
        },
      ],
      { timeoutMs: 20 },
    );
    expect(timedOut.status).toBe("not_ready");
    expect(timedOut.checks.slowDependency).toBe(false);
  });
});
