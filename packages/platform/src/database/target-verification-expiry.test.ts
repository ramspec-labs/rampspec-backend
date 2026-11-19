import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../migrations/0009_target_verification_expiry.up.sql",
  import.meta.url,
);
const rollbackUrl = new URL(
  "../../../../migrations/0009_target_verification_expiry.down.sql",
  import.meta.url,
);

describe("target verification expiry migration", () => {
  it("declares a transactional migration", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql.split("\n", 1)[0]).toBe("-- rampspec:transaction required");
  });

  it("allows at most one pending challenge per target and method", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain(
      "CREATE UNIQUE INDEX target_verifications_one_pending_idx",
    );
    expect(sql).toContain(
      "ON rampspec.target_verifications (organization_id, target_id, method)",
    );
    expect(sql).toContain("WHERE status = 'pending'");
  });

  it("indexes pending challenges by expiry for sweeps", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain(
      "CREATE INDEX target_verifications_pending_expiry_idx",
    );
    expect(sql).toContain(
      "ON rampspec.target_verifications (organization_id, expires_at)",
    );
    expect(sql).toContain("WHERE status = 'pending'");
  });

  it("only allows verification while the challenge is still current", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain(
      "CONSTRAINT target_verifications_verified_before_expiry_check",
    );
    expect(sql).toContain(
      "CHECK (verified_at IS NULL OR verified_at < expires_at)",
    );
  });

  it("ships an explicit rollback that removes the new objects", async () => {
    const sql = await readFile(rollbackUrl, "utf8");
    expect(sql).toContain(
      "DROP CONSTRAINT target_verifications_verified_before_expiry_check",
    );
    expect(sql).toContain(
      "DROP INDEX rampspec.target_verifications_pending_expiry_idx",
    );
    expect(sql).toContain(
      "DROP INDEX rampspec.target_verifications_one_pending_idx",
    );
  });
});
