import { describe, expect, it, vi } from "vitest";

import { SecretProviderRegistry } from "../secrets/providers.js";
import {
  InMemoryDeliveryReplayStore,
  WebhookSignatureVerifier,
  computeWebhookSignature,
  parseWebhookSecretReference,
  verifyIncomingWebhookSignature,
  webhookSignatureToleranceSeconds,
} from "./verify.js";

const secret = new TextEncoder().encode("test-signing-secret");
const body = JSON.stringify({ event: "target.probed", target: "target_1" });
const deliveryId = "delivery-0001";
const now = new Date("2026-11-19T17:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1000);

function sign(
  timestamp: number,
  options: {
    readonly bodyValue?: string | Uint8Array;
    readonly deliveryIdValue?: string;
    readonly secretValue?: Uint8Array;
  } = {},
): string {
  const signature = computeWebhookSignature(
    options.secretValue ?? secret,
    timestamp,
    options.deliveryIdValue ?? deliveryId,
    options.bodyValue ?? body,
  );
  return `t=${timestamp},v1=${signature}`;
}

function verify(
  signatureHeader: string | undefined,
  options: {
    readonly bodyValue?: string | Uint8Array;
    readonly deliveryIdValue?: string | null;
    readonly nowValue?: Date;
    readonly replayStore?: InMemoryDeliveryReplayStore;
    readonly secretValue?: Uint8Array;
    readonly toleranceSeconds?: number;
  } = {},
) {
  return verifyIncomingWebhookSignature({
    body: options.bodyValue ?? body,
    deliveryId:
      options.deliveryIdValue === undefined
        ? deliveryId
        : (options.deliveryIdValue ?? undefined),
    now: options.nowValue ?? now,
    ...(options.replayStore ? { replayStore: options.replayStore } : {}),
    secret: options.secretValue ?? secret,
    signatureHeader,
    ...(options.toleranceSeconds !== undefined
      ? { toleranceSeconds: options.toleranceSeconds }
      : {}),
  });
}

describe("incoming webhook signature verification", () => {
  it("accepts an authentic, timely signature for string and binary bodies", () => {
    expect(verify(sign(nowSeconds))).toEqual({
      deliveryId,
      timestamp: nowSeconds,
      verified: true,
    });
    expect(
      verify(sign(nowSeconds), {
        bodyValue: new TextEncoder().encode(body),
      }),
    ).toMatchObject({ verified: true });
  });

  it("accepts timestamps exactly at the tolerance boundary", () => {
    expect(
      verify(sign(nowSeconds - webhookSignatureToleranceSeconds)),
    ).toMatchObject({ verified: true });
    expect(
      verify(sign(nowSeconds + webhookSignatureToleranceSeconds)),
    ).toMatchObject({ verified: true });
  });

  it("rejects missing signatures and delivery IDs", () => {
    expect(verify(undefined)).toEqual({
      reason: "missing-signature",
      verified: false,
    });
    expect(verify("")).toEqual({
      reason: "missing-signature",
      verified: false,
    });
    expect(verify(sign(nowSeconds), { deliveryIdValue: null })).toEqual({
      reason: "missing-delivery-id",
      verified: false,
    });
    expect(verify(sign(nowSeconds), { deliveryIdValue: "" })).toEqual({
      reason: "missing-delivery-id",
      verified: false,
    });
  });

  it("rejects malformed signatures", () => {
    const malformed = [
      "not-a-signature",
      "t=abc,v1=deadbeef",
      "t=1763564400",
      "v1=deadbeef",
      `t=${nowSeconds},v1=zzzz`,
      `t=${nowSeconds},v1=${"ab".repeat(31)}`,
      `t=${nowSeconds},v1=${"ab".repeat(33)}`,
      `t=${nowSeconds},v1=${"ab".repeat(32)},v0=00`,
      `t=${nowSeconds},t=${nowSeconds},v1=${"ab".repeat(32)}`,
      `t=${nowSeconds},v1=${"AB".repeat(32)}extra`,
    ];
    for (const header of malformed) {
      expect(verify(header)).toEqual({
        reason: "malformed-signature",
        verified: false,
      });
    }
  });

  it("rejects malformed delivery IDs", () => {
    for (const badId of ["short", "has space", "has/slash", "a".repeat(129)]) {
      expect(
        verify(sign(nowSeconds, { deliveryIdValue: badId }), {
          deliveryIdValue: badId,
        }),
      ).toEqual({ reason: "malformed-delivery-id", verified: false });
    }
  });

  it("rejects stale and future timestamps", () => {
    expect(
      verify(sign(nowSeconds - webhookSignatureToleranceSeconds - 1)),
    ).toEqual({ reason: "stale-timestamp", verified: false });
    expect(
      verify(sign(nowSeconds + webhookSignatureToleranceSeconds + 1)),
    ).toEqual({ reason: "stale-timestamp", verified: false });
  });

  it("rejects signatures from the wrong secret or a tampered request", () => {
    expect(
      verify(sign(nowSeconds, { secretValue: new TextEncoder().encode("other-secret") })),
    ).toEqual({ reason: "invalid-signature", verified: false });
    expect(verify(sign(nowSeconds), { bodyValue: `${body} ` })).toEqual({
      reason: "invalid-signature",
      verified: false,
    });
    expect(
      verify(
        sign(nowSeconds).replace(`t=${nowSeconds}`, `t=${nowSeconds + 1}`),
      ),
    ).toEqual({ reason: "invalid-signature", verified: false });
    expect(
      verify(sign(nowSeconds, { deliveryIdValue: "delivery-0002" })),
    ).toEqual({ reason: "invalid-signature", verified: false });
  });

  it("rejects invalid signatures of any length with the same reason", () => {
    // No length oracle: every bad signature reports one reason.
    for (const header of [
      `t=${nowSeconds},v1=${"00".repeat(32)}`,
      `t=${nowSeconds},v1=${"ff".repeat(32)}`,
    ]) {
      expect(verify(header)).toEqual({
        reason: "invalid-signature",
        verified: false,
      });
    }
  });

  it("rejects replayed delivery IDs and expires replay entries", () => {
    let current = now;
    const clock = () => current;
    const replayStore = new InMemoryDeliveryReplayStore({ clock });
    const attempt = (at: Date) =>
      verify(sign(Math.floor(at.getTime() / 1000)), {
        nowValue: at,
        replayStore,
      });
    expect(attempt(now)).toMatchObject({ verified: true });
    expect(attempt(now)).toEqual({
      reason: "replayed-delivery",
      verified: false,
    });
    expect(
      verify(sign(nowSeconds, { deliveryIdValue: "delivery-0002" }), {
        bodyValue: body,
        deliveryIdValue: "delivery-0002",
        nowValue: now,
        replayStore,
      }),
    ).toMatchObject({ verified: true });

    // Once the tolerance window passes, the entry expires and a fresh
    // signature for the same delivery ID verifies again.
    current = new Date(
      (nowSeconds + webhookSignatureToleranceSeconds + 1) * 1000,
    );
    expect(attempt(current)).toMatchObject({ verified: true });
  });

  it("does not let failed attempts poison the replay store", () => {
    const replayStore = new InMemoryDeliveryReplayStore();
    expect(
      verify(sign(nowSeconds, { secretValue: new TextEncoder().encode("wrong") }), {
        replayStore,
      }),
    ).toEqual({ reason: "invalid-signature", verified: false });
    expect(verify(sign(nowSeconds), { replayStore })).toMatchObject({
      verified: true,
    });
  });

  it("never includes secret or payload material in verification results", () => {
    const result = verify(sign(nowSeconds, { secretValue: new TextEncoder().encode("wrong") }));
    expect(JSON.stringify(result)).not.toContain("test-signing-secret");
    expect(JSON.stringify(result)).not.toContain("target.probed");
    expect(JSON.stringify(result)).not.toContain(body);
  });
});

describe("webhook signing secret references", () => {
  it("parses provider references and rejects anything else", () => {
    expect(parseWebhookSecretReference("vault://webhooks/signing-secret")).toEqual({
      locator: "webhooks/signing-secret",
      provider: "vault",
    });
    expect(parseWebhookSecretReference("local://file:/keys/webhook")).toEqual({
      locator: "file:/keys/webhook",
      provider: "local",
    });
    for (const bad of [
      "vault:webhooks/signing-secret",
      "unknown://webhooks/signing-secret",
      "vault://",
      "",
    ]) {
      expect(() => parseWebhookSecretReference(bad)).toThrow(
        "Invalid webhook signing secret reference.",
      );
    }
  });
});

describe("registry-backed webhook verifier", () => {
  it("resolves the secret once and verifies through the registry", async () => {
    const resolve = vi.fn(() =>
      Promise.resolve(new TextEncoder().encode("test-signing-secret")),
    );
    const registry = new SecretProviderRegistry();
    registry.register({ name: "vault", resolve });
    const verifier = new WebhookSignatureVerifier({
      clock: () => now,
      registry,
      secretReference: "vault://webhooks/signing-secret",
    });
    await verifier.initialize();
    expect(
      await verifier.verify({
        body,
        deliveryId,
        signatureHeader: sign(nowSeconds),
      }),
    ).toMatchObject({ verified: true });
    expect(
      await verifier.verify({
        body,
        deliveryId: "delivery-0002",
        signatureHeader: sign(nowSeconds, {
          deliveryIdValue: "delivery-0002",
        }),
      }),
    ).toMatchObject({ verified: true });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the provider or reference is unusable", async () => {
    const registry = new SecretProviderRegistry();
    const missing = new WebhookSignatureVerifier({
      registry,
      secretReference: "vault://webhooks/signing-secret",
    });
    await expect(missing.initialize()).rejects.toThrow("not configured");
    const badReference = new WebhookSignatureVerifier({
      registry,
      secretReference: "not-a-reference",
    });
    await expect(badReference.initialize()).rejects.toThrow(
      "Invalid webhook signing secret reference.",
    );
  });
});
