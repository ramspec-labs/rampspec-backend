import { describe, expect, it } from "vitest";
import { compareContracts } from "./compatibility.js";
describe("contract compatibility", () => { it("classifies added and removed operations", () => { const before = { paths: { "/health": { get: { operationId: "health" } }, "/old": { get: { operationId: "old" } } } }; const after = { paths: { "/health": { get: { operationId: "health" } }, "/new": { post: { operationId: "new" } } } }; expect(compareContracts(before, after)).toEqual({ addedOperations: ["POST /new new"], breaking: true, removedOperations: ["GET /old old"] }); }); });
