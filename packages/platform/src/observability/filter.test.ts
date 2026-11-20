import { describe, expect, it } from "vitest";
import {
  createSafeRequestLog,
  filterTelemetry,
  PROHIBITED_LOG_FIELDS,
} from "./filter.js";

describe("observability filtering", () => {
  it("drops bodies and credentials from telemetry", () => {
    expect(filterTelemetry({ body: "sensitive", runId: "r", token: "secret" })).toEqual({
      runId: "r",
    });
  });

  it("creates privacy-safe structured request logs with route template and actor class", () => {
    const log = createSafeRequestLog({
      actorClass: "authenticated",
      body: { sensitive: "payload" },
      correlationId: "req-12345",
      durationMs: 14.8,
      evidence: "evidence-binary-blob",
      headers: { authorization: "Bearer secret-token" },
      method: "post",
      routeTemplate: "/v1/reference-runs",
      status: 201,
      targetOrigin: "https://anchor.example",
      tenantName: "Acme Corp",
      token: "secret-bearer",
    });

    expect(log).toEqual({
      actorClass: "authenticated",
      correlationId: "req-12345",
      durationMs: 15,
      method: "POST",
      routeTemplate: "/v1/reference-runs",
      status: 201,
    });

    // Verify all prohibited fields are absent
    for (const field of PROHIBITED_LOG_FIELDS) {
      expect(field in log).toBe(false);
    }
  });

  it("documents and tests prohibited fields", () => {
    expect(PROHIBITED_LOG_FIELDS).toContain("headers");
    expect(PROHIBITED_LOG_FIELDS).toContain("targetOrigin");
    expect(PROHIBITED_LOG_FIELDS).toContain("evidence");
    expect(PROHIBITED_LOG_FIELDS).toContain("token");
    expect(PROHIBITED_LOG_FIELDS).toContain("tenantName");
    expect(PROHIBITED_LOG_FIELDS).toContain("body");
  });
});
