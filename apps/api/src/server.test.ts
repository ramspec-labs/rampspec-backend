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

  it("records an over-budget probe as a classified finding with no partial content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rampspec-api-"));
    directories.push(directory);
    const sentinel = "PROBE-SENTINEL-DO-NOT-LEAK-7f3a9";
    const chunk = new TextEncoder().encode(`${sentinel}-`.padEnd(10_240, "x"));
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 10) {
          controller.enqueue(chunk);
        } else {
          controller.close();
        }
      },
    });
    const executor = new ReferenceRunExecutor(
      new JsonRunRepository(join(directory, "runs.json")),
      {
        allowedOrigins: ["https://anchor.example"],
        clock: () => new Date("2026-11-09T16:00:00.000Z"),
        fetcher: () =>
          Promise.resolve(
            new Response(body, {
              headers: { "x-stellar-toml-version": "SEP-0001" },
              status: 200,
            }),
          ),
      },
    );
    const started = await startApiServer({ executor, port: 0 });
    servers.push(started.server);
    const response = await fetch(`${started.url}/v1/reference-runs`, {
      body: JSON.stringify({
        projectId: ids.project,
        suiteId: ids.suite,
        suiteVersion: "1.0.0",
        targetId: ids.target,
        targetOrigin: "https://anchor.example",
      }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "reviewer-reference-run-0004",
        "X-RampSpec-Organization": ids.organization,
      },
      method: "POST",
    });
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      probe: {
        budgetExceeded: boolean;
        limitReason: string | null;
        reachable: boolean;
      };
      report: { findingIds: string[]; summary: { failed: number } };
      run: { state: string };
    };
    const raw = JSON.stringify(payload);
    expect(payload.probe.budgetExceeded).toBe(true);
    expect(payload.probe.limitReason).toBe("response-budget-exceeded");
    expect(payload.probe.reachable).toBe(false);
    expect(payload.report.findingIds).toContain(
      "target-probe-response-bounded",
    );
    expect(payload.report.summary.failed).toBe(2);
    expect(payload.run.state).toBe("failed");
    expect(raw).not.toContain(sentinel);
    expect(raw).not.toContain("SEP-0001");
    expect(pulls).toBeLessThan(10);
  });

  it("records unsupported probe content types without failing the run", async () => {
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
            headers: {
              "content-type": "text/html; charset=utf-8",
              "x-stellar-toml-version": "SEP-0001",
            },
            status: 200,
          }),
        ),
    });
    const started = await startApiServer({ executor, port: 0 });
    servers.push(started.server);

    const created = await fetch(`${started.url}/v1/reference-runs`, {
      body: JSON.stringify({
        projectId: ids.project,
        suiteId: ids.suite,
        suiteVersion: "1.0.0",
        targetId: ids.target,
        targetOrigin: "https://anchor.example",
      }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "reviewer-reference-run-0004",
        "X-RampSpec-Organization": ids.organization,
      },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const record = (await created.json()) as {
      probe: {
        contentType: string | null;
        contentTypeStatus: string;
        contentTypeSupported: boolean;
        discoveryValid: boolean;
        reachable: boolean;
      };
      report: { summary: { passed: number } };
      run: { state: string };
    };
    expect(record.probe).toMatchObject({
      contentType: "text/html",
      contentTypeStatus: "unsupported",
      contentTypeSupported: false,
      discoveryValid: false,
      reachable: true,
    });
    // Existing findings and run state are unchanged by the new probe fields.
    expect(record.run.state).toBe("completed");
    expect(record.report.summary.passed).toBe(2);
  });
});
