import { describe, expect, it } from "vitest";

import {
  createBackupManifest,
  validateRestore,
  verifyRestoreCommand,
} from "./backup.js";

describe("backup manifests", () => {
  it("creates and validates deterministic checksums", () => {
    const manifest = createBackupManifest(
      ["runs/a", "evidence/b"],
      () => new Date("2026-09-12T18:00:00.000Z"),
    );
    expect(manifest.objectKeys).toEqual(["evidence/b", "runs/a"]);
    expect(() => validateRestore(manifest)).not.toThrow();
  });

  it("rejects tampered manifests", () => {
    const manifest = createBackupManifest(["runs/a"]);
    expect(() =>
      validateRestore({ ...manifest, objectKeys: ["runs/b"] }),
    ).toThrow("checksum");
  });

  it("runs verifyRestoreCommand and produces a redacted report", async () => {
    const manifest = createBackupManifest(["runs/1", "evidence/2"]);
    const report = await verifyRestoreCommand(manifest, {
      clock: () => new Date("2026-11-20T20:00:00.000Z"),
      isolatedTarget: "isolated_target_db",
      schemaVersion: 8,
    });

    expect(report.integrityStatus).toBe("verified");
    expect(report.schemaVersion).toBe(8);
    expect(report.counts.objectsChecked).toBe(2);
    expect(report.isolatedTarget).toBe("isolated_target_db");
    expect(report).not.toHaveProperty("objectKeys");
  });

  it("fails when attempting to verify against production targets", async () => {
    const manifest = createBackupManifest(["runs/1"]);
    await expect(
      verifyRestoreCommand(manifest, { isolatedTarget: "production_db" }),
    ).rejects.toThrow("production");
  });
});
