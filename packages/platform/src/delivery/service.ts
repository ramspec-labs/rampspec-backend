import { createHash } from "node:crypto";

import { createId, type OpaqueId } from "../../../domain/src/index.js";

export type DeliveryState = "dead-letter" | "delivered" | "failed" | "pending";

/** Failed attempts recorded before a delivery is parked as dead-letter. */
export const MAX_DELIVERY_ATTEMPTS = 5;

export interface Delivery {
  readonly attemptLineageId: string;
  readonly createdAt: string;
  readonly deadLetterAt: string | null;
  readonly id: OpaqueId<"delivery">;
  readonly kind: "export" | "webhook";
  readonly payloadHash: string;
  readonly replayedFromId: OpaqueId<"delivery"> | null;
  readonly reportId: OpaqueId<"report">;
  readonly retryCount: number;
  readonly state: DeliveryState;
  readonly updatedAt: string;
}

const terminalStates: ReadonlySet<DeliveryState> = new Set([
  "dead-letter",
  "delivered",
]);

export class DeliveryService {
  private readonly deliveries = new Map<string, Delivery>();
  private readonly clock: () => Date;

  constructor(options: { readonly clock?: () => Date } = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  create(reportId: string, kind: Delivery["kind"], payload: unknown): Delivery {
    const now = this.clock().toISOString();
    const id = createId("delivery");
    const delivery = Object.freeze({
      attemptLineageId: id,
      createdAt: now,
      deadLetterAt: null,
      id,
      kind,
      payloadHash: createHash("sha256")
        .update(JSON.stringify(payload), "utf8")
        .digest("hex"),
      replayedFromId: null,
      reportId: reportId as OpaqueId<"report">,
      retryCount: 0,
      state: "pending" as const,
      updatedAt: now,
    });
    this.deliveries.set(delivery.id, delivery);
    return delivery;
  }

  update(id: string, state: DeliveryState): Delivery {
    const delivery = this.deliveries.get(id);
    if (!delivery) throw new Error("Delivery not found.");
    if (terminalStates.has(delivery.state)) {
      throw new Error("Delivery is terminal.");
    }
    const now = this.clock().toISOString();
    const retryCount =
      state === "failed" ? delivery.retryCount + 1 : delivery.retryCount;
    const exhausted = state === "failed" && retryCount >= MAX_DELIVERY_ATTEMPTS;
    const nextState: DeliveryState =
      state === "dead-letter" || exhausted ? "dead-letter" : state;
    const updated = Object.freeze({
      ...delivery,
      deadLetterAt:
        nextState === "dead-letter" ? now : delivery.deadLetterAt,
      retryCount,
      state: nextState,
      updatedAt: now,
    });
    this.deliveries.set(id, updated);
    return updated;
  }

  /**
   * Start a new attempt lineage for a dead-letter delivery. The replay is a
   * fresh pending delivery carrying the original payload hash, so receivers
   * can deduplicate on it; the original record is left untouched.
   */
  replay(id: string): Delivery {
    const original = this.deliveries.get(id);
    if (!original) throw new Error("Delivery not found.");
    if (original.state !== "dead-letter") {
      throw new Error("Only dead-letter deliveries can be replayed.");
    }
    const now = this.clock().toISOString();
    const replayedId = createId("delivery");
    const replayed = Object.freeze({
      attemptLineageId: replayedId,
      createdAt: now,
      deadLetterAt: null,
      id: replayedId,
      kind: original.kind,
      payloadHash: original.payloadHash,
      replayedFromId: original.id,
      reportId: original.reportId,
      retryCount: 0,
      state: "pending" as const,
      updatedAt: now,
    });
    this.deliveries.set(replayed.id, replayed);
    return replayed;
  }

  get(id: string) {
    return this.deliveries.get(id);
  }

  listByState(state: DeliveryState): readonly Delivery[] {
    return [...this.deliveries.values()].filter(
      (delivery) => delivery.state === state,
    );
  }

  listDeadLetter(): readonly Delivery[] {
    return this.listByState("dead-letter");
  }

  listReplays(originalId: string): readonly Delivery[] {
    return [...this.deliveries.values()].filter(
      (delivery) => delivery.replayedFromId === originalId,
    );
  }
}
