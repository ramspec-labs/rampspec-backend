import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../migrations/0005_runs_evidence.up.sql",
  import.meta.url,
);

describe("run and evidence migration", () => {
  it("defines the complete execution, evidence, reporting, and delivery graph", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    for (const table of [
      "runs",
      "run_events",
      "run_attempts",
      "run_steps",
      "artifacts",
      "findings",
      "finding_triage_events",
      "protocol_exchanges",
      "ledger_observations",
      "reports",
      "report_signatures",
      "commitments",
      "schedules",
      "integrations",
      "deliveries",
      "audit_events",
    ]) {
      expect(sql).toContain(`CREATE TABLE rampspec.${table}`);
    }
  });

  it("protects append-only records, finalized evidence, and effective run configuration", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("reject_append_only_mutation");
    expect(sql).toContain("protect_finalized_record");
    expect(sql).toContain("protect_run_configuration");
    expect(sql).toContain("effective_config_hash");
  });

  it("applies forced tenant policies across the persistence graph", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain(
      "organization_id = rampspec.current_organization_id()",
    );
    expect(sql).toContain("FOREIGN KEY (organization_id, run_id)");
    expect(sql).toContain("FOREIGN KEY (organization_id, run_id, attempt_id)");
    expect(sql).toContain("FOREIGN KEY (organization_id, run_id, step_id)");
  });
});
