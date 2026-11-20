import { describe, expect, it } from "vitest";

import { AuditService, InMemoryAuditStore } from "../audit/service.js";
import {
  auditEvidenceDownload,
  canReadEvidence,
  classifyEvidence,
} from "./access.js";

describe("evidence access", () => {
  it("classifies credentials into quarantine and public-safe media", () => {
    expect(
      classifyEvidence({
        containsCredentials: true,
        mediaType: "application/json",
        requestedPublic: true,
      }),
    ).toBe("prohibited_quarantine");
    expect(
      classifyEvidence({
        containsCredentials: false,
        mediaType: "application/json",
        requestedPublic: true,
      }),
    ).toBe("public");
  });

  it("restricts raw, sensitive, and quarantine reads", () => {
    expect(canReadEvidence("viewer", "internal", true)).toBe(false);
    expect(canReadEvidence("maintainer", "sensitive")).toBe(true);
    expect(canReadEvidence("admin", "prohibited_quarantine")).toBe(false);
    expect(canReadEvidence("owner", "prohibited_quarantine")).toBe(true);
  });
});

describe("audit evidence downloads", () => {
  it("emits audit events containing actor, tenant, evidence ID, and outcome without sensitive fields", async () => {
    const store = new InMemoryAuditStore();
    const auditService = new AuditService(store);

    await auditEvidenceDownload({
      actorId: "user-123",
      actorType: "user",
      auditService,
      evidenceId: "artifact_00000000-0000-4000-8000-000000000001",
      organizationId: "org-stellar",
      outcome: "allowed",
      requestId: "req-1",
    });

    const events = await auditService.list("org-stellar");
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event).toMatchObject({
      action: "evidence.download",
      actorId: "user-123",
      actorType: "user",
      metadata: {
        evidenceId: "artifact_00000000-0000-4000-8000-000000000001",
        outcome: "allowed",
      },
      organizationId: "org-stellar",
      requestId: "req-1",
      targetId: "artifact_00000000-0000-4000-8000-000000000001",
      targetType: "evidence",
    });

    // Verify no secret, content, or signed URL fields exist in metadata
    const metadataKeys = Object.keys(event?.metadata ?? {});
    expect(metadataKeys).toEqual(["evidenceId", "outcome"]);
  });

  it("records denied and cross-tenant attempts safely without confirming existence", async () => {
    const store = new InMemoryAuditStore();
    const auditService = new AuditService(store);

    await auditEvidenceDownload({
      actorId: "user-attacker",
      auditService,
      evidenceId: "artifact_unknown_or_other_tenant",
      organizationId: "org-victim",
      outcome: "denied_cross_tenant",
      requestId: "req-2",
    });

    await auditEvidenceDownload({
      actorId: "user-restricted",
      auditService,
      evidenceId: "artifact_00000000-0000-4000-8000-000000000002",
      organizationId: "org-victim",
      outcome: "denied_permission",
      requestId: "req-3",
    });

    const events = await auditService.list("org-victim");
    expect(events).toHaveLength(2);
    expect(events[0]?.metadata.outcome).toBe("denied_cross_tenant");
    expect(events[1]?.metadata.outcome).toBe("denied_permission");
  });
});
