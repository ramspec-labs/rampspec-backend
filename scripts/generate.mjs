import { mkdir, writeFile } from "node:fs/promises";

import { format } from "prettier";

import { openApiDocument } from "../dist/packages/protocol/src/openapi.js";
import { schemaRegistry } from "../dist/packages/protocol/src/schemas.js";
import { generateSchemaTypes } from "./schema-types.mjs";

const directory = new URL("../generated/openapi/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL("openapi.json", directory),
  `${JSON.stringify(openApiDocument, null, 2)}\n`,
  "utf8",
);
console.log("Generated OpenAPI document.");

const schemaDirectory = new URL("../generated/schemas/v1/", import.meta.url);
await mkdir(schemaDirectory, { recursive: true });
for (const entry of schemaRegistry) {
  await writeFile(
    new URL(entry.fileName, schemaDirectory),
    `${JSON.stringify(entry.schema, null, 2)}\n`,
    "utf8",
  );
}
await writeFile(
  new URL("../generated/schemas/index.d.ts", import.meta.url),
  await format(generateSchemaTypes(schemaRegistry), { parser: "typescript" }),
  "utf8",
);
console.log(
  `Generated ${schemaRegistry.length} JSON Schemas and TypeScript declarations.`,
);
