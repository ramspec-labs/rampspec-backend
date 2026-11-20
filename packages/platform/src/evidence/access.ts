import type { AuditService } from "../audit/service.js";

export type EvidenceClassification =
  | "internal"
  | "prohibited_quarantine"
  | "public"
  | "sensitive";

export function classifyEvidence(input: {
  readonly mediaType: string;
  readonly containsCredentials: boolean;
  readonly requestedPublic: boolean;
}): EvidenceClassification {
  if (input.containsCredentials) return "prohibited_quarantine";
  if (input.requestedPublic && input.mediaType.startsWith("application/"))
    return "public";
  return input.mediaType.startsWith("text/") ? "internal" : "sensitive";
}

export function canReadEvidence(
  role: "admin" | "auditor" | "maintainer" | "owner" | "runner" | "viewer",
  classification: EvidenceClassification,
  raw = false,
): boolean {
  if (classification === "prohibited_quarantine") return role === "owner";
  if (raw && !["owner", "admin", "auditor"].includes(role)) return false;
  return (
    classification !== "sensitive" ||
    ["owner", "admin", "auditor", "maintainer"].includes(role)
  );
}

export type EvidenceDownloadOutcome =
  | "allowed"
  | "denied_cross_tenant"
  | "denied_not_found"
  | "denied_permission";

export interface AuditEvidenceDownloadInput {
  readonly actorId: string;
  readonly actorType?: "service_account" | "system" | "user";
  readonly auditService: AuditService;
  readonly evidenceId: string;
  readonly organizationId: string;
  readonly outcome: EvidenceDownloadOutcome;
  readonly requestId: string;
  readonly traceId?: string;
}

export async function auditEvidenceDownload(
  input: AuditEvidenceDownloadInput,
): Promise<void> {
  await input.auditService.record({
    action: "evidence.download",
    actorId: input.actorId,
    actorType: input.actorType ?? "user",
    metadata: {
      evidenceId: input.evidenceId,
      outcome: input.outcome,
    },
    organizationId: input.organizationId,
    requestId: input.requestId,
    targetId: input.evidenceId,
    targetType: "evidence",
    ...(input.traceId ? { traceId: input.traceId } : {}),
  });
}
