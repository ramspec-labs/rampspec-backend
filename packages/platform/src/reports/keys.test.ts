import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SigningKeyRing } from "./keys.js";
import { signReport, verifyReport } from "./sign.js";

describe("signing key ring and rotation metadata", () => {
  it("supports retirement and compromise states", () => {
    const ring = new SigningKeyRing();
    ring.add({
      algorithm: "Ed25519",
      createdAt: "2026-01-01",
      id: "k1",
      state: "active",
    });
    expect(ring.retire("k1").state).toBe("retired");
  });

  it("records stable key ID and activation version metadata in signatures", () => {
    const ring = new SigningKeyRing();
    const keys = generateKeyPairSync("ed25519");

    ring.add(
      {
        activationVersion: 2,
        algorithm: "Ed25519",
        createdAt: "2026-02-01",
        id: "key-rot-2026",
        publicKey: keys.publicKey,
        state: "active",
      },
      keys.privateKey,
    );

    const signer = ring.getSigner("key-rot-2026");
    expect(signer).toBeDefined();

    const report = { checks: { passed: 1 }, reportId: "report_hist_1" };
    const signed = signReport(report, signer!.privateKey, {
      activationVersion: signer!.key.activationVersion,
      keyId: signer!.key.id,
    });

    expect(signed.keyId).toBe("key-rot-2026");
    expect(signed.activationVersion).toBe(2);
    expect(verifyReport(signed, signer!.key.publicKey!)).toBe(true);
  });

  it("historical reports remain verifiable after signing key rotation", () => {
    const ring = new SigningKeyRing();
    const keyV1 = generateKeyPairSync("ed25519");
    const keyV2 = generateKeyPairSync("ed25519");

    ring.add(
      {
        activationVersion: 1,
        algorithm: "Ed25519",
        createdAt: "2026-01-01",
        id: "k1",
        publicKey: keyV1.publicKey,
        state: "active",
      },
      keyV1.privateKey,
    );

    // Sign report with V1
    const signerV1 = ring.getSigner("k1")!;
    const report1 = { checks: { passed: 2 }, reportId: "report_v1" };
    const signedV1 = signReport(report1, signerV1.privateKey, {
      activationVersion: signerV1.key.activationVersion,
      keyId: signerV1.key.id,
    });

    // Rotate: retire V1 and activate V2
    ring.retire("k1", "retired");
    ring.add(
      {
        activationVersion: 2,
        algorithm: "Ed25519",
        createdAt: "2026-06-01",
        id: "k2",
        publicKey: keyV2.publicKey,
        state: "active",
      },
      keyV2.privateKey,
    );

    // Historical report signed by k1 remains verifiable using k1's public key
    const historicalKey = ring.getKey(signedV1.keyId!);
    expect(historicalKey?.state).toBe("retired");
    expect(verifyReport(signedV1, historicalKey!.publicKey!)).toBe(true);
  });

  it("disabled, retired, or unknown keys cannot sign new reports", () => {
    const ring = new SigningKeyRing();
    const keys = generateKeyPairSync("ed25519");

    ring.add(
      {
        algorithm: "Ed25519",
        createdAt: "2026-01-01",
        id: "k_compromised",
        publicKey: keys.publicKey,
        state: "compromised",
      },
      keys.privateKey,
    );

    expect(ring.getSigner("k_compromised")).toBeUndefined();
    expect(ring.getSigner("unknown_key")).toBeUndefined();
    expect(() => ring.retire("k_compromised", "active")).toThrow(
      "Compromised signing key cannot be reactivated",
    );
  });
});
