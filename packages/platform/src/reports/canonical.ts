export type CanonicalReport = {
  encodingVersion?: string;
  schemaVersion: string;
  reportId: string;
  runId: string;
  targetId: string;
  suiteHash: string;
  checks: { passed: number; failed: number; skipped: number };
  findings: readonly string[];
  indeterminate: boolean;
  finalizedAt: string;
};

export const SUPPORTED_CANONICAL_ENCODINGS = ["1.0", "1"] as const;
export type SupportedCanonicalEncoding = (typeof SUPPORTED_CANONICAL_ENCODINGS)[number];

export function buildCanonicalReport(
  input: Omit<CanonicalReport, "finalizedAt">,
  now = new Date(),
): CanonicalReport {
  if (input.checks.passed + input.checks.failed + input.checks.skipped < 1) {
    throw new Error("Report requires checks.");
  }
  const encodingVersion = input.encodingVersion ?? "1.0";
  if (!SUPPORTED_CANONICAL_ENCODINGS.includes(encodingVersion as SupportedCanonicalEncoding)) {
    throw new Error(`Unsupported canonical encoding version: ${encodingVersion}`);
  }
  return Object.freeze({
    ...input,
    encodingVersion,
    finalizedAt: now.toISOString(),
  });
}

export function encodeCanonicalReport(
  report: Readonly<Record<string, unknown>>,
): string {
  const version = (report.encodingVersion as string | undefined) ?? "1.0";
  if (!SUPPORTED_CANONICAL_ENCODINGS.includes(version as SupportedCanonicalEncoding)) {
    throw new Error(`Unknown canonical encoding version: ${version}`);
  }

  function canonical(value: unknown): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map(canonical).join(",")}]`;
    }
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }

  return canonical(report);
}

export function verifyCanonicalReportEncoding(
  report: Readonly<Record<string, unknown>>,
): { readonly valid: boolean; readonly encodingVersion: string } {
  const version = (report.encodingVersion as string | undefined) ?? "1.0";
  if (!SUPPORTED_CANONICAL_ENCODINGS.includes(version as SupportedCanonicalEncoding)) {
    throw new Error(`Unknown canonical encoding version: ${version}`);
  }
  return { encodingVersion: version, valid: true };
}
