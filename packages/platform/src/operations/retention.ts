export interface LegalHold {
  readonly holdId: string;
  readonly tenantId: string;
  readonly reason: string;
  readonly appliedBy: string;
  readonly appliedAt: string;
  readonly releasedBy?: string;
  readonly releasedAt?: string;
  readonly active: boolean;
}

export interface HoldAuditEvent {
  readonly eventId: string;
  readonly action: "hold_applied" | "hold_released";
  readonly artifactId: string;
  readonly tenantId: string;
  readonly operatorId: string;
  readonly reason: string;
  readonly timestamp: string;
}

export interface RetentionArtifact {
  readonly id: string;
  readonly expiresAt: string;
  readonly status: "deleted" | "finalized" | "pending";
  readonly tenantId?: string;
  readonly legalHold?: LegalHold;
}

export function applyLegalHold(
  artifact: RetentionArtifact,
  input: {
    readonly holdId: string;
    readonly tenantId: string;
    readonly operatorId: string;
    readonly role: "admin" | "auditor" | "maintainer" | "owner" | "runner" | "viewer";
    readonly reason: string;
    readonly clock?: () => Date;
  }
): { artifact: RetentionArtifact; auditEvent: HoldAuditEvent } {
  if (!["owner", "admin", "auditor"].includes(input.role)) {
    throw new Error("Unauthorized: operator role cannot apply legal hold.");
  }
  if (!input.reason.trim()) {
    throw new Error("Legal hold reason is required.");
  }
  if (artifact.tenantId && artifact.tenantId !== input.tenantId) {
    throw new Error("Unauthorized: tenant isolation boundary violation.");
  }
  if (artifact.legalHold?.active) {
    throw new Error("Legal hold is already active on this artifact.");
  }

  const now = (input.clock ?? (() => new Date()))().toISOString();
  const legalHold: LegalHold = Object.freeze({
    holdId: input.holdId,
    tenantId: input.tenantId,
    reason: input.reason.trim(),
    appliedBy: input.operatorId,
    appliedAt: now,
    active: true
  });

  const updatedArtifact: RetentionArtifact = Object.freeze({
    ...artifact,
    tenantId: artifact.tenantId ?? input.tenantId,
    legalHold
  });

  const auditEvent: HoldAuditEvent = Object.freeze({
    eventId: `audit_${now}_${input.holdId}`,
    action: "hold_applied",
    artifactId: artifact.id,
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    reason: input.reason.trim(),
    timestamp: now
  });

  return { artifact: updatedArtifact, auditEvent };
}

export function releaseLegalHold(
  artifact: RetentionArtifact,
  input: {
    readonly tenantId: string;
    readonly operatorId: string;
    readonly role: "admin" | "auditor" | "maintainer" | "owner" | "runner" | "viewer";
    readonly reason: string;
    readonly clock?: () => Date;
  }
): { artifact: RetentionArtifact; auditEvent: HoldAuditEvent } {
  if (!["owner", "admin", "auditor"].includes(input.role)) {
    throw new Error("Unauthorized: operator role cannot release legal hold.");
  }
  if (!input.reason.trim()) {
    throw new Error("Legal hold release reason is required.");
  }
  if (artifact.tenantId && artifact.tenantId !== input.tenantId) {
    throw new Error("Unauthorized: tenant isolation boundary violation.");
  }
  if (!artifact.legalHold || !artifact.legalHold.active) {
    throw new Error("No active legal hold to release.");
  }

  const now = (input.clock ?? (() => new Date()))().toISOString();
  const legalHold: LegalHold = Object.freeze({
    ...artifact.legalHold,
    releasedBy: input.operatorId,
    releasedAt: now,
    active: false
  });

  // Releasing legal hold does not synchronously delete data (preserves existing status)
  const updatedArtifact: RetentionArtifact = Object.freeze({
    ...artifact,
    legalHold
  });

  const auditEvent: HoldAuditEvent = Object.freeze({
    eventId: `audit_${now}_${artifact.legalHold.holdId}`,
    action: "hold_released",
    artifactId: artifact.id,
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    reason: input.reason.trim(),
    timestamp: now
  });

  return { artifact: updatedArtifact, auditEvent };
}

export function planPurge(artifacts: readonly RetentionArtifact[], now: Date = new Date()): readonly string[] {
  return artifacts
    .filter((artifact) => {
      // Cleanup must skip held objects
      if (artifact.legalHold?.active) {
        return false;
      }
      return artifact.status !== "deleted" && Date.parse(artifact.expiresAt) <= now.getTime();
    })
    .map((artifact) => artifact.id);
}
