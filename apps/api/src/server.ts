import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { OpaqueId } from "../../../packages/domain/src/index.js";
import {
  generateReport,
  probeTarget,
  RunService,
  type CapabilityProbe,
  type GeneratedReport,
  type Run,
  type RunRepository,
} from "../../../packages/platform/src/index.js";

const version = "0.1.0";
const maximumBodyBytes = 32_768;

export interface ReferenceRunRecord {
  readonly probe?: CapabilityProbe;
  readonly report?: GeneratedReport;
  readonly run: Run;
  readonly targetOrigin: string;
}

interface ReferenceRunInput {
  readonly effectiveConfig?: Readonly<Record<string, unknown>>;
  readonly projectId: string;
  readonly suiteId: string;
  readonly suiteVersion: string;
  readonly targetId: string;
  readonly targetOrigin: string;
}

export class JsonRunRepository implements RunRepository {
  private pending: Promise<void> = Promise.resolve();

  public constructor(private readonly filePath: string) {}

  public async findByIdempotency(
    organizationId: OpaqueId<"organization">,
    key: string,
  ): Promise<Run | undefined> {
    await this.pending;
    return (await this.read()).find(
      (record) =>
        record.run.organizationId === organizationId &&
        record.run.idempotencyKey === key,
    )?.run;
  }

  public async findRecord(
    runId: string,
  ): Promise<ReferenceRunRecord | undefined> {
    await this.pending;
    return (await this.read()).find((record) => record.run.id === runId);
  }

  public insert(run: Run): Promise<void> {
    return this.mutate((records) => {
      if (!records.some((record) => record.run.id === run.id)) {
        records.push({ run, targetOrigin: "pending" });
      }
    });
  }

  public complete(record: ReferenceRunRecord): Promise<void> {
    return this.mutate((records) => {
      const index = records.findIndex((item) => item.run.id === record.run.id);
      if (index === -1) throw new Error("Run not found.");
      records[index] = record;
    });
  }

  private async read(): Promise<ReferenceRunRecord[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!Array.isArray(parsed))
        throw new Error("Run store must contain an array.");
      return parsed as ReferenceRunRecord[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private mutate(
    action: (records: ReferenceRunRecord[]) => void,
  ): Promise<void> {
    const operation = this.pending.then(async () => {
      const records = await this.read();
      action(records);
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(
        temporary,
        `${JSON.stringify(records, null, 2)}\n`,
        "utf8",
      );
      await rename(temporary, this.filePath);
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}

export class ReferenceRunExecutor {
  private readonly runs: RunService;

  public constructor(
    private readonly repository: JsonRunRepository,
    private readonly options: {
      readonly allowedOrigins?: readonly string[];
      readonly clock?: () => Date;
      readonly fetcher?: typeof fetch;
    } = {},
  ) {
    this.runs = new RunService({
      repository,
      ...(options.clock ? { clock: options.clock } : {}),
    });
  }

  public async find(
    organizationId: string,
    runId: string,
  ): Promise<ReferenceRunRecord | undefined> {
    const record = await this.repository.findRecord(runId);
    return record?.run.organizationId === organizationId ? record : undefined;
  }

  public async execute(
    organizationId: string,
    idempotencyKey: string,
    input: ReferenceRunInput,
  ): Promise<ReferenceRunRecord> {
    const targetOrigin = new URL(input.targetOrigin).origin;
    if (
      this.options.allowedOrigins &&
      !this.options.allowedOrigins.includes(targetOrigin)
    ) {
      throw new Error("Target origin is not approved for reference runs.");
    }
    const run = await this.runs.create({
      effectiveConfig: input.effectiveConfig ?? { network: "testnet" },
      idempotencyKey,
      organizationId,
      projectId: input.projectId,
      suiteId: input.suiteId,
      suiteVersion: input.suiteVersion,
      targetId: input.targetId,
    });
    const existing = await this.repository.findRecord(run.id);
    if (existing?.report) return existing;

    const probe = await probeTarget(targetOrigin, {
      ...(this.options.clock ? { clock: this.options.clock } : {}),
      ...(this.options.fetcher ? { fetcher: this.options.fetcher } : {}),
    });
    const supportsSep1 = probe.supportedSeps.some((sep) =>
      /^SEP-?0*1$/iu.test(sep),
    );
    const evidenceManifestHash = createHash("sha256")
      .update(JSON.stringify(probe), "utf8")
      .digest("hex");
    const report = generateReport({
      ...(this.options.clock ? { clock: this.options.clock } : {}),
      evidenceManifestHash,
      findings: [
        {
          id: "target-reachable",
          status: probe.reachable ? "pass" : "fail",
        },
        {
          id: "sep-1-advertised",
          status: supportsSep1 ? "pass" : "warning",
        },
      ],
      runId: run.id,
    });
    const completedRun: Run = Object.freeze({
      ...run,
      state: probe.reachable ? "completed" : "failed",
    });
    const record = Object.freeze({
      probe,
      report,
      run: completedRun,
      targetOrigin,
    });
    await this.repository.complete(record);
    return record;
  }
}

function applyCors(request: IncomingMessage, response: ServerResponse): void {
  const allowedOrigin = process.env.RAMPSPEC_ALLOWED_ORIGIN;
  const requestOrigin = request.headers.origin;
  if (allowedOrigin && requestOrigin === allowedOrigin) {
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Idempotency-Key, X-RampSpec-Organization",
    );
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Vary", "Origin");
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(value)}\n`);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.byteLength;
    if (length > maximumBodyBytes)
      throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${key} is required.`);
  return value;
}

export function createApiHandler(executor: ReferenceRunExecutor) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    applyCors(request, response);
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          persistence: "json-file",
          status: "ok",
          version,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/version") {
        sendJson(response, 200, { api: "v1", version });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/reference-runs") {
        const body = await readJson(request);
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new Error("JSON object required.");
        const record = body as Record<string, unknown>;
        const organizationId = request.headers["x-rampspec-organization"];
        const idempotencyKey = request.headers["idempotency-key"];
        if (typeof organizationId !== "string")
          throw new Error("X-RampSpec-Organization is required.");
        if (typeof idempotencyKey !== "string")
          throw new Error("Idempotency-Key is required.");
        const effectiveConfig =
          record.effectiveConfig &&
          typeof record.effectiveConfig === "object" &&
          !Array.isArray(record.effectiveConfig)
            ? (record.effectiveConfig as Readonly<Record<string, unknown>>)
            : undefined;
        const result = await executor.execute(organizationId, idempotencyKey, {
          ...(effectiveConfig ? { effectiveConfig } : {}),
          projectId: requireString(record, "projectId"),
          suiteId: requireString(record, "suiteId"),
          suiteVersion: requireString(record, "suiteVersion"),
          targetId: requireString(record, "targetId"),
          targetOrigin: requireString(record, "targetOrigin"),
        });
        sendJson(response, 201, result);
        return;
      }
      const match = /^\/v1\/reference-runs\/(run_[0-9a-f-]+)$/u.exec(
        url.pathname,
      );
      if (request.method === "GET" && match?.[1]) {
        const organizationId = request.headers["x-rampspec-organization"];
        if (typeof organizationId !== "string")
          throw new Error("X-RampSpec-Organization is required.");
        const record = await executor.find(organizationId, match[1]);
        if (!record) {
          sendJson(response, 404, { status: 404, title: "Run not found" });
          return;
        }
        sendJson(response, 200, record);
        return;
      }
      sendJson(response, 404, { status: 404, title: "Route not found" });
    } catch (error) {
      sendJson(response, 400, {
        detail: error instanceof Error ? error.message : "Invalid request.",
        status: 400,
        title: "Request rejected",
      });
    }
  };
}

export async function startApiServer(
  options: {
    readonly dataFile?: string;
    readonly executor?: ReferenceRunExecutor;
    readonly host?: string;
    readonly port?: number;
  } = {},
): Promise<{ readonly server: Server; readonly url: string }> {
  const repository = new JsonRunRepository(
    options.dataFile ??
      resolve(process.env.RAMPSPEC_DATA_FILE ?? ".data/reference-runs.json"),
  );
  const allowedOrigins = (process.env.RAMPSPEC_REFERENCE_TARGETS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).origin);
  if (
    !options.executor &&
    process.env.NODE_ENV === "production" &&
    allowedOrigins.length === 0
  ) {
    throw new Error("RAMPSPEC_REFERENCE_TARGETS is required in production.");
  }
  const handler = createApiHandler(
    options.executor ??
      new ReferenceRunExecutor(repository, {
        ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}),
      }),
  );
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(
      options.port ?? Number(process.env.PORT ?? "4000"),
      host,
      () => resolveListen(),
    );
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("API server address is unavailable.");
  return { server, url: `http://${host}:${address.port}` };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startApiServer()
    .then(({ url }) => console.log(`RampSpec API listening on ${url}`))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
