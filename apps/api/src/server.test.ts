import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  JsonRunRepository,
  ReferenceRunExecutor,
  startApiServer,
} from "./server.js";

const ids = {
  organization: "organization_00000000-0000-4000-8000-000000000001",
  project: "project_00000000-0000-4000-8000-000000000002",
  suite: "suite_00000000-0000-4000-8000-000000000003",
  target: "target_00000000-0000-4000-8000-000000000004",
} as const;

const servers: Array<Awaited<ReturnType<typeof startApiServer>>["server"]> = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("reference run API", () => {
  it("persists an idempotent SEP-1 capability run and report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rampspec-api-"));
    directories.push(directory);
    const file = join(directory, "runs.json");
    const clock = () => new Date("2026-11-09T16:00:00.000Z");
    const executor = new ReferenceRunExecutor(new JsonRunRepository(file), {
      allowedOrigins: ["https://anchor.example"],
      clock,
      fetcher: () =>
        Promise.resolve(
          new Response(null, {
            headers: { "x-stellar-toml-version": "SEP-0001" },
            status: 200,
          }),
        ),
    });
    const started = await startApiServer({ executor, port: 0 });
    servers.push(started.server);

    const request = {
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "reviewer-reference-run-0001",
        "X-RampSpec-Organization": ids.organization,
      },
      body: JSON.stringify({
        projectId: ids.project,
        suiteId: ids.suite,
        suiteVersion: "1.0.0",
        targetId: ids.target,
        targetOrigin: "https://anchor.example",
      }),
      method: "POST",
    } as const;
    const created = await fetch(`${started.url}/v1/reference-runs`, request);
    expect(created.status).toBe(201);
    const first = (await created.json()) as {
      run: { id: string };
      report: { summary: { passed: number } };
    };
    expect(first.report.summary.passed).toBe(2);

    const retried = await fetch(`${started.url}/v1/reference-runs`, request);
    expect(((await retried.json()) as { run: { id: string } }).run.id).toBe(
      first.run.id,
    );

    const restarted = new ReferenceRunExecutor(new JsonRunRepository(file), {
      clock,
    });
    expect(
      (await restarted.find(ids.organization, first.run.id))?.report?.summary
        .passed,
    ).toBe(2);
    expect(
      await restarted.find(
        "organization_00000000-0000-4000-8000-000000000099",
        first.run.id,
      ),
    ).toBeUndefined();
  });

  it("rejects insecure targets and oversized trust assumptions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rampspec-api-"));
    directories.push(directory);
    const started = await startApiServer({
      dataFile: join(directory, "runs.json"),
      port: 0,
    });
    servers.push(started.server);
    const response = await fetch(`${started.url}/v1/reference-runs`, {
      body: JSON.stringify({
        projectId: ids.project,
        suiteId: ids.suite,
        suiteVersion: "1.0.0",
        targetId: ids.target,
        targetOrigin: "http://unsafe.example",
      }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "reviewer-reference-run-0002",
        "X-RampSpec-Organization": ids.organization,
      },
      method: "POST",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ title: "Request rejected" });
  });

  it("rejects HTTPS targets outside the configured allowlist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rampspec-api-"));
    directories.push(directory);
    const executor = new ReferenceRunExecutor(
      new JsonRunRepository(join(directory, "runs.json")),
      { allowedOrigins: ["https://anchor.example"] },
    );
    const started = await startApiServer({ executor, port: 0 });
    servers.push(started.server);
    const response = await fetch(`${started.url}/v1/reference-runs`, {
      body: JSON.stringify({
        projectId: ids.project,
        suiteId: ids.suite,
        suiteVersion: "1.0.0",
        targetId: ids.target,
        targetOrigin: "https://metadata.internal",
      }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "reviewer-reference-run-0003",
        "X-RampSpec-Organization": ids.organization,
      },
      method: "POST",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      detail: "Target origin is not approved for reference runs.",
    });
  });

  it("serves liveness at /health and dependency readiness at /ready", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rampspec-api-"));
    directories.push(directory);
    const started = await startApiServer({
      dataFile: join(directory, "runs.json"),
      port: 0,
      readinessChecks: [
        { check: () => Promise.resolve(true), name: "database" },
        { check: () => Promise.resolve(true), name: "objectStore" },
        { check: () => Promise.resolve(true), name: "scheduler" },
        { check: () => Promise.resolve(true), name: "signing" },
      ],
    });
    servers.push(started.server);

    const healthRes = await fetch(`${started.url}/health`);
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toMatchObject({ status: "ok" });

    const readyRes = await fetch(`${started.url}/ready`);
    expect(readyRes.status).toBe(200);
    const readyBody = (await readyRes.json()) as {
      checks: Record<string, boolean>;
      components: Record<string, { ready: boolean; status: string }>;
      status: string;
    };
    expect(readyBody.status).toBe("ready");
    expect(readyBody.components.database?.ready).toBe(true);
    expect(readyBody.components.objectStore?.ready).toBe(true);
    expect(readyBody.components.scheduler?.ready).toBe(true);
    expect(readyBody.components.signing?.ready).toBe(true);
  });

  it("returns 503 from /ready when a component is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rampspec-api-"));
    directories.push(directory);
    const started = await startApiServer({
      dataFile: join(directory, "runs.json"),
      port: 0,
      readinessChecks: [
        { check: () => Promise.resolve(true), name: "database" },
        { check: () => Promise.reject(new Error("s3-failure")), name: "objectStore" },
        { check: () => Promise.resolve(true), name: "scheduler" },
        { check: () => Promise.resolve(true), name: "signing" },
      ],
    });
    servers.push(started.server);

    const readyRes = await fetch(`${started.url}/ready`);
    expect(readyRes.status).toBe(503);
    const body = (await readyRes.json()) as { status: string; components: Record<string, { ready: boolean }> };
    expect(body.status).toBe("not_ready");
    expect(body.components.objectStore?.ready).toBe(false);
  });

  it("emits privacy-safe structured request logs without sensitive fields", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rampspec-api-"));
    directories.push(directory);
    const logs: unknown[] = [];
    const started = await startApiServer({
      dataFile: join(directory, "runs.json"),
      onLog: (entry) => logs.push(entry),
      port: 0,
    });
    servers.push(started.server);

    const healthRes = await fetch(`${started.url}/health`);
    expect(healthRes.status).toBe(200);

    // Wait for finish event to trigger log callback
    await new Promise((r) => setTimeout(r, 50));
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const firstLog = logs[0] as Record<string, unknown>;
    expect(firstLog).toMatchObject({
      actorClass: "anonymous",
      method: "GET",
      routeTemplate: "/health",
      status: 200,
    });
    expect(typeof firstLog.durationMs).toBe("number");
    expect(typeof firstLog.correlationId).toBe("string");
    expect(firstLog).not.toHaveProperty("body");
    expect(firstLog).not.toHaveProperty("headers");
    expect(firstLog).not.toHaveProperty("token");
    expect(firstLog).not.toHaveProperty("targetOrigin");
  });
});
