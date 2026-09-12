import { resolve } from "node:path";

import { loadMigrations } from "../dist/packages/platform/src/database/migrations.js";
import { PostgresMigrationRunner } from "../dist/packages/platform/src/database/postgres.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

const migrations = await loadMigrations(resolve("migrations"));
const runner = new PostgresMigrationRunner(connectionString);
try {
  const applied = await runner.migrate(migrations);
  console.log(`Applied ${applied} migration(s).`);
} finally {
  await runner.close();
}
