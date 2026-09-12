import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../migrations/0007_authorization_metadata.up.sql",
  import.meta.url,
);

describe("authorization metadata migration", () => {
  it("stores role, scope, source, expiry, approval, and revocation metadata", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    for (const column of [
      "subject_type",
      "subject_id",
      "role",
      "scopes",
      "source",
      "expires_at",
      "approved_by_user_id",
      "revoked_at",
    ]) {
      expect(sql).toContain(column);
    }
  });

  it("requires MFA-capable emergency approvals to be time-bounded and justified", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("source = 'emergency'");
    expect(sql).toContain("expires_at IS NOT NULL");
    expect(sql).toContain("approved_by_user_id IS NOT NULL");
    expect(sql).toContain("reason IS NOT NULL");
  });

  it("forces organization row isolation", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain(
      "organization_id = rampspec.current_organization_id()",
    );
  });
});
