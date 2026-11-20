import { describe, expect, it } from "vitest";
import {
  applyLegalHold,
  planPurge,
  releaseLegalHold,
  type RetentionArtifact
} from "./retention.js";

describe("retention purge", () => {
  it("selects only expired non-deleted artifacts", () => {
    expect(
      planPurge(
        [
          { id: "a", expiresAt: "2026-09-11T00:00:00.000Z", status: "finalized" },
          { id: "b", expiresAt: "2026-09-13T00:00:00.000Z", status: "finalized" },
          { id: "c", expiresAt: "2026-09-10T00:00:00.000Z", status: "deleted" }
        ],
        new Date("2026-09-12T00:00:00.000Z")
      )
    ).toEqual(["a"]);
  });

  it("skips expired artifacts when active legal hold is present", () => {
    const heldArtifact: RetentionArtifact = {
      id: "held-1",
      expiresAt: "2026-09-11T00:00:00.000Z",
      status: "finalized",
      tenantId: "tenant-1",
      legalHold: {
        holdId: "hold-1",
        tenantId: "tenant-1",
        reason: "Litigation investigation",
        appliedBy: "user-auditor",
        appliedAt: "2026-09-10T00:00:00.000Z",
        active: true
      }
    };
    const regularArtifact: RetentionArtifact = {
      id: "regular-1",
      expiresAt: "2026-09-11T00:00:00.000Z",
      status: "finalized",
      tenantId: "tenant-1"
    };

    const purgeList = planPurge([heldArtifact, regularArtifact], new Date("2026-09-12T00:00:00.000Z"));
    expect(purgeList).toEqual(["regular-1"]);
  });

  it("applies tenant-authorized legal hold with audit transition", () => {
    const artifact: RetentionArtifact = {
      id: "art-1",
      expiresAt: "2026-09-11T00:00:00.000Z",
      status: "finalized",
      tenantId: "tenant-a"
    };

    const { artifact: heldArtifact, auditEvent } = applyLegalHold(artifact, {
      holdId: "hold-123",
      tenantId: "tenant-a",
      operatorId: "op-1",
      role: "auditor",
      reason: "Regulatory audit inquiry"
    });

    expect(heldArtifact.legalHold?.active).toBe(true);
    expect(heldArtifact.legalHold?.reason).toBe("Regulatory audit inquiry");
    expect(auditEvent.action).toBe("hold_applied");
    expect(auditEvent.tenantId).toBe("tenant-a");
    expect(auditEvent.operatorId).toBe("op-1");
  });

  it("enforces tenant boundary and role authorization on legal holds", () => {
    const artifact: RetentionArtifact = {
      id: "art-1",
      expiresAt: "2026-09-11T00:00:00.000Z",
      status: "finalized",
      tenantId: "tenant-a"
    };

    // Unauthorized role
    expect(() =>
      applyLegalHold(artifact, {
        holdId: "h-1",
        tenantId: "tenant-a",
        operatorId: "op-1",
        role: "viewer",
        reason: "Not allowed"
      })
    ).toThrow("Unauthorized");

    // Cross-tenant mismatch
    expect(() =>
      applyLegalHold(artifact, {
        holdId: "h-1",
        tenantId: "tenant-other",
        operatorId: "op-1",
        role: "admin",
        reason: "Mismatch"
      })
    ).toThrow("boundary violation");
  });

  it("releases legal hold without synchronous data deletion and emits audit event", () => {
    const heldArtifact: RetentionArtifact = {
      id: "art-1",
      expiresAt: "2026-09-11T00:00:00.000Z",
      status: "finalized",
      tenantId: "tenant-a",
      legalHold: {
        holdId: "hold-123",
        tenantId: "tenant-a",
        reason: "Regulatory audit inquiry",
        appliedBy: "op-1",
        appliedAt: "2026-09-10T00:00:00.000Z",
        active: true
      }
    };

    const { artifact: releasedArtifact, auditEvent } = releaseLegalHold(heldArtifact, {
      tenantId: "tenant-a",
      operatorId: "op-admin",
      role: "admin",
      reason: "Audit inquiry concluded"
    });

    expect(releasedArtifact.legalHold?.active).toBe(false);
    expect(releasedArtifact.legalHold?.releasedBy).toBe("op-admin");
    // Ensure release does NOT delete data synchronously
    expect(releasedArtifact.status).toBe("finalized");
    expect(auditEvent.action).toBe("hold_released");

    // Once released, standard purge will now include it
    const purgeList = planPurge([releasedArtifact], new Date("2026-09-12T00:00:00.000Z"));
    expect(purgeList).toEqual(["art-1"]);
  });
});
