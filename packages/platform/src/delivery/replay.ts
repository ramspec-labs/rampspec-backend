import type { AuditService } from "../audit/service.js";
import {
  authorize,
  type AuthorizationActor,
} from "../auth/authorization.js";
import type { Delivery, DeliveryService } from "./service.js";
import type { WebhookResult } from "./webhook.js";

/** Default ceiling on replay sends running at the same time. */
export const DEFAULT_MAX_CONCURRENT_REPLAYS = 5;

export interface ReplayOutcome {
  readonly attemptLineageId: string;
  readonly delivered: boolean;
  readonly deliveryId: string;
  readonly originalDeliveryId: string;
  readonly status: number | null;
}

export interface ReplayRequest {
  readonly actor: AuthorizationActor;
  readonly deliveryId: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly resourceOrganizationId: string;
}

export interface ReplayInspection {
  readonly delivery: Delivery;
  readonly outcome: ReplayOutcome | null;
}

export type ReplaySender = (replay: Delivery) => Promise<WebhookResult>;

export interface DeadLetterReplayServiceOptions {
  readonly audit: AuditService;
  readonly deliveries: DeliveryService;
  readonly maxConcurrentReplays?: number | undefined;
  readonly sender: ReplaySender;
}

/**
 * Authorized, audited replay of dead-letter webhook deliveries.
 *
 * A replay creates a new attempt lineage for the selected dead-letter
 * delivery and sends it through a bounded-concurrency queue. The original
 * delivery record is never changed; the replay is recorded as a new
 * append-only audit event, and its outcome can be inspected afterwards.
 */
export class DeadLetterReplayService {
  private readonly audit: AuditService;
  private readonly deliveries: DeliveryService;
  private readonly maxConcurrentReplays: number;
  private readonly sender: ReplaySender;
  private readonly outcomes = new Map<string, ReplayOutcome>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: DeadLetterReplayServiceOptions) {
    if (
      options.maxConcurrentReplays !== undefined &&
      options.maxConcurrentReplays < 1
    ) {
      throw new Error("Replay concurrency must be at least 1.");
    }
    this.audit = options.audit;
    this.deliveries = options.deliveries;
    this.maxConcurrentReplays =
      options.maxConcurrentReplays ?? DEFAULT_MAX_CONCURRENT_REPLAYS;
    this.sender = options.sender;
  }

  get activeReplays(): number {
    return this.active;
  }

  get queuedReplays(): number {
    return this.waiters.length;
  }

  listDeadLetter(): readonly Delivery[] {
    return this.deliveries.listDeadLetter();
  }

  listReplays(originalId: string): readonly Delivery[] {
    return this.deliveries.listReplays(originalId);
  }

  inspect(deliveryId: string): ReplayInspection {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) throw new Error("Delivery not found.");
    return { delivery, outcome: this.outcomes.get(deliveryId) ?? null };
  }

  async replay(request: ReplayRequest): Promise<{
    readonly completed: Promise<ReplayOutcome>;
    readonly delivery: Delivery;
  }> {
    authorize({
      action: "delivery.replay",
      actor: request.actor,
      organizationId: request.organizationId,
      resourceOrganizationId: request.resourceOrganizationId,
    });
    const delivery = this.deliveries.replay(request.deliveryId);
    await this.audit.record({
      action: "delivery.replay",
      actorId:
        request.actor.kind === "user"
          ? request.actor.userId
          : request.actor.serviceAccountId,
      actorType:
        request.actor.kind === "user" ? "user" : "service_account",
      metadata: {
        attemptLineageId: delivery.attemptLineageId,
        originalDeliveryId: request.deliveryId,
        payloadHash: delivery.payloadHash,
      },
      organizationId: request.organizationId,
      requestId: request.requestId,
      targetId: delivery.id,
      targetType: "delivery",
    });
    const completed = this.execute(delivery, request.deliveryId);
    return { completed, delivery };
  }

  private async execute(
    replay: Delivery,
    originalDeliveryId: string,
  ): Promise<ReplayOutcome> {
    await this.acquire();
    try {
      let result: WebhookResult;
      try {
        result = await this.sender(replay);
      } catch {
        result = {
          delivered: false,
          retryable: true,
          signature: "",
          status: null,
        };
      }
      const outcome = Object.freeze({
        attemptLineageId: replay.attemptLineageId,
        delivered: result.delivered,
        deliveryId: replay.id,
        originalDeliveryId,
        status: result.status,
      });
      this.outcomes.set(replay.id, outcome);
      this.deliveries.update(
        replay.id,
        result.delivered ? "delivered" : "failed",
      );
      return outcome;
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrentReplays) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}
