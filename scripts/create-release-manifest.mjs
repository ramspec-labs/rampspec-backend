import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createReleaseManifest } from "../dist/packages/platform/src/release-manifest.js";

const output = resolve(process.argv[2] ?? "release/release-manifest.json");
const manifest = await createReleaseManifest({
  containerDigest: process.env.CONTAINER_DIGEST,
  containerImage: process.env.CONTAINER_IMAGE,
  sourceCommit: process.env.SOURCE_COMMIT,
});

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${output}.`);
