import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../migrations/0003_projects_targets.up.sql",
  import.meta.url,
);

describe("project and target migration", () => {
  it("defines projects, targets, verification, assets, corridors, and reference metadata", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    for (const table of [
      "projects",
      "targets",
      "target_verifications",
      "assets",
      "corridors",
      "target_secret_references",
    ]) {
      expect(sql).toContain(`CREATE TABLE rampspec.${table}`);
    }
  });

  it("binds network names to passphrases and supports explicit custom networks", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("Test SDF Network ; September 2015");
    expect(sql).toContain("Public Global Stellar Network ; September 2015");
    expect(sql).toContain("Test SDF Future Network ; October 2022");
    expect(sql).toContain(
      "stellar_network = 'custom' AND length(custom_network_id) >= 3",
    );
  });

  it("rejects non-canonical origin aliases at the storage boundary", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("normalized_origin !~ ':443$'");
    expect(sql).toContain("normalized_origin !~ '\\.$'");
    expect(sql).toContain("normalized_origin !~ '[@?#]'");
  });

  it("enforces tenant-owned composite references and forced row policies", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql.match(/FORCE ROW LEVEL SECURITY/gu)).toHaveLength(6);
    expect(sql.match(/CREATE POLICY/gu)).toHaveLength(6);
    expect(sql).toContain("FOREIGN KEY (organization_id, project_id)");
    expect(sql).toContain("FOREIGN KEY (organization_id, input_asset_id)");
    expect(sql).toContain("FOREIGN KEY (organization_id, output_asset_id)");
  });

  it("stores only secret-reference metadata", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    const table = sql.slice(
      sql.indexOf("CREATE TABLE rampspec.target_secret_references"),
    );
    expect(table).toContain("locator_hash char(64) NOT NULL");
    expect(table).not.toMatch(/plaintext|secret_value|credential_value/iu);
  });
});
