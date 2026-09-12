import { readFile } from "node:fs/promises";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { schemaRegistry } from "./schemas.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
  },
});
ajv.addFormat("uri", {
  type: "string",
  validate: (value: string) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  },
});

async function fixture(
  kind: "invalid" | "valid",
  name: string,
): Promise<unknown> {
  return JSON.parse(
    await readFile(
      new URL(`../fixtures/schemas/v1/${kind}/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

describe("versioned runtime schemas", () => {
  it("uses unique stable IDs and independent versions", () => {
    const ids = schemaRegistry.map(({ schema }) => schema.$id);
    expect(new Set(ids).size).toBe(schemaRegistry.length);
    for (const { schema } of schemaRegistry) {
      expect(schema.$schema).toBe(
        "https://json-schema.org/draft/2020-12/schema",
      );
      expect(schema.properties.schemaVersion).toMatchObject({ const: "1.0.0" });
      expect(schema).toMatchObject({ additionalProperties: false });
      expect(schema.properties).toHaveProperty("extensions");
    }
  });

  it.each(schemaRegistry)(
    "validates $fileName fixtures",
    async ({ fileName, schema }) => {
      const name = fileName.replace(".schema.json", "");
      const validate = ajv.compile(schema);
      expect(
        validate(await fixture("valid", name)),
        JSON.stringify(validate.errors),
      ).toBe(true);
      expect(validate(await fixture("invalid", name))).toBe(false);
    },
  );

  it("permits namespaced extensions while rejecting unknown top-level fields", async () => {
    const entry = schemaRegistry.find(
      ({ fileName }) => fileName === "rule.schema.json",
    );
    if (!entry) throw new Error("Rule schema missing.");
    const validate = ajv.compile(entry.schema);
    const rule = (await fixture("valid", "rule")) as Record<string, unknown>;

    expect(
      validate({
        ...rule,
        extensions: { "partner.example": { enabled: true } },
      }),
    ).toBe(true);
    expect(validate({ ...rule, futureField: true })).toBe(false);
    expect(validate({ ...rule, extensions: { unnamespaced: true } })).toBe(
      false,
    );
  });

  it("matches committed JSON releases and generated declarations", async () => {
    for (const { fileName, schema } of schemaRegistry) {
      const generated = JSON.parse(
        await readFile(
          new URL(`../../../generated/schemas/v1/${fileName}`, import.meta.url),
          "utf8",
        ),
      ) as unknown;
      expect(generated).toEqual(schema);
    }
    const declarations = await readFile(
      new URL("../../../generated/schemas/index.d.ts", import.meta.url),
      "utf8",
    );
    for (const { typeName } of schemaRegistry) {
      expect(declarations).toContain(`export interface ${typeName}`);
    }
  });
});
