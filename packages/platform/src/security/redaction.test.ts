import { describe, expect, it } from "vitest";
import { assertNoCredentialMaterial } from "./redaction.js";
describe("security redaction checks", () => { it("rejects credential material and allows references", () => { expect(() => assertNoCredentialMaterial({ client_secret: "abc" })).toThrow("Credential"); expect(() => assertNoCredentialMaterial({ secretReference: "vault://payments" })).not.toThrow(); }); });
