import { describe, expect, it } from "vitest";
import { evaluateCorridorCase } from "./negative.js";
describe("SEP-31 corridor negatives", () => { it("deduplicates callbacks", () => expect(evaluateCorridorCase({ kind: "duplicate_callback", amount: 1, quoted: 1, callbackId: "cb", seenCallbacks: new Set(["cb"]) }).idempotent).toBe(true)); it("rejects underpayment", () => expect(evaluateCorridorCase({ kind: "underpayment", amount: 9, quoted: 10 }).accepted).toBe(false)); });
