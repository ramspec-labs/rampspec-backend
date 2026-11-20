import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signReport,
  verifyReport,
  verifyReportBundle,
} from "./sign.js";

describe("report signing", () => {
  it("signs and verifies canonical report payloads", () => {
    const keys = generateKeyPairSync("ed25519");
    const signed = signReport(
      { reportId: "report_1", summary: { passed: 1 } },
      keys.privateKey,
    );
    expect(verifyReport(signed, keys.publicKey)).toBe(true);
    expect(
      verifyReport({ ...signed, payload: `${signed.payload}x` }, keys.publicKey),
    ).toBe(false);
  });

  describe("report bundle verification endpoint logic", () => {
    it("verifies valid signed report bundles deterministically", () => {
      const keys = generateKeyPairSync("ed25519");
      const reportData = { reportId: "report_valid", status: "passed" };
      const signed = signReport(reportData, keys.privateKey);

      const result = verifyReportBundle({
        bundle: {
          keyRef: "key-1",
          signedReport: signed,
        },
        resolveKey: (ref) => (ref === "key-1" ? keys.publicKey : undefined),
      });

      expect(result.valid).toBe(true);
      expect(result.signatureValid).toBe(true);
      expect(result.schemaValid).toBe(true);
      expect(result.digest).toBeDefined();
      expect(result.findings.some((f) => f.code === "VALID")).toBe(true);
    });

    it("verifies digest when expectedDigest is supplied", () => {
      const keys = generateKeyPairSync("ed25519");
      const signed = signReport({ test: 123 }, keys.privateKey);

      const successResult = verifyReportBundle({
        bundle: {
          keyRef: "key-1",
          signedReport: signed,
        },
        resolveKey: () => keys.publicKey,
      });

      const mismatchResult = verifyReportBundle({
        bundle: {
          expectedDigest: "0000000000000000000000000000000000000000000000000000000000000000",
          keyRef: "key-1",
          signedReport: signed,
        },
        resolveKey: () => keys.publicKey,
      });

      expect(successResult.valid).toBe(true);
      expect(mismatchResult.valid).toBe(false);
      expect(mismatchResult.findings.some((f) => f.code === "DIGEST_MISMATCH")).toBe(true);
    });

    it("fails safely on oversized bundles without invoking crypto verify", () => {
      const keys = generateKeyPairSync("ed25519");
      const signed = signReport({ large: "payload" }, keys.privateKey);

      const result = verifyReportBundle({
        bundle: {
          signedReport: signed,
        },
        maxBundleBytes: 10, // very small bound
      });

      expect(result.valid).toBe(false);
      expect(result.findings.some((f) => f.code === "BUNDLE_TOO_LARGE")).toBe(true);
    });

    it("fails safely on malformed JSON payload", () => {
      const result = verifyReportBundle({
        bundle: {
          signedReport: {
            algorithm: "ed25519",
            payload: "{invalid-json",
            signature: "sig",
          },
        },
      });

      expect(result.valid).toBe(false);
      expect(result.schemaValid).toBe(false);
      expect(result.findings.some((f) => f.code === "INVALID_PAYLOAD_JSON")).toBe(true);
    });

    it("detects invalid algorithm and unresolved key references", () => {
      const resultAlgo = verifyReportBundle({
        bundle: {
          signedReport: {
            algorithm: "rsa-sha256",
            payload: JSON.stringify({ a: 1 }),
            signature: "sig",
          },
        },
      });
      expect(resultAlgo.findings.some((f) => f.code === "INVALID_ALGORITHM")).toBe(true);

      const resultKey = verifyReportBundle({
        bundle: {
          keyRef: "missing-key",
          signedReport: {
            algorithm: "ed25519",
            payload: JSON.stringify({ a: 1 }),
            signature: "sig",
          },
        },
        resolveKey: () => undefined,
      });
      expect(resultKey.findings.some((f) => f.code === "KEY_NOT_FOUND")).toBe(true);
    });
  });
});
