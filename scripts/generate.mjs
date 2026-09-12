import { mkdir, writeFile } from "node:fs/promises";

import { openApiDocument } from "../dist/packages/protocol/src/openapi.js";

const directory = new URL("../generated/openapi/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL("openapi.json", directory),
  `${JSON.stringify(openApiDocument, null, 2)}\n`,
  "utf8",
);
console.log("Generated OpenAPI document.");
