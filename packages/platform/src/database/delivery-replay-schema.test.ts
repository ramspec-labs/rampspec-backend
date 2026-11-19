import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { loadMigrations } from "./migrations.js";

const directory = new URL("../../../../migrations/", import.meta.url);
const upUrl = new URL("0009_delivery_replay_lineage.up.sql", directory);
const downUrl = new URL("0009_delivery_replay_lineage.down.sql", directory);

describe("delivery replay migration", () => {
  it("adds replay lineage and dead-letter metadata to deliveries", async () => {
    const upSql = await readFile(upUrl, "utf8");
    expect(upSql).toContain("-- rampspec:transaction required");
    expect(upSql).toContain("replayed_from_id");
    expect(upSql).toContain("REFERENCES rampspec.deliveries(id)");
    expect(upSql).toContain("attempt_lineage_id");
    expect(upSql).toContain("dead_letter_at");
    expect(upSql).toContain("deliveries_dead_letter_at_check");
    expect(upSql).toContain("deliveries_replayed_from_idx");
    expect(upSql).toContain("deliveries_dead_letter_idx");
    const downSql = await readFile(downUrl, "utf8");
    expect(downSql).toContain("DROP COLUMN IF EXISTS replayed_from_id");
    expect(downSql).toContain("DROP COLUMN IF EXISTS attempt_lineage_id");
    expect(downSql).toContain("DROP COLUMN IF EXISTS dead_letter_at");
  });

  it("loads as version 9 with no duplicate migration versions", async () => {
    const migrations = await loadMigrations(directory.pathname);
    const versions = migrations.map(({ version }) => version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    expect(migrations).toContainEqual(
      expect.objectContaining({
        name: "delivery_replay_lineage",
        transaction: "required",
        version: 9,
      }),
    );
    const ninth = migrations.find(({ version }) => version === 9);
    expect(ninth?.checksum).toMatch(/^[a-f\d]{64}$/u);
    expect(ninth?.downSql).toContain("dead_letter_at");
  });
});
