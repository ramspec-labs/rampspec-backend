import { expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyGithubSignature } from "./github.js";
it("verifies signed GitHub payloads", () => { const body = "{}"; const sig = `sha256=${createHmac("sha256", "s").update(body).digest("hex")}`; expect(verifyGithubSignature(body, sig, "s")).toBe(true); });
