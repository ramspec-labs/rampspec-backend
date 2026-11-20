import { createHash, type KeyObject, sign, verify } from "node:crypto";

export interface SignedReport {
  readonly algorithm: "ed25519";
  readonly payload: string;
  readonly signature: string;
}

export function signReport(
  report: Readonly<Record<string, unknown>>,
  privateKey: KeyObject,
): SignedReport {
  const payload = JSON.stringify(report);
  return Object.freeze({
    algorithm: "ed25519",
    payload,
    signature: sign(null, Buffer.from(payload), privateKey).toString("base64url"),
  });
}

export function verifyReport(
  signed: SignedReport,
  publicKey: KeyObject,
): boolean {
  if (signed.algorithm !== "ed25519") return false;
  return verify(
    null,
    Buffer.from(signed.payload),
    publicKey,
    Buffer.from(signed.signature, "base64url"),
  );
}

export interface ReportBundleVerificationInput {
  readonly bundle: {
    readonly signedReport: {
      readonly algorithm: string;
      readonly payload: string;
      readonly signature: string;
    };
    readonly keyRef?: string;
    readonly expectedDigest?: string;
  };
  readonly maxBundleBytes?: number;
  readonly resolveKey?: (keyRef: string) => KeyObject | undefined;
}

export interface VerificationFinding {
  readonly code:
    | "VALID"
    | "INVALID_ALGORITHM"
    | "BUNDLE_TOO_LARGE"
    | "INVALID_PAYLOAD_JSON"
    | "INVALID_SIGNATURE"
    | "DIGEST_MISMATCH"
    | "KEY_NOT_FOUND"
    | "KEY_UNRESOLVED";
  readonly message: string;
  readonly severity: "info" | "warning" | "error";
}

export interface ReportVerificationResult {
  readonly valid: boolean;
  readonly findings: readonly VerificationFinding[];
  readonly digest?: string | undefined;
  readonly schemaValid?: boolean | undefined;
  readonly signatureValid?: boolean | undefined;
}

const DEFAULT_MAX_BUNDLE_BYTES = 1_048_576; // 1MB bounded limit

export function verifyReportBundle(
  input: ReportBundleVerificationInput,
): ReportVerificationResult {
  const findings: VerificationFinding[] = [];
  const maxBytes = input.maxBundleBytes ?? DEFAULT_MAX_BUNDLE_BYTES;

  if (!input || !input.bundle || !input.bundle.signedReport) {
    return {
      findings: [
        {
          code: "INVALID_PAYLOAD_JSON",
          message: "Malformed bundle structure: missing signedReport.",
          severity: "error",
        },
      ],
      valid: false,
    };
  }

  const { signedReport, keyRef, expectedDigest } = input.bundle;

  // Bounded check: bundle size
  const estimatedSize =
    (signedReport.payload?.length ?? 0) +
    (signedReport.signature?.length ?? 0) +
    (signedReport.algorithm?.length ?? 0);

  if (estimatedSize > maxBytes) {
    findings.push({
      code: "BUNDLE_TOO_LARGE",
      message: `Report bundle exceeds maximum allowed size of ${maxBytes} bytes.`,
      severity: "error",
    });
    return {
      findings,
      valid: false,
    };
  }

  // Schema & JSON check on payload
  let parsedPayload: Record<string, unknown> | undefined;
  let schemaValid = false;
  try {
    if (typeof signedReport.payload !== "string") {
      throw new Error("Payload must be a string");
    }
    parsedPayload = JSON.parse(signedReport.payload) as Record<string, unknown>;
    if (typeof parsedPayload !== "object" || parsedPayload === null) {
      throw new Error("Payload must parse to a JSON object");
    }
    schemaValid = true;
  } catch {
    findings.push({
      code: "INVALID_PAYLOAD_JSON",
      message: "Bundle payload is not valid JSON.",
      severity: "error",
    });
  }

  // Digest calculation
  let digest: string | undefined;
  if (typeof signedReport.payload === "string") {
    digest = createHash("sha256").update(signedReport.payload).digest("hex");
    if (expectedDigest && digest !== expectedDigest.toLowerCase()) {
      findings.push({
        code: "DIGEST_MISMATCH",
        message: `Digest ${digest} does not match expected digest ${expectedDigest}.`,
        severity: "error",
      });
    }
  }

  // Algorithm check
  if (signedReport.algorithm !== "ed25519") {
    findings.push({
      code: "INVALID_ALGORITHM",
      message: `Unsupported signature algorithm: ${signedReport.algorithm}. Only ed25519 is supported.`,
      severity: "error",
    });
  }

  // Key resolution
  let publicKey: KeyObject | undefined;
  if (keyRef) {
    if (input.resolveKey) {
      publicKey = input.resolveKey(keyRef);
      if (!publicKey) {
        findings.push({
          code: "KEY_NOT_FOUND",
          message: `Signing key '${keyRef}' could not be resolved.`,
          severity: "error",
        });
      }
    } else {
      findings.push({
        code: "KEY_UNRESOLVED",
        message: "No key resolver provided for key reference.",
        severity: "warning",
      });
    }
  }

  // Signature verification (only if ed25519, valid payload, and key resolved)
  let signatureValid: boolean | undefined;
  if (publicKey && signedReport.algorithm === "ed25519" && typeof signedReport.payload === "string") {
    try {
      signatureValid = verifyReport(
        {
          algorithm: "ed25519",
          payload: signedReport.payload,
          signature: signedReport.signature,
        },
        publicKey,
      );
      if (!signatureValid) {
        findings.push({
          code: "INVALID_SIGNATURE",
          message: "Cryptographic signature verification failed.",
          severity: "error",
        });
      }
    } catch {
      signatureValid = false;
      findings.push({
        code: "INVALID_SIGNATURE",
        message: "Error occurred during signature verification.",
        severity: "error",
      });
    }
  }

  const hasErrors = findings.some((f) => f.severity === "error");
  if (!hasErrors) {
    findings.push({
      code: "VALID",
      message: "Report bundle verification succeeded.",
      severity: "info",
    });
  }

  return {
    digest,
    findings,
    schemaValid,
    signatureValid,
    valid: !hasErrors,
  };
}
