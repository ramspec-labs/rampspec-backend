import { createHash } from "node:crypto";

import { toUtcTimestamp } from "../../../domain/src/index.js";

const forbiddenKeys = new Set([
  "access_token",
  "address",
  "authorization",
  "client_secret",
  "date_of_birth",
  "dob",
  "email",
  "phone",
  "private_key",
  "password",
  "raw_body",
  "secret",
  "session_token",
]);

export type AuditActorType = "service_account" | "system" | "user";

export interface AuditEvent {
  readonly action: string;
  readonly actorId: string;
  readonly actorType: AuditActorType;
  readonly metadata: Readonly<Record<string, boolean | number | string | null>>;
  readonly metadataHash: string;
  readonly occurredAt: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly targetId: string;
  readonly targetType: string;
  readonly traceId?: string;
}

export interface AuditEventInput {
  readonly action: string;
  readonly actorId: string;
  readonly actorType: AuditActorType;
  readonly metadata?: Readonly<
    Record<string, boolean | number | string | null>
  >;
  readonly now?: Date;
  readonly organizationId: string;
  readonly requestId: string;
  readonly targetId: string;
  readonly targetType: string;
  readonly traceId?: string;
}

export interface AuditStore {
  append(event: AuditEvent): Promise<void>;
  list(organizationId: string): Promise<readonly AuditEvent[]>;
}

function canonicalMetadata(
  metadata: Readonly<Record<string, boolean | number | string | null>>,
): string {
  const ordered = Object.fromEntries(
    Object.entries(metadata).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    ),
  );
  return JSON.stringify(ordered);
}

function assertSafeMetadata(
  metadata: Readonly<Record<string, boolean | number | string | null>>,
): void {
  for (const [key, value] of Object.entries(metadata)) {
    if (
      forbiddenKeys.has(key.toLowerCase()) ||
      /token|secret|password|private.?key/iu.test(key)
    ) {
      throw new TypeError(`Audit metadata field ${key} is prohibited.`);
    }
    if (
      typeof value === "string" &&
      (value.length > 1024 || /^(?:bearer\s+|sk_|rsk_)/iu.test(value))
    ) {
      throw new TypeError(
        `Audit metadata value for ${key} is sensitive or oversized.`,
      );
    }
  }
}

function hashMetadata(
  metadata: Readonly<Record<string, boolean | number | string | null>>,
): string {
  return createHash("sha256")
    .update(canonicalMetadata(metadata), "utf8")
    .digest("hex");
}

export class AuditService {
  constructor(private readonly store: AuditStore) {}

  async record(input: AuditEventInput): Promise<AuditEvent> {
    if (!/^[a-z][a-z0-9.:-]+$/u.test(input.action))
      throw new TypeError("Invalid audit action.");
    if (!input.organizationId || !input.targetId || !input.requestId) {
      throw new TypeError(
        "Audit organization, target, and request IDs are required.",
      );
    }
    const metadata = Object.freeze({ ...(input.metadata ?? {}) });
    assertSafeMetadata(metadata);
    const event: AuditEvent = Object.freeze({
      action: input.action,
      actorId: input.actorId,
      actorType: input.actorType,
      metadata,
      metadataHash: hashMetadata(metadata),
      occurredAt: toUtcTimestamp(input.now ?? new Date()),
      organizationId: input.organizationId,
      requestId: input.requestId,
      targetId: input.targetId,
      targetType: input.targetType,
      ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
    });
    await this.store.append(event);
    return event;
  }

  async list(organizationId: string): Promise<readonly AuditEvent[]> {
    return this.store.list(organizationId);
  }
}

export class InMemoryAuditStore implements AuditStore {
  private readonly events: AuditEvent[] = [];

  append(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  list(organizationId: string): Promise<readonly AuditEvent[]> {
    return Promise.resolve(
      this.events.filter(
        ({ organizationId: candidate }) => candidate === organizationId,
      ),
    );
  }
}

export function verifyMetadataHash(event: AuditEvent): boolean {
  return event.metadataHash === hashMetadata(event.metadata);
}
