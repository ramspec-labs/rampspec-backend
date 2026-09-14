const safe = new Set(["requestId", "tenantId", "projectId", "targetId", "runId", "workflowId", "runnerId", "release", "specVersion", "suiteId"]);
export function filterTelemetry(attributes: Record<string, unknown>) { return Object.fromEntries(Object.entries(attributes).filter(([key]) => safe.has(key))); }
