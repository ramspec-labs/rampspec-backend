import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ApiKeyService, InMemoryApiKeyStore } from "./api-keys.js";

const now = new Date("2026-09-12T18:00:00.000Z");

describe("service-account API keys", () => {
  function service(maxActivePerServiceAccount = 20) {
    return new ApiKeyService({
      clock: () => now,
      maxActivePerServiceAccount,
      store: new InMemoryApiKeyStore(),
    });
  }

  it("issues a one-time credential with normalized scopes", async () => {
    const credentials = await service().issue(
      "organization_a",
      "service_account_a",
      ["runs:write", "evidence:read", "runs:write"],
    );
    expect(credentials.key).toMatch(/^rsk_[A-Za-z0-9_-]{43}$/u);
    expect(credentials.scopes).toEqual(["evidence:read", "runs:write"]);
    await expect(
      service().issue("organization_a", "service_account_a", ["not-a-scope"]),
    ).rejects.toThrow("scopes");
  });

  it("authenticates exact keys, updates last use, and enforces scopes", async () => {
    const auth = service();
    const credentials = await auth.issue(
      "organization_a",
      "service_account_a",
      ["runs:write"],
    );
    await expect(
      auth.authenticate(`${credentials.key.slice(0, -1)}x`),
    ).rejects.toThrow("Invalid or expired");
    await expect(
      auth.authenticate(credentials.key, "runs:write"),
    ).resolves.toMatchObject({
      lastUsedAt: "2026-09-12T18:00:00.000Z",
    });
    await expect(
      auth.authenticate(credentials.key, "runs:read"),
    ).rejects.toThrow("scope");
  });

  it("supports one-time rotation and disabling", async () => {
    const auth = service();
    const first = await auth.issue("organization_a", "service_account_a", [
      "runs:write",
    ]);
    const second = await auth.rotate(
      "organization_a",
      "service_account_a",
      first.key,
    );
    await expect(auth.authenticate(first.key)).rejects.toThrow(
      "Invalid or expired",
    );
    await expect(auth.authenticate(second.key)).resolves.toMatchObject({
      serviceAccountId: "service_account_a",
    });
  });

  it("allows rotation at the active-key cap by replacing the old key", async () => {
    const auth = service(1);
    const first = await auth.issue("organization_a", "service_account_a", [
      "runs:write",
    ]);
    const second = await auth.rotate(
      "organization_a",
      "service_account_a",
      first.key,
    );
    await expect(auth.authenticate(second.key)).resolves.toMatchObject({
      serviceAccountId: "service_account_a",
    });
  });

  it("enforces expiry and per-service-account active-key limits", async () => {
    const auth = service(1);
    await auth.issue("organization_a", "service_account_a", ["runs:write"]);
    await expect(
      auth.issue("organization_a", "service_account_a", ["runs:write"]),
    ).rejects.toThrow("rate limit");
    await expect(
      service().issue(
        "organization_a",
        "service_account_a",
        ["runs:write"],
        now,
      ),
    ).rejects.toThrow("expiry");
  });

  it("keeps plaintext credentials out of the schema and record representation", async () => {
    const sql = await readFile(
      new URL(
        "../../../../migrations/0002_tenant_identity.up.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain("key_hash bytea NOT NULL");
    expect(sql).not.toMatch(/plaintext|raw_key|secret_value/iu);
  });
});
