import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  SecretProviderRegistry,
  WebhookSignatureVerifier,
  loadConfig,
  type WebhookVerificationResult,
} from "../../../packages/platform/src/index.js";

export const service = { kind: "edge", name: "webhook" } as const;

const version = "0.1.0";
const maximumBodyBytes = 32_768;

export interface WebhookEvent {
  readonly deliveryId: string;
  readonly payload: unknown;
}

export type WebhookEventHandler = (
  event: WebhookEvent,
) => Promise<void>;

export interface WebhookVerifierLike {
  verify(input: {
    readonly body: string | Uint8Array;
    readonly deliveryId: string | undefined;
    readonly signatureHeader: string | undefined;
  }): Promise<WebhookVerificationResult>;
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(value)}\n`);
}

function singleHeader(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.byteLength;
    if (length > maximumBodyBytes)
      throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * HTTP handler for incoming webhooks.
 *
 * The raw body is verified against the configured signing secret before
 * it is parsed or handed to event processing: unauthenticated, stale,
 * malformed, or replayed requests are rejected with 401 and never reach
 * `onEvent`. Rejection responses carry only a reason code; raw secrets
 * and payloads are never logged or echoed.
 */
export function createWebhookHandler(options: {
  readonly onEvent?: WebhookEventHandler;
  readonly verifier: WebhookVerifierLike;
}) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "ok", version });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/webhooks/incoming") {
        const rawBody = await readRawBody(request);
        const result = await options.verifier.verify({
          body: rawBody,
          deliveryId: singleHeader(request, "x-rampspec-delivery-id"),
          signatureHeader: singleHeader(request, "x-rampspec-signature"),
        });
        if (!result.verified) {
          sendJson(response, 401, {
            code: result.reason,
            status: 401,
            title: "Webhook signature verification failed",
          });
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(rawBody.toString("utf8"));
        } catch {
          throw new Error("Request body must be valid JSON.");
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload))
          throw new Error("JSON object required.");
        await options.onEvent?.({
          deliveryId: result.deliveryId,
          payload,
        });
        sendJson(response, 202, {
          deliveryId: result.deliveryId,
          status: "accepted",
        });
        return;
      }
      sendJson(response, 404, { status: 404, title: "Route not found" });
    } catch (error) {
      sendJson(response, 400, {
        detail: error instanceof Error ? error.message : "Invalid request.",
        status: 400,
        title: "Request rejected",
      });
    }
  };
}

export async function startWebhookServer(
  options: {
    readonly host?: string;
    readonly onEvent?: WebhookEventHandler;
    readonly port?: number;
    readonly registry?: SecretProviderRegistry;
    readonly verifier?: WebhookVerifierLike;
  } = {},
): Promise<{ readonly server: Server; readonly url: string }> {
  let verifier = options.verifier;
  if (!verifier) {
    const config = loadConfig("webhook");
    if (!config.WEBHOOK_SIGNING_SECRET_REF)
      throw new Error("WEBHOOK_SIGNING_SECRET_REF is required.");
    const registry = options.registry ?? new SecretProviderRegistry();
    const configured = new WebhookSignatureVerifier({
      registry,
      secretReference: config.WEBHOOK_SIGNING_SECRET_REF,
    });
    await configured.initialize();
    verifier = configured;
  }
  const handler = createWebhookHandler({
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    verifier,
  });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(
      options.port ?? Number(process.env.PORT ?? "4000"),
      host,
      () => resolveListen(),
    );
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Webhook server address is unavailable.");
  return { server, url: `http://${host}:${address.port}` };
}
