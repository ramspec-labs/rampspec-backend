import { createHash } from "node:crypto";

import { createId, type OpaqueId } from "../../../domain/src/index.js";

import type {
  WebhookCircuitBreaker,
  CircuitSnapshot,
} from "./circuit-breaker.js";

export interface Delivery {
  readonly createdAt: string;
  readonly id: OpaqueId<"delivery">;
  readonly kind: "export" | "webhook";
  readonly payloadHash: string;
  readonly reportId: OpaqueId<"report">;
  readonly retryCount: number;
  readonly state: "delivered" | "failed" | "pending";
  readonly updatedAt: string;
}

export interface DeliveryOutcome {
  readonly circuit: CircuitSnapshot | null;
  readonly delivery: Delivery;
}

export class DeliveryService {
  private readonly deliveries = new Map<string, Delivery>();
  private readonly clock: () => Date;
  private readonly circuitBreaker: WebhookCircuitBreaker | undefined;

  constructor(options: {
    readonly circuitBreaker?: WebhookCircuitBreaker;
    readonly clock?: () => Date;
  } = {}) {
    this.circuitBreaker = options.circuitBreaker;
    this.clock = options.clock ?? (() => new Date());
  }

  create(
    reportId: string,
    kind: Delivery["kind"],
    payload: unknown,
  ): Delivery {
    const now = this.clock().toISOString();
    const delivery = Object.freeze({
      createdAt: now,
      id: createId("delivery"),
      kind,
      payloadHash: createHash("sha256")
        .update(JSON.stringify(payload), "utf8")
        .digest("hex"),
      reportId: reportId as OpaqueId<"report">,
      retryCount: 0,
      state: "pending" as const,
      updatedAt: now,
    });
    this.deliveries.set(delivery.id, delivery);
    return delivery;
  }

  update(id: string, state: Delivery["state"]): Delivery {
    const delivery = this.deliveries.get(id);
    if (!delivery) throw new Error("Delivery not found.");
    if (delivery.state === "delivered") {
      throw new Error("Delivery is terminal.");
    }
    const updated = Object.freeze({
      ...delivery,
      retryCount:
        state === "failed" ? delivery.retryCount + 1 : delivery.retryCount,
      state,
      updatedAt: this.clock().toISOString(),
    });
    this.deliveries.set(id, updated);
    return updated;
  }

  get(id: string) {
    return this.deliveries.get(id);
  }

  /**
   * Returns true when a delivery attempt to the endpoint may proceed.
   * Without a circuit breaker every attempt is allowed. With one, an open
   * circuit pauses attempts; the delivery stays pending and is never
   * dropped, so callers retry it after the cooldown instead.
   */
  canDeliver(organizationId: string, endpoint: string): boolean {
    return (
      this.circuitBreaker?.allowDelivery(organizationId, endpoint) ?? true
    );
  }

  /**
   * Records a delivery attempt outcome: updates the delivery record and
   * feeds the result into the circuit breaker when one is configured.
   * Returns the updated delivery and the endpoint's circuit snapshot
   * (null when no circuit breaker is configured).
   */
  recordDeliveryOutcome(
    id: string,
    organizationId: string,
    endpoint: string,
    outcome: "delivered" | "failed",
  ): DeliveryOutcome {
    const delivery = this.update(id, outcome);
    const circuit = this.circuitBreaker
      ? outcome === "delivered"
        ? this.circuitBreaker.recordSuccess(organizationId, endpoint)
        : this.circuitBreaker.recordFailure(organizationId, endpoint)
      : null;
    return { circuit, delivery };
  }

  /** Returns the circuit state for one tenant-scoped endpoint, if tracked. */
  circuitState(
    organizationId: string,
    endpoint: string,
  ): CircuitSnapshot | null {
    return this.circuitBreaker?.state(organizationId, endpoint) ?? null;
  }
}
