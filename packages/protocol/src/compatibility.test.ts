import { describe, expect, it } from "vitest";
import {
  compareContracts,
  compareJsonSchemas,
  evaluateSchemaCompatibilityGate,
} from "./compatibility.js";

describe("contract compatibility", () => {
  it("classifies added and removed operations", () => {
    const before = {
      paths: {
        "/health": { get: { operationId: "health" } },
        "/old": { get: { operationId: "old" } },
      },
    };
    const after = {
      paths: {
        "/health": { get: { operationId: "health" } },
        "/new": { post: { operationId: "new" } },
      },
    };
    expect(compareContracts(before, after)).toEqual({
      addedOperations: ["POST /new new"],
      breaking: true,
      removedOperations: ["GET /old old"],
    });
  });

  describe("schema compatibility gate", () => {
    const baseSchema = {
      $id: "https://schemas.example.com/item.json",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
      },
      required: ["id"],
      type: "object",
    };

    it("allows non-breaking additive property additions", () => {
      const additive = {
        ...baseSchema,
        properties: {
          ...baseSchema.properties,
          description: { type: "string" },
        },
      };

      const result = compareJsonSchemas("item.json", baseSchema, additive);
      expect(result.breaking).toBe(false);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]?.kind).toBe("added_property");

      const gate = evaluateSchemaCompatibilityGate([result]);
      expect(gate.passed).toBe(true);
      expect(gate.breakingCount).toBe(0);
    });

    it("detects breaking property removals", () => {
      const removed = {
        ...baseSchema,
        properties: {
          id: { type: "string" },
        },
      };

      const result = compareJsonSchemas("item.json", baseSchema, removed);
      expect(result.breaking).toBe(true);
      expect(result.changes.some((c) => c.kind === "removed_property")).toBe(true);

      const gate = evaluateSchemaCompatibilityGate([result]);
      expect(gate.passed).toBe(false);
      expect(gate.breakingCount).toBe(1);
    });

    it("detects breaking new required fields", () => {
      const newlyRequired = {
        ...baseSchema,
        properties: {
          ...baseSchema.properties,
          mandatory: { type: "string" },
        },
        required: ["id", "mandatory"],
      };

      const result = compareJsonSchemas("item.json", baseSchema, newlyRequired);
      expect(result.breaking).toBe(true);

      const gate = evaluateSchemaCompatibilityGate([result]);
      expect(gate.passed).toBe(false);
    });

    it("detects type mutations as breaking", () => {
      const typeChanged = {
        ...baseSchema,
        properties: {
          id: { type: "number" }, // was string
          name: { type: "string" },
        },
      };

      const result = compareJsonSchemas("item.json", baseSchema, typeChanged);
      expect(result.breaking).toBe(true);
      expect(result.changes.some((c) => c.kind === "type_changed")).toBe(true);
    });

    it("allows breaking changes when valid explicit override evidence is provided", () => {
      const breakingSchema = {
        ...baseSchema,
        properties: {
          id: { type: "number" },
        },
      };

      const result = compareJsonSchemas(
        "item.json",
        baseSchema,
        breakingSchema,
        "Reviewed and approved by architecture team in DECISION-042",
      );
      expect(result.breaking).toBe(true);

      const gateWithOverride = evaluateSchemaCompatibilityGate(
        [result],
        "Reviewed and approved by architecture team in DECISION-042",
      );
      expect(gateWithOverride.passed).toBe(true);
      expect(gateWithOverride.overrideEvidenceProvided).toBe(true);

      // Short / invalid override fails
      const gateWithBadOverride = evaluateSchemaCompatibilityGate([result], "no");
      expect(gateWithBadOverride.passed).toBe(false);
    });
  });
});
