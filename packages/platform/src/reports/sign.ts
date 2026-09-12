import { sign, verify, type KeyObject } from "node:crypto";
export interface SignedReport { readonly algorithm: "ed25519"; readonly payload: string; readonly signature: string; }
export function signReport(report: Readonly<Record<string, unknown>>, privateKey: KeyObject): SignedReport { const payload = JSON.stringify(report); return Object.freeze({ algorithm: "ed25519", payload, signature: sign(null, Buffer.from(payload), privateKey).toString("base64url") }); }
export function verifyReport(signed: SignedReport, publicKey: KeyObject): boolean { if (signed.algorithm !== "ed25519") return false; return verify(null, Buffer.from(signed.payload), publicKey, Buffer.from(signed.signature, "base64url")); }
