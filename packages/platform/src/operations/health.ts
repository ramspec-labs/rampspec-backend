export interface HealthCheck {
  readonly name: string;
  readonly check: () => Promise<boolean>;
}

export async function readiness(
  checks: readonly HealthCheck[],
): Promise<{
  readonly status: "ready" | "not_ready";
  readonly checks: Readonly<Record<string, boolean>>;
}> {
  const results: Record<string, boolean> = {};
  for (const check of checks)
    results[check.name] = await check.check().catch(() => false);
  return {
    checks: results,
    status: Object.values(results).every(Boolean) ? "ready" : "not_ready",
  };
}

export function liveness(): { readonly status: "ok" } {
  return { status: "ok" };
}

export type WorkerState = "healthy" | "delayed" | "offline";

export interface WorkerHeartbeatConfig {
  /** Milliseconds before a worker without a heartbeat is marked delayed. Default 10000ms. */
  readonly delayedThresholdMs?: number;
  /** Milliseconds before a worker without a heartbeat is marked offline and expired. Default 30000ms. */
  readonly offlineThresholdMs?: number;
  /** Max acceptable clock skew in milliseconds to protect against transient jumps. Default 5000ms. */
  readonly maxClockSkewMs?: number;
  /** Optional custom clock for deterministic testing. */
  readonly clock?: () => number;
}

export interface WorkerStatus {
  readonly workerId: string;
  readonly lastHeartbeat: number;
  readonly state: WorkerState;
  readonly isAssignable: boolean;
  readonly elapsedMs: number;
}

export class WorkerHeartbeatTracker {
  private readonly workers = new Map<string, number>();
  private readonly delayedThresholdMs: number;
  private readonly offlineThresholdMs: number;
  private readonly maxClockSkewMs: number;
  private readonly clock: () => number;

  constructor(config: WorkerHeartbeatConfig = {}) {
    this.delayedThresholdMs = config.delayedThresholdMs ?? 10_000;
    this.offlineThresholdMs = config.offlineThresholdMs ?? 30_000;
    this.maxClockSkewMs = config.maxClockSkewMs ?? 5_000;
    this.clock = config.clock ?? (() => Date.now());

    if (this.delayedThresholdMs <= 0 || this.offlineThresholdMs <= this.delayedThresholdMs) {
      throw new Error("Invalid timeout thresholds: offlineThresholdMs must exceed delayedThresholdMs > 0.");
    }
  }

  recordHeartbeat(workerId: string, timestamp?: number): void {
    if (!workerId || typeof workerId !== "string" || workerId.trim().length === 0) {
      throw new Error("Worker ID must be a non-empty string.");
    }
    const now = this.clock();
    const ts = timestamp ?? now;

    if (!Number.isFinite(ts)) {
      throw new Error("Invalid heartbeat timestamp.");
    }

    // Guard against future timestamps exceeding allowed clock skew
    if (ts > now + this.maxClockSkewMs) {
      throw new Error("Heartbeat timestamp exceeds acceptable clock skew.");
    }

    // Guard against stale heartbeats older than an already recorded newer heartbeat
    const existing = this.workers.get(workerId);
    if (existing !== undefined && ts < existing) {
      return;
    }

    this.workers.set(workerId, Math.min(ts, now));
  }

  getWorkerStatus(workerId: string): WorkerStatus {
    const lastHeartbeat = this.workers.get(workerId);
    const now = this.clock();

    if (lastHeartbeat === undefined) {
      return Object.freeze({
        elapsedMs: Number.POSITIVE_INFINITY,
        isAssignable: false,
        lastHeartbeat: 0,
        state: "offline" as const,
        workerId,
      });
    }

    const elapsedMs = Math.max(0, now - lastHeartbeat);
    let state: WorkerState = "healthy";

    if (elapsedMs >= this.offlineThresholdMs) {
      state = "offline";
    } else if (elapsedMs >= this.delayedThresholdMs) {
      state = "delayed";
    }

    return Object.freeze({
      elapsedMs,
      // Schedulers stop assigning new work to expired (offline) workers
      isAssignable: state !== "offline",
      lastHeartbeat,
      state,
      workerId,
    });
  }

  canAssignWork(workerId: string): boolean {
    return this.getWorkerStatus(workerId).isAssignable;
  }

  getOperationalMetrics(): {
    readonly totalTracked: number;
    readonly healthy: number;
    readonly delayed: number;
    readonly offline: number;
  } {
    let healthy = 0;
    let delayed = 0;
    let offline = 0;

    for (const workerId of this.workers.keys()) {
      const { state } = this.getWorkerStatus(workerId);
      if (state === "healthy") healthy++;
      else if (state === "delayed") delayed++;
      else offline++;
    }

    return Object.freeze({
      delayed,
      healthy,
      offline,
      totalTracked: this.workers.size,
    });
  }

  removeWorker(workerId: string): boolean {
    return this.workers.delete(workerId);
  }
}
