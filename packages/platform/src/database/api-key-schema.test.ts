import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../migrations/0008_api_key_prefix_compatibility.up.sql",
  import.meta.url,
);

describe("API key prefix compatibility migration", () => {
  it("uses a forward migration for the generated base64url prefix alphabet", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("DROP CONSTRAINT api_keys_key_prefix_check");
    expect(sql).toContain("^rsk_[A-Za-z0-9_-]{12}$");
  });
});
