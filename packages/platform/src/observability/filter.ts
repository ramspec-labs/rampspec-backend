const safeTelemetry = new Set([
  "requestId",
  "tenantId",
  "projectId",
  "targetId",
  "runId",
  "workflowId",
  "runnerId",
  "release",
  "specVersion",
  "suiteId",
]);

export function filterTelemetry(attributes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => safeTelemetry.has(key)),
  );
}

export type SafeActorClass = "anonymous" | "authenticated" | "internal" | "service_account" | "system";

export interface RequestLogEntry {
  readonly actorClass: SafeActorClass;
  readonly correlationId: string;
  readonly durationMs: number;
  readonly method: string;
  readonly routeTemplate: string;
  readonly status: number;
}

/**
 * Fields explicitly prohibited from request logging to prevent credential leaks,
 * PII exposure, and target origin poisoning.
 */
export const PROHIBITED_LOG_FIELDS = Object.freeze([
  "body",
  "evidence",
  "headers",
  "password",
  "secret",
  "targetOrigin",
  "tenantName",
  "token",
] as const);

export function createSafeRequestLog(entry: {
  readonly actorClass: SafeActorClass;
  readonly correlationId: string;
  readonly durationMs: number;
  readonly method: string;
  readonly routeTemplate: string;
  readonly status: number;
  readonly [key: string]: unknown;
}): RequestLogEntry {
  return {
    actorClass: entry.actorClass,
    correlationId: entry.correlationId,
    durationMs: Math.max(0, Math.round(entry.durationMs)),
    method: entry.method.toUpperCase(),
    routeTemplate: entry.routeTemplate,
    status: entry.status,
  };
}
