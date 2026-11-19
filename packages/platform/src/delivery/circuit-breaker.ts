import type { Metrics } from "../observability/metrics.js";

export type CircuitState = "closed" | "half-open" | "open";

export interface CircuitBreakerOptions {
  readonly clock?: () => Date;
  readonly cooldownMs?: number;
  readonly failureThreshold?: number;
  readonly failureWindowMs?: number;
  readonly metrics?: Metrics;
}

export interface CircuitSnapshot {
  readonly endpoint: string;
  readonly failureCount: number;
  readonly openedAt: string | null;
  readonly organizationId: string;
  readonly probeAvailableAt: string | null;
  readonly state: CircuitState;
}

interface Circuit {
  failures: number[];
  openedAt: number | null;
  probeInFlight: boolean;
  state: CircuitState;
}

const defaultFailureThreshold = 5;
const defaultFailureWindowMs = 60_000;
const defaultCooldownMs = 30_000;

/**
 * Bounded, tenant-scoped circuit breaker for webhook delivery.
 *
 * A circuit is keyed by organization and endpoint, so one tenant's failing
 * endpoint never pauses delivery for another tenant. Failures are counted
 * inside a sliding window; once the threshold is reached the circuit opens
 * and delivery attempts to that endpoint are paused. After the cooldown a
 * single half-open probe is allowed through: a successful probe closes the
 * circuit and resumes delivery, a failed probe re-opens it.
 *
 * The breaker never drops a delivery. It only gates attempts; callers keep
 * paused deliveries queued (pending) and retry them after the cooldown.
 */
export class WebhookCircuitBreaker {
  private readonly circuits = new Map<string, Circuit>();
  private readonly clock: () => Date;
  private readonly cooldownMs: number;
  private readonly failureThreshold: number;
  private readonly failureWindowMs: number;
  private readonly metrics: Metrics | undefined;

  constructor(options: CircuitBreakerOptions = {}) {
    if (
      options.failureThreshold !== undefined &&
      (!Number.isInteger(options.failureThreshold) ||
        options.failureThreshold < 1)
    ) {
      throw new Error("Circuit breaker failure threshold must be at least 1.");
    }
    if (
      options.failureWindowMs !== undefined &&
      (!Number.isInteger(options.failureWindowMs) ||
        options.failureWindowMs <= 0)
    ) {
      throw new Error("Circuit breaker failure window must be positive.");
    }
    if (
      options.cooldownMs !== undefined &&
      (!Number.isInteger(options.cooldownMs) || options.cooldownMs < 0)
    ) {
      throw new Error("Circuit breaker cooldown must not be negative.");
    }
    this.clock = options.clock ?? (() => new Date());
    this.cooldownMs = options.cooldownMs ?? defaultCooldownMs;
    this.failureThreshold =
      options.failureThreshold ?? defaultFailureThreshold;
    this.failureWindowMs = options.failureWindowMs ?? defaultFailureWindowMs;
    this.metrics = options.metrics;
  }

  /**
   * Returns true when a delivery attempt to the endpoint may proceed.
   * When the circuit is open and the cooldown has elapsed, this admits
   * exactly one half-open probe and blocks further attempts until the
   * probe resolves through recordSuccess or recordFailure.
   */
  allowDelivery(organizationId: string, endpoint: string): boolean {
    const circuit = this.circuit(organizationId, endpoint);
    const now = this.clock().getTime();
    const state = this.effectiveState(circuit, now);
    if (state === "closed") return true;
    if (state === "open") return false;
    if (circuit.probeInFlight) return false;
    if (circuit.state === "open") {
      circuit.state = "half-open";
      this.metrics?.increment("webhook_circuit_breaker_transitions_total", {
        state: "half-open",
      });
    }
    circuit.probeInFlight = true;
    this.metrics?.increment("webhook_circuit_breaker_probes_total");
    return true;
  }

  /** Records a successful delivery attempt against the endpoint. */
  recordSuccess(organizationId: string, endpoint: string): CircuitSnapshot {
    const circuit = this.circuit(organizationId, endpoint);
    const now = this.clock().getTime();
    if (this.effectiveState(circuit, now) === "half-open") {
      circuit.state = "closed";
      circuit.failures = [];
      circuit.openedAt = null;
      circuit.probeInFlight = false;
      this.metrics?.increment("webhook_circuit_breaker_transitions_total", {
        state: "closed",
      });
    } else if (circuit.state === "closed") {
      circuit.failures = [];
    }
    return this.snapshotFor(organizationId, endpoint, circuit, now);
  }

  /** Records a failed delivery attempt against the endpoint. */
  recordFailure(organizationId: string, endpoint: string): CircuitSnapshot {
    const circuit = this.circuit(organizationId, endpoint);
    const now = this.clock().getTime();
    this.pruneFailures(circuit, now);
    circuit.failures.push(now);
    this.metrics?.increment("webhook_circuit_breaker_failures_total");
    if (this.effectiveState(circuit, now) === "half-open") {
      this.open(circuit, now);
    } else if (
      circuit.state === "closed" &&
      circuit.failures.length >= this.failureThreshold
    ) {
      this.open(circuit, now);
    }
    return this.snapshotFor(organizationId, endpoint, circuit, now);
  }

  /** Returns the current state of one tenant-scoped endpoint circuit. */
  state(organizationId: string, endpoint: string): CircuitSnapshot {
    const circuit = this.circuit(organizationId, endpoint);
    return this.snapshotFor(
      organizationId,
      endpoint,
      circuit,
      this.clock().getTime(),
    );
  }

  /** Returns a snapshot of every tracked tenant-scoped endpoint circuit. */
  snapshot(): readonly CircuitSnapshot[] {
    const now = this.clock().getTime();
    return [...this.circuits.entries()].map(([key, circuit]) => {
      const [organizationId, endpoint] = JSON.parse(key) as [string, string];
      return this.snapshotFor(organizationId, endpoint, circuit, now);
    });
  }

  private circuit(organizationId: string, endpoint: string): Circuit {
    if (!organizationId) {
      throw new Error("Circuit breaker requires an organization id.");
    }
    if (!endpoint) {
      throw new Error("Circuit breaker requires an endpoint.");
    }
    const key = JSON.stringify([organizationId, endpoint]);
    const existing = this.circuits.get(key);
    if (existing) return existing;
    const circuit: Circuit = {
      failures: [],
      openedAt: null,
      probeInFlight: false,
      state: "closed",
    };
    this.circuits.set(key, circuit);
    return circuit;
  }

  private effectiveState(circuit: Circuit, now: number): CircuitState {
    if (circuit.state !== "open" || circuit.openedAt === null) {
      return circuit.state;
    }
    return now - circuit.openedAt >= this.cooldownMs
      ? "half-open"
      : "open";
  }

  private pruneFailures(circuit: Circuit, now: number): void {
    const windowStart = now - this.failureWindowMs;
    circuit.failures = circuit.failures.filter(
      (failure) => failure >= windowStart,
    );
  }

  private open(circuit: Circuit, now: number): void {
    circuit.state = "open";
    circuit.openedAt = now;
    circuit.probeInFlight = false;
    this.metrics?.increment("webhook_circuit_breaker_transitions_total", {
      state: "open",
    });
  }

  private snapshotFor(
    organizationId: string,
    endpoint: string,
    circuit: Circuit,
    now: number,
  ): CircuitSnapshot {
    this.pruneFailures(circuit, now);
    const state = this.effectiveState(circuit, now);
    return Object.freeze({
      endpoint,
      failureCount: circuit.failures.length,
      openedAt:
        circuit.openedAt === null
          ? null
          : new Date(circuit.openedAt).toISOString(),
      organizationId,
      probeAvailableAt:
        state === "open" && circuit.openedAt !== null
          ? new Date(circuit.openedAt + this.cooldownMs).toISOString()
          : null,
      state,
    });
  }
}
