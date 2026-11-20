import { performance } from "node:perf_hooks";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

import type { AppliedMigration, Migration } from "./migrations.js";
import { planMigrations, planRollback } from "./migrations.js";

/** PostgreSQL serialization failure code: 40001 (serialization_failure) and 40P01 (deadlock_detected) */
export const RETRYABLE_SQL_STATES = new Set(["40001", "40P01"]);

export interface SerializationRetryOptions {
  /** Maximum number of retry attempts. Default: 3 */
  readonly maxRetries?: number;
  /** Base backoff delay in ms. Default: 50 */
  readonly baseDelayMs?: number;
  /** Maximum backoff delay in ms. Default: 1000 */
  readonly maxDelayMs?: number;
  /** Jitter ratio (0 to 1). Default: 0.2 */
  readonly jitterRatio?: number;
  /** Optional tracer callback without logging raw query values or secrets */
  readonly onRetry?: (attempt: number, sqlState: string, delayMs: number) => void;
  /** Optional sleep implementation for deterministic unit testing */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Optional random float generator (0 <= r < 1) for deterministic unit testing */
  readonly random?: () => number;
}

export function isRetryableSerializationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { readonly code?: unknown; readonly routine?: unknown };
  if (typeof candidate.code === "string" && RETRYABLE_SQL_STATES.has(candidate.code)) {
    return true;
  }
  return false;
}

export function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterRatio: number,
  random: () => number,
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  const jitterRange = exponential * jitterRatio;
  const jitter = (random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(exponential + jitter));
}

export async function executeWithSerializationRetry<Result>(
  operation: (attempt: number) => Promise<Result>,
  options: SerializationRetryOptions = {},
): Promise<Result> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 50;
  const maxDelayMs = options.maxDelayMs ?? 1000;
  const jitterRatio = Math.min(1, Math.max(0, options.jitterRatio ?? 0.2));
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? (() => Math.random());

  let attempt = 0;
  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt < maxRetries && isRetryableSerializationError(error)) {
        const sqlState = (error as { readonly code: string }).code;
        const delayMs = calculateBackoff(attempt, baseDelayMs, maxDelayMs, jitterRatio, random);
        options.onRetry?.(attempt + 1, sqlState, delayMs);
        await sleep(delayMs);
        attempt++;
        continue;
      }
      throw error;
    }
  }
}

export class Connection {
  constructor(private readonly client: PoolClient) {}

  async query<Row extends QueryResultRow>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<Row[]> {
    const result = await this.client.query<Row>(sql, [...values]);
    return result.rows;
  }

  async script(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async transaction<Result>(
    work: (connection: Connection) => Promise<Result>,
    options?: SerializationRetryOptions,
  ): Promise<Result> {
    return executeWithSerializationRetry(async () => {
      await this.client.query("BEGIN");
      try {
        const result = await work(this);
        await this.client.query("COMMIT");
        return result;
      } catch (error) {
        await this.client.query("ROLLBACK");
        throw error;
      }
    }, options);
  }
}

interface AppliedRow extends QueryResultRow {
  readonly checksum: string;
  readonly name: string;
  readonly version: string;
}

export class PostgresMigrationRunner {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 4 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async locked<Result>(
    work: (connection: Connection) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.pool.connect();
    const connection = new Connection(client);
    let acquired = false;
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
        "rampspec-schema-migrations",
      ]);
      acquired = true;
      return await work(connection);
    } finally {
      try {
        if (acquired) {
          await client.query(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
            ["rampspec-schema-migrations"],
          );
        }
      } finally {
        client.release();
      }
    }
  }

  private async initialize(connection: Connection): Promise<void> {
    await connection.script(`
      CREATE SCHEMA IF NOT EXISTS rampspec;
      CREATE TABLE IF NOT EXISTS rampspec.schema_migrations (
        version bigint PRIMARY KEY,
        name text NOT NULL,
        checksum char(64) NOT NULL,
        duration_ms integer NOT NULL CHECK (duration_ms >= 0),
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS rampspec.seed_history (
        version bigint PRIMARY KEY,
        name text NOT NULL,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  private async applied(
    connection: Connection,
    table: "schema_migrations" | "seed_history" = "schema_migrations",
  ) {
    const rows = await connection.query<AppliedRow>(
      `SELECT version::text, name, checksum FROM rampspec.${table} ORDER BY version`,
    );
    return rows.map(
      ({ checksum: value, name, version }) =>
        ({
          checksum: value.trim(),
          name,
          version: Number(version),
        }) satisfies AppliedMigration,
    );
  }

  private async applyOne(
    connection: Connection,
    migration: Migration,
    table: "schema_migrations" | "seed_history",
  ): Promise<void> {
    const apply = async (active: Connection) => {
      const started = performance.now();
      await active.script(migration.upSql);
      const duration = Math.max(0, Math.round(performance.now() - started));
      if (table === "schema_migrations") {
        await active.query(
          `INSERT INTO rampspec.schema_migrations
             (version, name, checksum, duration_ms)
           VALUES ($1, $2, $3, $4)`,
          [migration.version, migration.name, migration.checksum, duration],
        );
      } else {
        await active.query(
          `INSERT INTO rampspec.seed_history (version, name, checksum) VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
      }
    };
    if (migration.transaction === "required")
      await connection.transaction(apply);
    else await apply(connection);
  }

  async migrate(migrations: readonly Migration[]): Promise<number> {
    return this.locked(async (connection) => {
      await this.initialize(connection);
      const pending = planMigrations(
        migrations,
        await this.applied(connection),
      );
      for (const migration of pending)
        await this.applyOne(connection, migration, "schema_migrations");
      return pending.length;
    });
  }

  async seed(
    seeds: readonly Migration[],
    environment: "development" | "production" | "staging" | "test",
  ): Promise<number> {
    if (environment === "production" || environment === "staging") {
      throw new Error(
        "Development seeds are prohibited outside development and test.",
      );
    }
    return this.locked(async (connection) => {
      await this.initialize(connection);
      const pending = planMigrations(
        seeds,
        await this.applied(connection, "seed_history"),
      );
      for (const seed of pending)
        await this.applyOne(connection, seed, "seed_history");
      return pending.length;
    });
  }

  async rollback(
    migrations: readonly Migration[],
    targetVersion: number,
    environment: "development" | "production" | "staging" | "test",
  ): Promise<number> {
    return this.locked(async (connection) => {
      await this.initialize(connection);
      const rollback = planRollback(
        migrations,
        await this.applied(connection),
        targetVersion,
        environment,
      );
      for (const migration of rollback) {
        await connection.transaction(async (active) => {
          await active.script(migration.downSql ?? "");
          await active.query(
            "DELETE FROM rampspec.schema_migrations WHERE version = $1",
            [migration.version],
          );
        });
      }
      return rollback.length;
    });
  }
}

export function assertTestDatabaseUrl(connectionString: string): void {
  const url = new URL(connectionString);
  const loopback = ["127.0.0.1", "[::1]", "::1", "localhost"].includes(
    url.hostname,
  );
  const postgres =
    url.protocol === "postgres:" || url.protocol === "postgresql:";
  if (!postgres || !loopback || !url.pathname.endsWith("_test")) {
    throw new Error(
      "Integration tests require a loopback database ending in _test.",
    );
  }
}
