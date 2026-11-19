import { createHash } from "node:crypto";

import { createId, parseId, type OpaqueId } from "../../../domain/src/index.js";

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

export interface RunClaim {
  /**
   * True when this call created the run. False when a run already existed
   * for the idempotency key and the original run is returned instead.
   */
  readonly created: boolean;
  readonly run: Run;
}

export interface RunRepository {
  /**
   * Atomically insert `run` when no run exists for
   * (organizationId, idempotencyKey), and return the original run otherwise.
   * The check and the insert must happen as one indivisible step: a
   * find-then-insert sequence lets two concurrent callers create two runs
   * for one key. Durable stores enforce the same rule with the
   * UNIQUE (organization_id, idempotency_key) constraint and map a unique
   * violation back to the existing row instead of surfacing an error.
   */
  claim(run: Run): Promise<RunClaim>;
  insert(run: Run): Promise<void>;
  findByIdempotency(
    organizationId: OpaqueId<"organization">,
    key: string,
  ): Promise<Run | undefined>;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export interface CreateRunInput {
  readonly organizationId: string;
  readonly projectId: string;
  readonly targetId: string;
  readonly suiteId: string;
  readonly suiteVersion: string;
  readonly idempotencyKey: string;
  readonly effectiveConfig: Readonly<Record<string, unknown>>;
}

export class RunService {
  private readonly clock: () => Date;
  private readonly repository: RunRepository;

  constructor(options: {
    readonly repository: RunRepository;
    readonly clock?: () => Date;
  }) {
    this.repository = options.repository;
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * Create a run, or return the original run when the idempotency key was
   * already claimed. Duplicate claims never create a second run, even when
   * they race or arrive from another process.
   */
  async create(input: CreateRunInput): Promise<Run> {
    return (await this.createClaim(input)).run;
  }

  /**
   * Like {@link create}, and reports whether this call created the run.
   */
  async createClaim(input: CreateRunInput): Promise<RunClaim> {
    if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 128) {
      throw new Error("Invalid idempotency key.");
    }
    const organizationId = parseId("organization", input.organizationId);
    const run: Run = Object.freeze({
      createdAt: this.clock().toISOString(),
      effectiveConfig: Object.freeze(structuredClone(input.effectiveConfig)),
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
    return this.repository.claim(run);
  }
}

export class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, Run>();

  claim(run: Run): Promise<RunClaim> {
    // The lookup and the insert run in one synchronous step, so no caller
    // can observe the key as unclaimed after another caller claimed it.
    const key = `${run.organizationId}:${run.idempotencyKey}`;
    const existing = this.runs.get(key);
    if (existing) return Promise.resolve({ created: false, run: existing });
    this.runs.set(key, run);
    return Promise.resolve({ created: true, run });
  }

  insert(run: Run): Promise<void> {
    this.runs.set(`${run.organizationId}:${run.idempotencyKey}`, run);
    return Promise.resolve();
  }

  findByIdempotency(
    organizationId: OpaqueId<"organization">,
    key: string,
  ): Promise<Run | undefined> {
    return Promise.resolve(this.runs.get(`${organizationId}:${key}`));
  }
}
