import { sign, verify, type KeyObject } from "node:crypto";

export interface SignatureMetadata {
  readonly keyId?: string;
  readonly activationVersion?: number;
}

export interface SignedReport {
  readonly algorithm: "ed25519";
  readonly payload: string;
  readonly signature: string;
  readonly keyId?: string;
  readonly activationVersion?: number;
}

export function signReport(
  report: Readonly<Record<string, unknown>>,
  privateKey: KeyObject,
  metadata?: SignatureMetadata,
): SignedReport {
  const payload = JSON.stringify(report);
  const signature = sign(null, Buffer.from(payload), privateKey).toString(
    "base64url",
  );

  return Object.freeze({
    algorithm: "ed25519",
    ...(metadata?.keyId !== undefined ? { keyId: metadata.keyId } : {}),
    ...(metadata?.activationVersion !== undefined
      ? { activationVersion: metadata.activationVersion }
      : {}),
    payload,
    signature,
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
