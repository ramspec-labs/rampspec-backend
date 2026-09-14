import { expect, it } from "vitest";
import { applyDisposition } from "./triage.js";
it("rejects expired accepted exceptions", () => expect(() => applyDisposition({ findingId: "f", status: "accepted", owner: "o", expiresAt: "2020-01-01", note: "risk" })).toThrow("expired"));
