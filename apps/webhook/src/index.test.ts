import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SecretProviderRegistry,
  WebhookSignatureVerifier,
  computeWebhookSignature,
} from "../../../packages/platform/src/index.js";
import {
  createWebhookHandler,
  startWebhookServer,
  type WebhookEventHandler,
} from "./index.js";

const secret = new TextEncoder().encode("test-signing-secret");
const body = JSON.stringify({ event: "target.probed", target: "target_1" });

const servers: Array<Awaited<ReturnType<typeof startWebhookServer>>["server"]> =
  [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

function signatureHeader(
  timestamp: number,
  deliveryId: string,
  bodyValue: string,
  secretValue: Uint8Array = secret,
): string {
  return `t=${timestamp},v1=${computeWebhookSignature(secretValue, timestamp, deliveryId, bodyValue)}`;
}

async function startTestServer(onEvent?: WebhookEventHandler) {
  const registry = new SecretProviderRegistry();
  registry.register({
    name: "local",
    resolve: () => Promise.resolve(secret),
  });
  const verifier = new WebhookSignatureVerifier({
    registry,
    secretReference: "local://file:/keys/webhook",
  });
  await verifier.initialize();
  const started = await startWebhookServer({
    ...(onEvent ? { onEvent } : {}),
    port: 0,
    verifier,
  });
  servers.push(started.server);
  return started.url;
}

function postIncoming(
  url: string,
  options: {
    readonly bodyValue?: string;
    readonly deliveryId?: string;
    readonly headers?: Record<string, string>;
  } = {},
) {
  return fetch(`${url}/v1/webhooks/incoming`, {
    body: options.bodyValue ?? body,
    headers: {
      "Content-Type": "application/json",
      ...(options.deliveryId
        ? { "X-RampSpec-Delivery-Id": options.deliveryId }
        : {}),
      ...(options.headers ?? {}),
    },
    method: "POST",
  });
}

function signedPost(
  url: string,
  deliveryId: string,
  options: {
    readonly bodyValue?: string;
    readonly secretValue?: Uint8Array;
    readonly timestamp?: number;
  } = {},
) {
  const bodyValue = options.bodyValue ?? body;
  const timestamp =
    options.timestamp ?? Math.floor(Date.now() / 1000);
  return postIncoming(url, {
    bodyValue,
    deliveryId,
    headers: {
      "X-RampSpec-Signature": signatureHeader(
        timestamp,
        deliveryId,
        bodyValue,
        options.secretValue,
      ),
    },
  });
}

describe("incoming webhook endpoint", () => {
  it("reports health", async () => {
    const url = await startTestServer();
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("accepts an authentic webhook and delivers it to event processing", async () => {
    const onEvent = vi.fn(() => Promise.resolve());
    const url = await startTestServer(onEvent);
    const response = await signedPost(url, "delivery-1001");
    expect(response.status).toBe(202);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toEqual({ deliveryId: "delivery-1001", status: "accepted" });
    expect(JSON.stringify(payload)).not.toContain("test-signing-secret");
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      deliveryId: "delivery-1001",
      payload: { event: "target.probed", target: "target_1" },
    });
  });

  it("rejects unsigned, wrong-secret, and tampered requests before processing", async () => {
    const onEvent = vi.fn(() => Promise.resolve());
    const url = await startTestServer(onEvent);

    const unsigned = await postIncoming(url, { deliveryId: "delivery-1002" });
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toMatchObject({
      code: "missing-signature",
    });

    const wrongSecret = await signedPost(url, "delivery-1003", {
      secretValue: new TextEncoder().encode("attacker-secret"),
    });
    expect(wrongSecret.status).toBe(401);
    expect(await wrongSecret.json()).toMatchObject({
      code: "invalid-signature",
    });

    const tampered = await postIncoming(url, {
      bodyValue: `${body} `,
      deliveryId: "delivery-1004",
      headers: {
        "X-RampSpec-Signature": signatureHeader(
          Math.floor(Date.now() / 1000),
          "delivery-1004",
          body,
        ),
      },
    });
    expect(tampered.status).toBe(401);
    expect(await tampered.json()).toMatchObject({
      code: "invalid-signature",
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("rejects stale timestamps and replayed delivery IDs", async () => {
    const onEvent = vi.fn(() => Promise.resolve());
    const url = await startTestServer(onEvent);
    const stale = await signedPost(url, "delivery-1005", {
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });
    expect(stale.status).toBe(401);
    expect(await stale.json()).toMatchObject({ code: "stale-timestamp" });

    const first = await signedPost(url, "delivery-1006");
    expect(first.status).toBe(202);
    const replay = await signedPost(url, "delivery-1006");
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({
      code: "replayed-delivery",
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects signed but malformed or oversized bodies without processing", async () => {
    const onEvent = vi.fn(() => Promise.resolve());
    const url = await startTestServer(onEvent);

    const malformed = await signedPost(url, "delivery-1007", {
      bodyValue: "{not json",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      title: "Request rejected",
    });

    const oversized = await signedPost(url, "delivery-1008", {
      bodyValue: "x".repeat(40_000),
    });
    expect(oversized.status).toBe(400);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown routes", async () => {
    const url = await startTestServer();
    const response = await fetch(`${url}/v1/unknown`, { method: "GET" });
    expect(response.status).toBe(404);
  });

  it("never reaches event processing without a verified signature", async () => {
    // Regression: verification happens before parsing and dispatch, so no
    // failure mode below may invoke onEvent.
    const onEvent = vi.fn(() => Promise.resolve());
    const url = await startTestServer(onEvent);
    const attempts = [
      postIncoming(url, { deliveryId: "delivery-1009" }),
      signedPost(url, "delivery-1010", {
        timestamp: Math.floor(Date.now() / 1000) - 10_000,
      }),
      postIncoming(url, {
        bodyValue: body,
        deliveryId: "delivery-1011",
        headers: { "X-RampSpec-Signature": "t=bad,v1=bad" },
      }),
    ];
    const responses = await Promise.all(attempts);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe("webhook handler construction", () => {
  it("exposes the handler for embedding without a server", () => {
    const registry = new SecretProviderRegistry();
    registry.register({
      name: "local",
      resolve: () => Promise.resolve(secret),
    });
    const verifier = new WebhookSignatureVerifier({
      registry,
      secretReference: "local://file:/keys/webhook",
    });
    const onEvent = vi.fn(() => Promise.resolve());
    const handler = createWebhookHandler({ onEvent, verifier });
    expect(typeof handler).toBe("function");
  });
});
