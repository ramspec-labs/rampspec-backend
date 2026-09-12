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
    await pool.query("DROP ROLE IF EXISTS rampspec_test_app");
  });

  afterAll(async () => {
    await pool.query("DROP SCHEMA IF EXISTS rampspec CASCADE");
    await pool.query("DROP ROLE IF EXISTS rampspec_test_app");
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
    expect(tables.rows.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "api_keys",
        "memberships",
        "organizations",
        "schema_migrations",
        "seed_history",
        "service_accounts",
        "system_metadata",
        "users",
      ]),
    );
  });

  it("enforces identity uniqueness, referential ownership, and tenant isolation", async () => {
    const userId = "user_00000000-0000-4000-8000-000000000010";
    const secondUserId = "user_00000000-0000-4000-8000-000000000011";
    const organizationId = "organization_00000000-0000-4000-8000-000000000012";
    const otherOrganizationId =
      "organization_00000000-0000-4000-8000-000000000013";
    const serviceAccountId =
      "service_account_00000000-0000-4000-8000-000000000014";

    await pool.query(
      `INSERT INTO rampspec.users (id, oidc_subject, email)
       VALUES ($1, 'oidc|owner', 'owner@example.test'),
              ($2, 'oidc|member', 'member@example.test')`,
      [userId, secondUserId],
    );
    await expect(
      pool.query(
        `INSERT INTO rampspec.users (id, oidc_subject)
         VALUES ('user_00000000-0000-4000-8000-000000000098', 'oidc|owner')`,
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await pool.query(
      "SELECT set_config('rampspec.organization_id', $1, false)",
      [organizationId],
    );
    await pool.query(
      `INSERT INTO rampspec.organizations (id, slug, name, owner_user_id)
       VALUES ($1, 'primary-org', 'Primary Organization', $2)`,
      [organizationId, userId],
    );
    await pool.query(
      `INSERT INTO rampspec.memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [organizationId, userId],
    );
    await pool.query(
      `INSERT INTO rampspec.service_accounts
         (id, organization_id, name, created_by_user_id)
       VALUES ($1, $2, 'ci-runner', $3)`,
      [serviceAccountId, organizationId, userId],
    );

    await expect(
      pool.query(
        `INSERT INTO rampspec.memberships (organization_id, user_id, role)
         VALUES ($1, 'user_00000000-0000-4000-8000-000000000099', 'viewer')`,
        [organizationId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      pool.query(
        `INSERT INTO rampspec.memberships (organization_id, user_id, role)
         VALUES ($1, $2, 'viewer')`,
        [organizationId, userId],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    await pool.query(
      "SELECT set_config('rampspec.organization_id', $1, false)",
      [otherOrganizationId],
    );
    await pool.query(
      `INSERT INTO rampspec.organizations (id, slug, name, owner_user_id)
       VALUES ($1, 'other-org', 'Other Organization', $2)`,
      [otherOrganizationId, secondUserId],
    );
    await pool.query(
      "CREATE ROLE rampspec_test_app NOLOGIN NOSUPERUSER NOBYPASSRLS",
    );
    await pool.query("GRANT USAGE ON SCHEMA rampspec TO rampspec_test_app");
    await pool.query(
      "GRANT SELECT, INSERT ON rampspec.organizations TO rampspec_test_app",
    );
    const tenantClient = await pool.connect();
    try {
      await tenantClient.query("SET ROLE rampspec_test_app");
      await tenantClient.query(
        "SELECT set_config('rampspec.organization_id', $1, false)",
        [otherOrganizationId],
      );
      const visible = await tenantClient.query<{ readonly id: string }>(
        "SELECT id FROM rampspec.organizations ORDER BY id",
      );
      expect(visible.rows).toEqual([{ id: otherOrganizationId }]);
      await expect(
        tenantClient.query(
          `INSERT INTO rampspec.organizations (id, slug, name, owner_user_id)
           VALUES ('organization_00000000-0000-4000-8000-000000000097',
                   'blocked-org', 'Blocked Organization', $1)`,
          [secondUserId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await tenantClient.query("RESET ROLE");
      tenantClient.release();
    }
    await expect(
      pool.query(
        `INSERT INTO rampspec.api_keys
           (id, organization_id, service_account_id, key_prefix, key_hash, scopes)
         VALUES ('api_key_00000000-0000-4000-8000-000000000015', $1, $2,
                 'rsk_abcdefghijkl', decode(repeat('ab', 32), 'hex'), ARRAY['runs:write'])`,
        [otherOrganizationId, serviceAccountId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("enforces project, target, network, asset, and cross-tenant constraints", async () => {
    const organizationId = "organization_00000000-0000-4000-8000-000000000012";
    const otherOrganizationId =
      "organization_00000000-0000-4000-8000-000000000013";
    const projectId = "project_00000000-0000-4000-8000-000000000020";
    const targetId = "target_00000000-0000-4000-8000-000000000021";
    await pool.query(
      `INSERT INTO rampspec.projects (id, organization_id, slug, name)
       VALUES ($1, $2, 'anchor-api', 'Anchor API')`,
      [projectId, organizationId],
    );
    await pool.query(
      `INSERT INTO rampspec.targets
         (id, organization_id, project_id, name, normalized_origin,
          stellar_network, network_passphrase)
       VALUES ($1, $2, $3, 'Test Anchor', 'https://anchor.example.test',
               'testnet', 'Test SDF Network ; September 2015')`,
      [targetId, organizationId, projectId],
    );

    await expect(
      pool.query(
        `INSERT INTO rampspec.targets
           (id, organization_id, project_id, name, normalized_origin,
            stellar_network, network_passphrase)
         VALUES ('target_00000000-0000-4000-8000-000000000022', $1, $2,
                 'Duplicate', 'https://anchor.example.test',
                 'testnet', 'Test SDF Network ; September 2015')`,
        [organizationId, projectId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      pool.query(
        `INSERT INTO rampspec.targets
           (id, organization_id, project_id, name, normalized_origin,
            stellar_network, network_passphrase)
         VALUES ('target_00000000-0000-4000-8000-000000000023', $1, $2,
                 'Wrong Network', 'https://wrong-network.example.test',
                 'pubnet', 'Test SDF Network ; September 2015')`,
        [organizationId, projectId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        `INSERT INTO rampspec.targets
           (id, organization_id, project_id, name, normalized_origin,
            stellar_network, network_passphrase)
         VALUES ('target_00000000-0000-4000-8000-000000000024', $1, $2,
                 'Cross Tenant', 'https://cross-tenant.example.test',
                 'testnet', 'Test SDF Network ; September 2015')`,
        [otherOrganizationId, projectId],
      ),
    ).rejects.toMatchObject({ code: "23503" });

    await pool.query(
      `INSERT INTO rampspec.assets
         (id, organization_id, target_id, canonical_asset_id, asset_type)
       VALUES ('asset_00000000-0000-4000-8000-000000000025', $1, $2,
               'native', 'native')`,
      [organizationId, targetId],
    );
    await expect(
      pool.query(
        `INSERT INTO rampspec.assets
           (id, organization_id, target_id, canonical_asset_id, asset_type, code)
         VALUES ('asset_00000000-0000-4000-8000-000000000026', $1, $2,
                 'invalid-native', 'native', 'XLM')`,
        [organizationId, targetId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
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
