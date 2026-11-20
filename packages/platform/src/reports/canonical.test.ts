import { describe, expect, it } from "vitest";

import {
  buildCanonicalReport,
  encodeCanonicalReport,
  verifyCanonicalReportEncoding,
} from "./canonical.js";

describe("canonical report encoding", () => {
  it("finalizes one immutable report", () => {
    expect(
      buildCanonicalReport({
        checks: { failed: 0, passed: 1, skipped: 0 },
        findings: [],
        indeterminate: false,
        reportId: "r",
        runId: "run",
        schemaVersion: "1",
        suiteHash: "h",
        targetId: "t",
      }),
    ).toHaveProperty("finalizedAt");
  });

  it("defaults encodingVersion to 1.0 while preserving existing v1 reports", () => {
    const report = buildCanonicalReport({
      checks: { failed: 0, passed: 1, skipped: 0 },
      findings: [],
      indeterminate: false,
      reportId: "r1",
      runId: "run1",
      schemaVersion: "1.0.0",
      suiteHash: "h",
      targetId: "t1",
    });
    expect(report.encodingVersion).toBe("1.0");

    // Report without encodingVersion resolves to 1.0 (v1 compatibility)
    const legacyReport = {
      checks: { failed: 0, passed: 1, skipped: 0 },
      reportId: "legacy",
    };
    const verification = verifyCanonicalReportEncoding(legacyReport);
    expect(verification.encodingVersion).toBe("1.0");
    expect(verification.valid).toBe(true);
  });

  it("deterministically encodes canonical reports", () => {
    const reportA = { b: 2, a: 1, encodingVersion: "1.0" };
    const reportB = { a: 1, b: 2, encodingVersion: "1.0" };
    expect(encodeCanonicalReport(reportA)).toBe(encodeCanonicalReport(reportB));
    expect(encodeCanonicalReport(reportA)).toBe(
      '{"a":1,"b":2,"encodingVersion":"1.0"}',
    );
  });

  it("fails closed on unknown encoding versions without altering stored reports", () => {
    const invalidReport = Object.freeze({
      encodingVersion: "99.0",
      reportId: "r_future",
    });

    expect(() => verifyCanonicalReportEncoding(invalidReport)).toThrow(
      "Unknown canonical encoding version",
    );
    expect(() => encodeCanonicalReport(invalidReport)).toThrow(
      "Unknown canonical encoding version",
    );
    expect(() =>
      buildCanonicalReport({
        checks: { failed: 0, passed: 1, skipped: 0 },
        encodingVersion: "99.0",
        findings: [],
        indeterminate: false,
        reportId: "r_future",
        runId: "run",
        schemaVersion: "1",
        suiteHash: "h",
        targetId: "t",
      }),
    ).toThrow("Unsupported canonical encoding version");

    // Original object unmodified
    expect(invalidReport.encodingVersion).toBe("99.0");
  });
});
