import { expect, it } from "vitest";
import { validateSep34Claims } from "./rule-pack.js";
it("does no SEP-34 work when disabled", () => expect(validateSep34Claims({}, { issuer: "i", audience: "a", enabled: false }).enabled).toBe(false));
it("validates issuer and expiry", () => expect(validateSep34Claims({ iss: "i", aud: "a", sub: "s", kid: "k", txid: "t", iat: 1, exp: 3 }, { issuer: "i", audience: "a", now: 2 }).valid).toBe(true));
