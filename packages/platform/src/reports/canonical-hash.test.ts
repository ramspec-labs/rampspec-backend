import { expect, it } from "vitest";
import { hashCanonicalReport } from "./canonical-hash.js";
it("ignores signature fields and key order", () => expect(hashCanonicalReport({ b: 2, a: 1, signature: "x" })).toBe(hashCanonicalReport({ a: 1, b: 2, signature: "y" })));
