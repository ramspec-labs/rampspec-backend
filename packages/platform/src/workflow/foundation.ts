import { createHash } from "node:crypto";

export type WorkflowStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "running"
  | "scheduled";

export type StepExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface StepExecution {
  readonly stepId: string;
  readonly workerId: string;
  readonly status: StepExecutionStatus;
  readonly leaseExpiresAt: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly error?: string;
}

export interface WorkflowExecution {
  readonly runId: string;
  readonly workflowId: string;
  readonly status: WorkflowStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly steps?: readonly StepExecution[];
  readonly recoveryCount?: number;
  readonly originalWorkflowId?: string;
}

export interface StepLeaseOptions {
  readonly stepId: string;
  readonly workerId: string;
  readonly leaseDurationMs?: number;
  readonly maxAttempts?: number;
}

export interface RecoveryPolicy {
  readonly maxStepAttempts?: number;
  readonly actionOnExceeded?: "fail" | "cancel";
}

export interface WorkflowClient {
  start(
    runId: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<WorkflowExecution>;
  get(workflowId: string): Promise<WorkflowExecution | undefined>;
  update(
    workflowId: string,
    status: WorkflowStatus,
  ): Promise<WorkflowExecution>;
  acquireStepLease?(
    workflowId: string,
    options: StepLeaseOptions,
  ): Promise<StepExecution>;
  completeStep?(
    workflowId: string,
    stepId: string,
    workerId: string,
  ): Promise<StepExecution>;
  failStep?(
    workflowId: string,
    stepId: string,
    workerId: string,
    error: string,
  ): Promise<StepExecution>;
  recoverOrphanedExecutions?(
    policy?: RecoveryPolicy,
  ): Promise<readonly WorkflowExecution[]>;
}

export function workflowId(runId: string): string {
  return `rampspec-run-${createHash("sha256").update(runId, "utf8").digest("hex").slice(0, 32)}`;
}

export class InMemoryWorkflowClient implements WorkflowClient {
  private readonly executions = new Map<string, WorkflowExecution>();
  private readonly clock: () => Date;

  constructor(options: { readonly clock?: () => Date } = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  start(
    runId: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<WorkflowExecution> {
    void input;
    const id = workflowId(runId);
    const existing = this.executions.get(id);
    if (existing) return Promise.resolve(existing);

    const now = this.clock().toISOString();
    const execution = Object.freeze({
      originalWorkflowId: id,
      recoveryCount: 0,
      runId,
      startedAt: now,
      status: "running" as const,
      steps: Object.freeze([]),
      updatedAt: now,
      workflowId: id,
    });
    this.executions.set(id, execution);
    return Promise.resolve(execution);
  }

  get(id: string): Promise<WorkflowExecution | undefined> {
    return Promise.resolve(this.executions.get(id));
  }

  update(id: string, status: WorkflowStatus): Promise<WorkflowExecution> {
    const execution = this.executions.get(id);
    if (!execution) return Promise.reject(new Error("Workflow not found."));
    if (["completed", "failed", "cancelled"].includes(execution.status)) {
      return Promise.reject(new Error("Workflow is terminal."));
    }

    const updated = Object.freeze({
      ...execution,
      status,
      updatedAt: this.clock().toISOString(),
    });
    this.executions.set(id, updated);
    return Promise.resolve(updated);
  }

  acquireStepLease(
    workflowId: string,
    options: StepLeaseOptions,
  ): Promise<StepExecution> {
    const execution = this.executions.get(workflowId);
    if (!execution) return Promise.reject(new Error("Workflow not found."));
    if (["completed", "failed", "cancelled"].includes(execution.status)) {
      return Promise.reject(new Error("Workflow is terminal."));
    }

    const now = this.clock();
    const nowIso = now.toISOString();
    const leaseDurationMs = options.leaseDurationMs ?? 30_000;
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();
    const maxAttempts = options.maxAttempts ?? 3;

    const existingSteps = execution.steps ?? [];
    const existingIndex = existingSteps.findIndex((s) => s.stepId === options.stepId);

    let step: StepExecution;
    if (existingIndex >= 0) {
      const current = existingSteps[existingIndex]!;
      if (["completed", "failed", "cancelled"].includes(current.status)) {
        return Promise.reject(new Error("Step is terminal."));
      }
      if (current.status === "running" && new Date(current.leaseExpiresAt) > now) {
        return Promise.reject(new Error("Step lease already active."));
      }
      if (current.attemptCount >= current.maxAttempts) {
        return Promise.reject(new Error("Max step attempts reached."));
      }

      step = Object.freeze({
        ...current,
        attemptCount: current.attemptCount + 1,
        leaseExpiresAt,
        status: "running" as const,
        updatedAt: nowIso,
        workerId: options.workerId,
      });
      const updatedSteps = [...existingSteps];
      updatedSteps[existingIndex] = step;
      this.executions.set(
        workflowId,
        Object.freeze({
          ...execution,
          steps: Object.freeze(updatedSteps),
          updatedAt: nowIso,
        }),
      );
    } else {
      step = Object.freeze({
        attemptCount: 1,
        leaseExpiresAt,
        maxAttempts,
        startedAt: nowIso,
        status: "running" as const,
        stepId: options.stepId,
        updatedAt: nowIso,
        workerId: options.workerId,
      });
      this.executions.set(
        workflowId,
        Object.freeze({
          ...execution,
          steps: Object.freeze([...existingSteps, step]),
          updatedAt: nowIso,
        }),
      );
    }

    return Promise.resolve(step);
  }

  completeStep(
    workflowId: string,
    stepId: string,
    workerId: string,
  ): Promise<StepExecution> {
    const execution = this.executions.get(workflowId);
    if (!execution) return Promise.reject(new Error("Workflow not found."));
    if (["completed", "failed", "cancelled"].includes(execution.status)) {
      return Promise.reject(new Error("Workflow is terminal."));
    }

    const steps = execution.steps ?? [];
    const index = steps.findIndex((s) => s.stepId === stepId);
    if (index < 0) return Promise.reject(new Error("Step not found."));

    const current = steps[index]!;
    if (["completed", "failed", "cancelled"].includes(current.status)) {
      return Promise.reject(new Error("Step is terminal."));
    }
    if (current.workerId !== workerId) {
      return Promise.reject(new Error("Worker does not hold step lease."));
    }

    const now = this.clock().toISOString();
    const completed = Object.freeze({
      ...current,
      status: "completed" as const,
      updatedAt: now,
    });
    const updatedSteps = [...steps];
    updatedSteps[index] = completed;
    this.executions.set(
      workflowId,
      Object.freeze({
        ...execution,
        steps: Object.freeze(updatedSteps),
        updatedAt: now,
      }),
    );

    return Promise.resolve(completed);
  }

  failStep(
    workflowId: string,
    stepId: string,
    workerId: string,
    error: string,
  ): Promise<StepExecution> {
    const execution = this.executions.get(workflowId);
    if (!execution) return Promise.reject(new Error("Workflow not found."));
    if (["completed", "failed", "cancelled"].includes(execution.status)) {
      return Promise.reject(new Error("Workflow is terminal."));
    }

    const steps = execution.steps ?? [];
    const index = steps.findIndex((s) => s.stepId === stepId);
    if (index < 0) return Promise.reject(new Error("Step not found."));

    const current = steps[index]!;
    if (["completed", "failed", "cancelled"].includes(current.status)) {
      return Promise.reject(new Error("Step is terminal."));
    }
    if (current.workerId !== workerId) {
      return Promise.reject(new Error("Worker does not hold step lease."));
    }

    const now = this.clock().toISOString();
    const failed = Object.freeze({
      ...current,
      error,
      status: "failed" as const,
      updatedAt: now,
    });
    const updatedSteps = [...steps];
    updatedSteps[index] = failed;
    this.executions.set(
      workflowId,
      Object.freeze({
        ...execution,
        steps: Object.freeze(updatedSteps),
        updatedAt: now,
      }),
    );

    return Promise.resolve(failed);
  }

  recoverOrphanedExecutions(
    policy: RecoveryPolicy = {},
  ): Promise<readonly WorkflowExecution[]> {
    const now = this.clock();
    const recovered: WorkflowExecution[] = [];
    const defaultAction = policy.actionOnExceeded ?? "fail";

    for (const [id, execution] of this.executions.entries()) {
      if (["completed", "failed", "cancelled"].includes(execution.status)) {
        continue;
      }

      let modified = false;
      let workflowStatus: WorkflowStatus = execution.status;
      const steps = [...(execution.steps ?? [])];

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        if (step.status === "running" && new Date(step.leaseExpiresAt) <= now) {
          modified = true;
          const maxAttempts = policy.maxStepAttempts ?? step.maxAttempts;
          if (step.attemptCount >= maxAttempts) {
            steps[i] = Object.freeze({
              ...step,
              error: "Step lease expired and max recovery attempts exceeded.",
              status: defaultAction === "cancel" ? ("cancelled" as const) : ("failed" as const),
              updatedAt: now.toISOString(),
            });
            workflowStatus = defaultAction === "cancel" ? "cancelled" : "failed";
          } else {
            steps[i] = Object.freeze({
              ...step,
              error: "Step lease expired; recovered to pending.",
              status: "pending" as const,
              updatedAt: now.toISOString(),
            });
          }
        }
      }

      if (modified) {
        const updated = Object.freeze({
          ...execution,
          originalWorkflowId: execution.originalWorkflowId ?? execution.workflowId,
          recoveryCount: (execution.recoveryCount ?? 0) + 1,
          status: workflowStatus,
          steps: Object.freeze(steps),
          updatedAt: now.toISOString(),
        });
        this.executions.set(id, updated);
        recovered.push(updated);
      }
    }

    return Promise.resolve(Object.freeze(recovered));
  }
}
