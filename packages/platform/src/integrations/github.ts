import { createHmac, timingSafeEqual } from "node:crypto";
export function verifyGithubSignature(body: string, signature: string, secret: string) { const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`; return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
