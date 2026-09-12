import { describe, expect, it } from "vitest";
import { planPurge } from "./retention.js";
describe("retention purge", () => { it("selects only expired non-deleted artifacts", () => { expect(planPurge([{ id: "a", expiresAt: "2026-09-11T00:00:00.000Z", status: "finalized" }, { id: "b", expiresAt: "2026-09-13T00:00:00.000Z", status: "finalized" }, { id: "c", expiresAt: "2026-09-10T00:00:00.000Z", status: "deleted" }], new Date("2026-09-12T00:00:00.000Z"))).toEqual(["a"]); }); });
