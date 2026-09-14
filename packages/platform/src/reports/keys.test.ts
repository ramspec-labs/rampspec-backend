import { expect, it } from "vitest";
import { SigningKeyRing } from "./keys.js";
it("supports retirement and compromise states", () => { const ring = new SigningKeyRing(); ring.add({ id: "k1", algorithm: "Ed25519", state: "active", createdAt: "2026-01-01" }); expect(ring.retire("k1").state).toBe("retired"); });
