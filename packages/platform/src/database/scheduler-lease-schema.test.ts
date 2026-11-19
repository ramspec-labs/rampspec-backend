import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../migrations/0011_scheduler_leases.up.sql",
  import.meta.url,
);

describe("scheduler lease migration", () => {
  it("defines the exclusive ownership lease table", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("CREATE TABLE rampspec.scheduler_leases");
    for (const column of [
      "schedule_id text PRIMARY KEY",
      "organization_id text NOT NULL",
      "owner_id text NOT NULL",
      "token text NOT NULL",
      "version integer NOT NULL DEFAULT 1",
      "acquired_at timestamptz NOT NULL DEFAULT now()",
      "expires_at timestamptz NOT NULL",
      "renewed_at timestamptz",
      "renewal_count integer NOT NULL DEFAULT 0",
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain(
      "REFERENCES rampspec.schedules(id) ON DELETE CASCADE",
    );
    expect(sql).toContain(
      "REFERENCES rampspec.organizations(id) ON DELETE CASCADE",
    );
  });

  it("bounds the lease and orders renewal timestamps", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("CHECK (version >= 1)");
    expect(sql).toContain("CHECK (renewal_count >= 0)");
    expect(sql).toContain("CHECK (expires_at > acquired_at)");
    expect(sql).toContain(
      "CHECK (renewed_at IS NULL OR renewed_at >= acquired_at)",
    );
    expect(sql).toContain("scheduler_leases_expires_at_idx");
  });

  it("documents the compare-and-set renewal and enforces tenant isolation", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("owner_id = $3");
    expect(sql).toContain("token = $4");
    expect(sql).toContain("version = $5");
    expect(sql).toContain("expires_at > now()");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("CREATE POLICY scheduler_leases_tenant");
    expect(sql).toContain(
      "organization_id = rampspec.current_organization_id()",
    );
  });
});
