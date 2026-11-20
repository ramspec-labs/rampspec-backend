import { createHash } from "node:crypto";
import { createId, parseId, type OpaqueId } from "../../../domain/src/index.js";
import { RunQuotaManager, type QuotaDecision } from "../security/rate-limit.js";

export type RunState =
  | "blocked"
  | "cancelled"
  | "completed"
  | "expired"
  | "failed"
  | "policy_check"
  | "provisioning"
  | "queued"
  | "requested"
  | "running"
  | "waiting_external"
  | "finalizing";

export interface Run {
  readonly createdAt: string;
  readonly effectiveConfig: Readonly<Record<string, unknown>>;
  readonly effectiveConfigHash: string;
  readonly id: OpaqueId<"run">;
  readonly idempotencyKey: string;
  readonly organizationId: OpaqueId<"organization">;
  readonly projectId: OpaqueId<"project">;
  readonly state: RunState;
  readonly suiteId: OpaqueId<"suite">;
  readonly suiteVersion: string;
  readonly targetId: OpaqueId<"target">;
}

export interface RunRepository {
  insert(run: Run): Promise<void>;
  findByIdempotency(
    organizationId: OpaqueId<"organization">,
    key: string,
  ): Promise<Run | undefined>;
}

export class QuotaExceededError extends Error {
  readonly code = "quota_exceeded";
  readonly status = 429;

  constructor(
    readonly type: "concurrent" | "windowed",
    readonly retryAfterSeconds: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "QuotaExceededError";
  }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export class RunService {
  private readonly clock: () => Date;
  private readonly repository: RunRepository;
  private readonly quotaManager?: RunQuotaManager;

  constructor(options: {
    readonly repository: RunRepository;
    readonly quotaManager?: RunQuotaManager;
    readonly clock?: () => Date;
  }) {
    this.repository = options.repository;
    this.quotaManager = options.quotaManager;
    this.clock = options.clock ?? (() => new Date());
  }

  async create(input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly targetId: string;
    readonly suiteId: string;
    readonly suiteVersion: string;
    readonly idempotencyKey: string;
    readonly effectiveConfig: Readonly<Record<string, unknown>>;
  }): Promise<Run> {
    if (
      input.idempotencyKey.length < 16 ||
      input.idempotencyKey.length > 128
    ) {
      throw new Error("Invalid idempotency key.");
    }

    const organizationId = parseId("organization", input.organizationId);

    // Check quotas before creating a run
    if (this.quotaManager) {
      const concurrentDecision = this.quotaManager.checkConcurrent(
        input.organizationId,
      );
      if (!concurrentDecision.allowed) {
        throw new QuotaExceededError(
          "concurrent",
          concurrentDecision.retryAfterSeconds,
          `Concurrent run limit exceeded. Current: ${concurrentDecision.concurrentUsage}, Limit: ${concurrentDecision.concurrentLimit}`,
        );
      }

      const windowedDecision = this.quotaManager.checkWindowed(
        input.organizationId,
      );
      if (!windowedDecision.allowed) {
        throw new QuotaExceededError(
          "windowed",
          windowedDecision.retryAfterSeconds,
          `Windowed run limit exceeded. Current: ${windowedDecision.concurrentUsage}, Limit: ${windowedDecision.concurrentLimit}`,
        );
      }
    }

    const existing = await this.repository.findByIdempotency(
      organizationId,
      input.idempotencyKey,
    );
    if (existing) return existing;

    const run: Run = Object.freeze({
      createdAt: this.clock().toISOString(),
      effectiveConfig: Object.freeze(
        structuredClone(input.effectiveConfig),
      ),
      effectiveConfigHash: hash(input.effectiveConfig),
      id: createId("run"),
      idempotencyKey: input.idempotencyKey,
      organizationId,
      projectId: parseId("project", input.projectId),
      state: "requested",
      suiteId: parseId("suite", input.suiteId),
      suiteVersion: input.suiteVersion,
      targetId: parseId("target", input.targetId),
    });

    await this.repository.insert(run);

    // Record windowed quota usage after successful insertion
    if (this.quotaManager) {
      this.quotaManager.recordWindowed(input.organizationId);
    }

    return run;
  }
}

export class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, Run>();

  insert(run: Run): Promise<void> {
    this.runs.set(`${run.organizationId}:${run.idempotencyKey}`, run);
    return Promise.resolve();
  }

  findByIdempotency(
    organizationId: OpaqueId<"organization">,
    key: string,
  ): Promise<Run | undefined> {
    return Promise.resolve(
      this.runs.get(`${organizationId}:${key}`),
    );
  }
}
