import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signReport, verifyReport } from "./sign.js";
describe("report signing", () => { it("signs and verifies canonical report payloads", () => { const keys = generateKeyPairSync("ed25519"); const signed = signReport({ reportId: "report_1", summary: { passed: 1 } }, keys.privateKey); expect(verifyReport(signed, keys.publicKey)).toBe(true); expect(verifyReport({ ...signed, payload: `${signed.payload}x` }, keys.publicKey)).toBe(false); }); });
