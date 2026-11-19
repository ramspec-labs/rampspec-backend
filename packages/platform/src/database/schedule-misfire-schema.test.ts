import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../migrations/0010_scheduled_run_misfire_policy.up.sql",
  import.meta.url,
);

describe("scheduled-run misfire policy migration", () => {
  it("records the policy and missed count with bounded catch-up", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("CREATE TABLE rampspec.schedule_misfires");
    expect(sql).toContain(
      "misfire_policy IN ('skip', 'run-once', 'catch-up')",
    );
    expect(sql).toContain("missed_occurrences integer NOT NULL");
    expect(sql).toContain("executions_due integer NOT NULL");
    expect(sql).toContain("executions_due <= missed_occurrences");
    expect(sql).toContain("executions_due <= 10");
    expect(sql).toContain("schedule_misfires_tenant");
  });
});
