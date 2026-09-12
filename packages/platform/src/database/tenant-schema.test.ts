import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../migrations/0002_tenant_identity.up.sql",
  import.meta.url,
);

describe("tenant identity migration", () => {
  it("defines the required identity and tenant tables", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    for (const table of [
      "users",
      "organizations",
      "memberships",
      "service_accounts",
      "api_keys",
    ]) {
      expect(sql).toContain(`CREATE TABLE rampspec.${table}`);
    }
  });

  it("stores API key hashes and metadata without a plaintext credential column", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("key_hash bytea NOT NULL");
    expect(sql).toContain("key_prefix text NOT NULL UNIQUE");
    expect(sql).not.toMatch(/plaintext|raw_key|secret_value/iu);
  });

  it("forces tenant policies and composite service-account ownership", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql.match(/FORCE ROW LEVEL SECURITY/gu)).toHaveLength(4);
    expect(sql.match(/CREATE POLICY/gu)).toHaveLength(4);
    expect(sql).toContain("FOREIGN KEY (organization_id, service_account_id)");
    expect(sql).toContain(
      "REFERENCES rampspec.service_accounts(organization_id, id)",
    );
  });
});
