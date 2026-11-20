import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createReleaseManifest,
  verifyReleaseManifest,
} from "./release-manifest.js";

describe("release manifest", () => {
  it("binds sorted build digests and the image digest to the source commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "rampspec-release-"));
    try {
      await mkdir(join(root, "dist", "z"), { recursive: true });
      await mkdir(join(root, "generated"), { recursive: true });
      await writeFile(join(root, "dist", "z", "output.js"), "export {};\n");
      await writeFile(join(root, "dist", "a.js"), "export const a = 1;\n");
      await writeFile(join(root, "generated", "contract.json"), "{}\n");

      const manifest = await createReleaseManifest({
        containerDigest: `sha256:${"b".repeat(64)}`,
        containerImage: "ghcr.io/rampspec-labs/rampspec-backend",
        rootDirectory: root,
        sourceCommit: "a".repeat(40),
      });

      expect(manifest.artifacts.map(({ path }) => path)).toEqual([
        "dist/a.js",
        "dist/z/output.js",
        "generated/contract.json",
      ]);
      expect(manifest.container.digest).toHaveLength(71);
      expect(manifest.sourceCommit).toBe("a".repeat(40));

      const verification = await verifyReleaseManifest(manifest, { rootDirectory: root });
      expect(verification.verified).toBe(true);
      expect(verification.diagnostics).toHaveLength(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("detects tampered or missing artifacts with actionable diagnostics", async () => {
    const root = await mkdtemp(join(tmpdir(), "rampspec-release-"));
    try {
      await mkdir(join(root, "dist"), { recursive: true });
      await writeFile(join(root, "dist", "a.js"), "original content\n");

      const manifest = await createReleaseManifest({
        containerDigest: `sha256:${"c".repeat(64)}`,
        containerImage: "ghcr.io/rampspec-labs/rampspec-backend",
        rootDirectory: root,
        sourceCommit: "c".repeat(40),
      });

      // Tamper with file
      await writeFile(join(root, "dist", "a.js"), "tampered content\n");
      const tamperedCheck = await verifyReleaseManifest(manifest, { rootDirectory: root });
      expect(tamperedCheck.verified).toBe(false);
      expect(tamperedCheck.diagnostics[0]?.message).toBe("Checksum mismatch.");

      // Delete file
      await rm(join(root, "dist", "a.js"));
      const missingCheck = await verifyReleaseManifest(manifest, { rootDirectory: root });
      expect(missingCheck.verified).toBe(false);
      expect(missingCheck.diagnostics[0]?.message).toContain("Artifact missing");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects incomplete traceability inputs", async () => {
    await expect(createReleaseManifest()).rejects.toThrow("SOURCE_COMMIT");
  });
});
