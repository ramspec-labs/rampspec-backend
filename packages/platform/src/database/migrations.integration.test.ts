import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadMigrations, loadSeeds } from "./migrations.js";
import { assertTestDatabaseUrl, PostgresMigrationRunner } from "./postgres.js";

const connectionString = process.env.TEST_DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;

describeDatabase("PostgreSQL migration integration", () => {
  if (!connectionString) return;
  assertTestDatabaseUrl(connectionString);

  const pool = new Pool({ connectionString });
  const runner = new PostgresMigrationRunner(connectionString);

  beforeAll(async () => {
    await pool.query("DROP SCHEMA IF EXISTS rampspec CASCADE");
  });

  afterAll(async () => {
    await pool.query("DROP SCHEMA IF EXISTS rampspec CASCADE");
    await runner.close();
    await pool.end();
  });

  it("upgrades an empty database and is restart-safe", async () => {
    const migrations = await loadMigrations(resolve("migrations"));
    await expect(runner.migrate(migrations)).resolves.toBe(migrations.length);
    await expect(runner.migrate(migrations)).resolves.toBe(0);

    const tables = await pool.query<{ readonly name: string }>(
      `SELECT table_name AS name
       FROM information_schema.tables
       WHERE table_schema = 'rampspec'
       ORDER BY table_name`,
    );
    expect(tables.rows.map(({ name }) => name)).toEqual([
      "schema_migrations",
      "seed_history",
      "system_metadata",
    ]);
  });

  it("applies development seeds idempotently and rejects production seeding", async () => {
    const seeds = await loadSeeds(resolve("seeds", "development"));
    await expect(runner.seed(seeds, "development")).resolves.toBe(seeds.length);
    await expect(runner.seed(seeds, "test")).resolves.toBe(0);
    await expect(runner.seed(seeds, "production")).rejects.toThrow(
      "prohibited",
    );

    const metadata = await pool.query<{ readonly synthetic: boolean }>(
      `SELECT (value->>'synthetic')::boolean AS synthetic
       FROM rampspec.system_metadata
       WHERE key = 'environment'`,
    );
    expect(metadata.rows).toEqual([{ synthetic: true }]);
  });
});
