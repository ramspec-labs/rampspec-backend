import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../migrations/0004_specs_suites.up.sql",
  import.meta.url,
);

describe("specification and suite migration", () => {
  it("defines snapshots, packs, rules, scenarios, suites, and exact locks", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    for (const table of [
      "spec_snapshots",
      "rule_packs",
      "rule_pack_versions",
      "rules",
      "scenarios",
      "suites",
      "suite_versions",
      "suite_version_scenarios",
    ]) {
      expect(sql).toContain(`CREATE TABLE rampspec.${table}`);
    }
  });

  it("uses source, definition, manifest, and lock hashes as immutable identities", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    for (const hash of [
      "content_hash",
      "manifest_hash",
      "implementation_hash",
      "definition_hash",
      "lock_hash",
    ]) {
      expect(sql).toContain(hash);
    }
    expect(sql).toContain("spec_snapshots_immutable");
    expect(
      sql.match(/protect_published_version/gu)?.length,
    ).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("rules in published packs are immutable");
    expect(sql).toContain("published suite membership is immutable");
    expect(sql.match(/BEFORE INSERT OR UPDATE OR DELETE/gu)).toHaveLength(2);
  });

  it("applies forced tenant policies to every owned table", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain(
      "organization_id = rampspec.current_organization_id()",
    );
  });
});
