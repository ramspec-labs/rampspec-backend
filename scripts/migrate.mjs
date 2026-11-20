import { resolve } from "node:path";

import {
  formatMigrationDryRun,
  loadMigrations,
} from "../dist/packages/platform/src/database/migrations.js";
import { PostgresMigrationRunner } from "../dist/packages/platform/src/database/postgres.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isJson = args.includes("--json");

const migrations = await loadMigrations(resolve("migrations"));
const runner = new PostgresMigrationRunner(connectionString);
try {
  if (isDryRun) {
    const result = await runner.dryRun(migrations);
    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatMigrationDryRun(result));
    }
  } else {
    const applied = await runner.migrate(migrations);
    console.log(`Applied ${applied} migration(s).`);
  }
} finally {
  await runner.close();
}
