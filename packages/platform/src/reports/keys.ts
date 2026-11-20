import type { KeyObject } from "node:crypto";

export type SigningKey = {
  readonly id: string;
  readonly algorithm: "Ed25519";
  readonly state: "active" | "retired" | "compromised";
  readonly createdAt: string;
  readonly activationVersion?: number;
  readonly publicKey?: KeyObject;
};

export interface SigningKeyProvider {
  getKey(id: string): SigningKey | undefined;
  getSigner(id: string): { key: SigningKey; privateKey: KeyObject } | undefined;
}

export class SigningKeyRing implements SigningKeyProvider {
  private readonly keys = new Map<string, SigningKey>();
  private readonly signers = new Map<string, KeyObject>();

  add(key: SigningKey, privateKey?: KeyObject): void {
    if (key.algorithm !== "Ed25519") {
      throw new Error("Unsupported signing algorithm.");
    }
    const activationVersion = key.activationVersion ?? 1;
    this.keys.set(
      key.id,
      Object.freeze({
        ...key,
        activationVersion,
      }),
    );
    if (privateKey) {
      this.signers.set(key.id, privateKey);
    }
  }

  retire(id: string, state: SigningKey["state"] = "retired"): SigningKey {
    const key = this.keys.get(id);
    if (!key) throw new Error("Signing key not found.");
    if (key.state === "compromised" && state === "active") {
      throw new Error("Compromised signing key cannot be reactivated.");
    }
    const updated = Object.freeze({ ...key, state });
    this.keys.set(id, updated);
    return updated;
  }

  get(id: string): SigningKey | undefined {
    return this.keys.get(id);
  }

  getKey(id: string): SigningKey | undefined {
    return this.keys.get(id);
  }

  getSigner(id: string): { key: SigningKey; privateKey: KeyObject } | undefined {
    const key = this.keys.get(id);
    if (!key) return undefined;
    if (key.state !== "active") return undefined;
    const privateKey = this.signers.get(id);
    if (!privateKey) return undefined;
    return { key, privateKey };
  }
}
