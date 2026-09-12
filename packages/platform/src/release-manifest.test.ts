import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createReleaseManifest } from "./release-manifest.js";

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
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects incomplete traceability inputs", async () => {
    await expect(createReleaseManifest()).rejects.toThrow("SOURCE_COMMIT");
  });
});
