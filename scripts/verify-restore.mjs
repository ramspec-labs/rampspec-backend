import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { verifyRestoreCommand } from "../dist/packages/platform/src/operations/backup.js";

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error("Usage: node scripts/verify-restore.mjs <backup-manifest.json>");
    process.exitCode = 1;
    return;
  }

  try {
    const raw = await readFile(resolve(manifestPath), "utf8");
    const manifest = JSON.parse(raw);
    const report = await verifyRestoreCommand(manifest, {
      isolatedTarget: "isolated_sandbox_db",
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(`Verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

await main();
