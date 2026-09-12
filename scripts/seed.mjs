import { resolve } from "node:path";

import { loadSeeds } from "../dist/packages/platform/src/database/migrations.js";
import { PostgresMigrationRunner } from "../dist/packages/platform/src/database/postgres.js";

const connectionString = process.env.DATABASE_URL;
const environment = process.env.APP_ENV;
if (!connectionString) throw new Error("DATABASE_URL is required.");
if (environment !== "development" && environment !== "test") {
  throw new Error("APP_ENV must be development or test to apply seeds.");
}

const seeds = await loadSeeds(resolve("seeds", "development"));
const runner = new PostgresMigrationRunner(connectionString);
try {
  const applied = await runner.seed(seeds, environment);
  console.log(`Applied ${applied} seed(s).`);
} finally {
  await runner.close();
}
