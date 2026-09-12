import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadMigrations,
  loadSeeds,
  planMigrations,
  planRollback,
  type AppliedMigration,
  type Migration,
} from "./migrations.js";
import { assertTestDatabaseUrl } from "./postgres.js";

const migration: Migration = {
  checksum: "a".repeat(64),
  downSql: "DROP TABLE example;",
  name: "example",
  transaction: "required",
  upSql: "CREATE TABLE example (id integer);",
  version: 1,
};

describe("migration planning", () => {
  it("plans an empty database forward and is restart-safe", () => {
    expect(planMigrations([migration], [])).toEqual([migration]);
    const applied: AppliedMigration[] = [
      {
        checksum: migration.checksum,
        name: migration.name,
        version: migration.version,
      },
    ];
    expect(planMigrations([migration], applied)).toEqual([]);
  });

  it("fails closed on checksum, name, or release drift", () => {
    expect(() =>
      planMigrations([migration], [{ ...migration, checksum: "b".repeat(64) }]),
    ).toThrow("Checksum drift");
    expect(() => planMigrations([], [migration])).toThrow(
      "absent from this release",
    );
  });

  it("enforces forward-only production and explicit rollback files", () => {
    expect(() =>
      planRollback([migration], [migration], 0, "production"),
    ).toThrow("forward-only");
    expect(planRollback([migration], [migration], 0, "test")).toEqual([
      migration,
    ]);
    const irreversible: Migration = {
      checksum: migration.checksum,
      name: migration.name,
      transaction: migration.transaction,
      upSql: migration.upSql,
      version: migration.version,
    };
    expect(() =>
      planRollback([irreversible], [migration], 0, "development"),
    ).toThrow("no explicit rollback");
  });
});

describe("migration discovery", () => {
  it("loads ordered migrations, down files, checksums, and transaction directives", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rampspec-migrations-"));
    try {
      await writeFile(
        join(directory, "0002_second.up.sql"),
        "-- rampspec:transaction forbidden\nSELECT 2;\n",
      );
      await writeFile(
        join(directory, "0001_first.up.sql"),
        "-- rampspec:transaction required\nSELECT 1;\n",
      );
      await writeFile(join(directory, "0001_first.down.sql"), "SELECT 0;\n");

      const migrations = await loadMigrations(directory);
      expect(migrations.map(({ version }) => version)).toEqual([1, 2]);
      expect(migrations[0]).toMatchObject({
        downSql: "SELECT 0;\n",
        transaction: "required",
      });
      expect(migrations[0]?.checksum).toMatch(/^[a-f\d]{64}$/u);
      expect(migrations[1]).toMatchObject({ transaction: "forbidden" });
      expect("downSql" in (migrations[1] ?? {})).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects missing directives and duplicate versions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rampspec-migrations-"));
    try {
      await writeFile(join(directory, "0001_first.up.sql"), "SELECT 1;\n");
      await expect(loadMigrations(directory)).rejects.toThrow(
        "transaction mode",
      );
      await writeFile(
        join(directory, "0001_first.up.sql"),
        "-- rampspec:transaction required\nSELECT 1;\n",
      );
      await writeFile(
        join(directory, "0001_second.up.sql"),
        "-- rampspec:transaction required\nSELECT 2;\n",
      );
      await expect(loadMigrations(directory)).rejects.toThrow(
        "Duplicate migration version",
      );
      await rm(join(directory, "0001_second.up.sql"));
      await writeFile(
        join(directory, "0001_first.up.sql"),
        "SELECT 1;\n-- rampspec:transaction required\n",
      );
      await expect(loadMigrations(directory)).rejects.toThrow(
        "transaction mode",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("loads explicitly separated synthetic seeds", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rampspec-seeds-"));
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "0001_synthetic.sql"),
        "-- rampspec:transaction required\nSELECT 'synthetic';\n",
      );
      await expect(loadSeeds(directory)).resolves.toMatchObject([
        { name: "synthetic", version: 1 },
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe("test database guard", () => {
  it("permits only loopback databases named as tests", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://postgres@localhost:5432/rampspec_test",
      ),
    ).not.toThrow();
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://postgres@database.internal/rampspec_test",
      ),
    ).toThrow("loopback");
    expect(() =>
      assertTestDatabaseUrl("postgresql://postgres@localhost:5432/rampspec"),
    ).toThrow("ending in _test");
    expect(() =>
      assertTestDatabaseUrl("https://localhost/rampspec_test"),
    ).toThrow("loopback database");
  });
});
