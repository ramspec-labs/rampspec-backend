import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export type TransactionMode = "forbidden" | "required";

export interface Migration {
  readonly checksum: string;
  readonly downSql?: string;
  readonly name: string;
  readonly transaction: TransactionMode;
  readonly upSql: string;
  readonly version: number;
}

export interface AppliedMigration {
  readonly checksum: string;
  readonly name: string;
  readonly version: number;
}

const migrationPattern = /^(\d{4,})_([a-z0-9_]+)\.up\.sql$/u;
const transactionPattern = /^-- rampspec:transaction (required|forbidden)$/u;

function checksum(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

function transactionMode(contents: string, fileName: string): TransactionMode {
  const match = transactionPattern.exec(contents.split(/\r?\n/u, 1)[0] ?? "");
  if (!match?.[1]) {
    throw new Error(`${fileName} must declare its transaction mode.`);
  }
  return match[1] as TransactionMode;
}

async function optionalFile(path: string): Promise<string | undefined> {
  try {
    await access(path);
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadMigrations(
  directory: string,
): Promise<readonly Migration[]> {
  const entries = (await readdir(directory))
    .filter((name) => name.endsWith(".up.sql"))
    .sort();
  const migrations = await Promise.all(
    entries.map(async (fileName) => {
      const match = migrationPattern.exec(fileName);
      if (!match?.[1] || !match[2]) {
        throw new Error(`Invalid migration filename ${fileName}.`);
      }
      const version = Number(match[1]);
      const upSql = await readFile(resolve(directory, fileName), "utf8");
      const downPath = resolve(
        directory,
        fileName.replace(".up.sql", ".down.sql"),
      );
      const downSql = await optionalFile(downPath);
      return {
        checksum: checksum(upSql),
        ...(downSql === undefined ? {} : { downSql }),
        name: match[2],
        transaction: transactionMode(upSql, fileName),
        upSql,
        version,
      } satisfies Migration;
    }),
  );

  assertUniqueVersions(migrations, "migration");
  return migrations.sort((left, right) => left.version - right.version);
}

function assertUniqueVersions(
  entries: readonly Migration[],
  kind: string,
): void {
  const versions = new Set<number>();
  for (const entry of entries) {
    if (versions.has(entry.version)) {
      throw new Error(`Duplicate ${kind} version ${entry.version}.`);
    }
    versions.add(entry.version);
  }
}

export function planMigrations(
  migrations: readonly Migration[],
  applied: readonly AppliedMigration[],
): readonly Migration[] {
  const local = new Map(
    migrations.map((migration) => [migration.version, migration]),
  );
  for (const record of applied) {
    const migration = local.get(record.version);
    if (!migration) {
      throw new Error(
        `Database migration ${record.version} is absent from this release.`,
      );
    }
    if (
      migration.name !== record.name ||
      migration.checksum !== record.checksum
    ) {
      throw new Error(
        `Checksum drift detected for migration ${record.version}.`,
      );
    }
  }
  const appliedVersions = new Set(applied.map(({ version }) => version));
  return migrations.filter(({ version }) => !appliedVersions.has(version));
}

export function planRollback(
  migrations: readonly Migration[],
  applied: readonly AppliedMigration[],
  targetVersion: number,
  environment: "development" | "production" | "staging" | "test",
): readonly Migration[] {
  if (environment === "production") {
    throw new Error("Production migrations are forward-only.");
  }
  const local = new Map(
    migrations.map((migration) => [migration.version, migration]),
  );
  return applied
    .filter(({ version }) => version > targetVersion)
    .sort((left, right) => right.version - left.version)
    .map(({ version }) => {
      const migration = local.get(version);
      if (!migration?.downSql) {
        throw new Error(`Migration ${version} has no explicit rollback.`);
      }
      return migration;
    });
}

export async function loadSeeds(
  directory: string,
): Promise<readonly Migration[]> {
  return loadMigrationsFromSeedNames(directory);
}

async function loadMigrationsFromSeedNames(
  directory: string,
): Promise<readonly Migration[]> {
  const entries = (await readdir(directory)).filter((name) =>
    /^\d{4,}_[a-z0-9_]+\.sql$/u.test(name),
  );
  const seeds = await Promise.all(
    entries.sort().map(async (fileName) => {
      const match = /^(\d{4,})_([a-z0-9_]+)\.sql$/u.exec(fileName);
      if (!match?.[1] || !match[2])
        throw new Error(`Invalid seed filename ${fileName}.`);
      const upSql = await readFile(resolve(directory, fileName), "utf8");
      return {
        checksum: checksum(upSql),
        name: match[2],
        transaction: transactionMode(upSql, fileName),
        upSql,
        version: Number(match[1]),
      } satisfies Migration;
    }),
  );
  assertUniqueVersions(seeds, "seed");
  return seeds.sort((left, right) => left.version - right.version);
}
