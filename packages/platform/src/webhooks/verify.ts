import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  ProviderName,
  SecretProviderRegistry,
} from "../secrets/providers.js";

/**
 * Incoming webhook signature verification.
 *
 * Senders sign the raw request body with a timestamped HMAC-SHA256
 * signature so replays and tampering are detectable without trusting the
 * transport:
 *
 *   X-RampSpec-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
 *   X-RampSpec-Delivery-Id: <opaque delivery identifier>
 *
 * The signed payload is `<timestamp>.<delivery-id>.<raw body>`. The
 * signature is compared with `timingSafeEqual`, and verification results
 * carry only a reason code: raw secrets and payloads never enter logs or
 * error messages.
 */

export const webhookSignatureHeader = "x-rampspec-signature" as const;
export const webhookDeliveryIdHeader = "x-rampspec-delivery-id" as const;

/** Maximum age of a signed webhook, in seconds, either side of now. */
export const webhookSignatureToleranceSeconds = 300;

export type WebhookVerificationFailureReason =
  | "invalid-signature"
  | "malformed-delivery-id"
  | "malformed-signature"
  | "missing-delivery-id"
  | "missing-signature"
  | "replayed-delivery"
  | "stale-timestamp";

export type WebhookVerificationResult =
  | {
      readonly deliveryId: string;
      readonly timestamp: number;
      readonly verified: true;
    }
  | {
      readonly reason: WebhookVerificationFailureReason;
      readonly verified: false;
    };

export interface DeliveryReplayStore {
  has(deliveryId: string): boolean;
  record(deliveryId: string, expiresAtMs: number): void;
}

/**
 * In-memory replay store. Delivery IDs are remembered only until their
 * signature timestamp leaves the tolerance window; after that the same
 * ID with the same timestamp is already rejected as stale, and a fresh
 * timestamp requires a fresh signature, so the entry can be dropped.
 */
export class InMemoryDeliveryReplayStore implements DeliveryReplayStore {
  private readonly clock: () => Date;
  private readonly entries = new Map<string, number>();

  public constructor(options: { readonly clock?: () => Date } = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  public has(deliveryId: string): boolean {
    this.prune();
    return this.entries.has(deliveryId);
  }

  public record(deliveryId: string, expiresAtMs: number): void {
    this.prune();
    this.entries.set(deliveryId, expiresAtMs);
  }

  private prune(): void {
    const now = this.clock().getTime();
    for (const [deliveryId, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(deliveryId);
    }
  }
}

const deliveryIdPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const timestampPattern = /^\d{1,10}$/u;
const signaturePattern = /^[0-9a-f]{64}$/iu;

interface ParsedSignature {
  readonly timestamp: number;
  readonly signature: string;
}

function parseSignatureHeader(
  header: string,
): ParsedSignature | undefined {
  const parts = new Map<string, string>();
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (!key || value === undefined || parts.has(key)) return undefined;
    parts.set(key, value);
  }
  const timestampText = parts.get("t");
  const signature = parts.get("v1");
  if (parts.size !== 2 || !timestampText || !signature) return undefined;
  if (!timestampPattern.test(timestampText)) return undefined;
  if (!signaturePattern.test(signature)) return undefined;
  return { signature: signature.toLowerCase(), timestamp: Number(timestampText) };
}

/** Constant-time comparison that does not leak a length mismatch. */
function signaturesEqual(expectedHex: string, providedHex: string): boolean {
  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(providedHex, "hex");
  if (provided.length !== expected.length) {
    timingSafeEqual(expected, Buffer.alloc(expected.length));
    return false;
  }
  return timingSafeEqual(expected, provided);
}

export function computeWebhookSignature(
  secret: Uint8Array,
  timestamp: number,
  deliveryId: string,
  body: string | Uint8Array,
): string {
  const bodyBuffer =
    typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
  return createHmac("sha256", secret)
    .update(
      Buffer.concat([
        Buffer.from(`${timestamp}.${deliveryId}.`, "utf8"),
        bodyBuffer,
      ]),
    )
    .digest("hex");
}

export function verifyIncomingWebhookSignature(input: {
  readonly body: string | Uint8Array;
  readonly deliveryId: string | undefined;
  readonly now?: Date;
  readonly replayStore?: DeliveryReplayStore;
  readonly secret: Uint8Array;
  readonly signatureHeader: string | undefined;
  readonly toleranceSeconds?: number;
}): WebhookVerificationResult {
  const toleranceSeconds =
    input.toleranceSeconds ?? webhookSignatureToleranceSeconds;
  if (
    typeof input.signatureHeader !== "string" ||
    !input.signatureHeader
  ) {
    return { reason: "missing-signature", verified: false };
  }
  const parsed = parseSignatureHeader(input.signatureHeader);
  if (!parsed) {
    return { reason: "malformed-signature", verified: false };
  }
  if (
    typeof input.deliveryId !== "string" ||
    !input.deliveryId
  ) {
    return { reason: "missing-delivery-id", verified: false };
  }
  if (!deliveryIdPattern.test(input.deliveryId)) {
    return { reason: "malformed-delivery-id", verified: false };
  }
  const nowSeconds = Math.floor(
    (input.now ?? new Date()).getTime() / 1000,
  );
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
    return { reason: "stale-timestamp", verified: false };
  }
  const expected = computeWebhookSignature(
    input.secret,
    parsed.timestamp,
    input.deliveryId,
    input.body,
  );
  if (!signaturesEqual(expected, parsed.signature)) {
    return { reason: "invalid-signature", verified: false };
  }
  const replayStore = input.replayStore;
  if (replayStore) {
    if (replayStore.has(input.deliveryId)) {
      return { reason: "replayed-delivery", verified: false };
    }
    // Record only after the signature verifies, so unauthenticated
    // requests cannot poison the replay store.
    replayStore.record(
      input.deliveryId,
      (parsed.timestamp + toleranceSeconds) * 1000,
    );
  }
  return {
    deliveryId: input.deliveryId,
    timestamp: parsed.timestamp,
    verified: true,
  };
}

const secretReferenceSchemes: Readonly<Record<string, ProviderName>> = {
  "aws-kms": "aws",
  "azure-kv": "azure",
  "gcp-kms": "gcp",
  local: "local",
  vault: "vault",
};

/** Split a `provider://locator` secret reference into provider and locator. */
export function parseWebhookSecretReference(reference: string): {
  readonly locator: string;
  readonly provider: ProviderName;
} {
  const match = /^([a-z-]+):\/\/(.+)$/u.exec(reference);
  const provider = match?.[1] ? secretReferenceSchemes[match[1]] : undefined;
  if (!match || !provider || match[2] === undefined) {
    throw new Error("Invalid webhook signing secret reference.");
  }
  return { locator: match[2], provider };
}

/**
 * Registry-backed verifier. The signing secret is resolved once from the
 * configured secret reference and cached in memory; it is never logged.
 */
export class WebhookSignatureVerifier {
  private readonly clock: () => Date;
  private readonly registry: SecretProviderRegistry;
  private readonly replayStore: DeliveryReplayStore;
  private readonly secretReference: string;
  private readonly toleranceSeconds: number;
  private resolvedSecret: Uint8Array | undefined;

  public constructor(options: {
    readonly clock?: () => Date;
    readonly registry: SecretProviderRegistry;
    readonly replayStore?: DeliveryReplayStore;
    readonly secretReference: string;
    readonly toleranceSeconds?: number;
  }) {
    this.clock = options.clock ?? (() => new Date());
    this.registry = options.registry;
    this.replayStore = options.replayStore ?? new InMemoryDeliveryReplayStore({
      ...(options.clock ? { clock: options.clock } : {}),
    });
    this.secretReference = options.secretReference;
    this.toleranceSeconds =
      options.toleranceSeconds ?? webhookSignatureToleranceSeconds;
  }

  /** Resolve (and cache) the signing secret so startup fails fast. */
  public async initialize(): Promise<void> {
    await this.secret();
  }

  public async verify(input: {
    readonly body: string | Uint8Array;
    readonly deliveryId: string | undefined;
    readonly signatureHeader: string | undefined;
  }): Promise<WebhookVerificationResult> {
    return verifyIncomingWebhookSignature({
      body: input.body,
      deliveryId: input.deliveryId,
      now: this.clock(),
      replayStore: this.replayStore,
      secret: await this.secret(),
      signatureHeader: input.signatureHeader,
      toleranceSeconds: this.toleranceSeconds,
    });
  }

  private async secret(): Promise<Uint8Array> {
    if (!this.resolvedSecret) {
      const { locator, provider } = parseWebhookSecretReference(
        this.secretReference,
      );
      this.resolvedSecret = await this.registry.resolve(provider, locator);
    }
    return this.resolvedSecret;
  }
}
