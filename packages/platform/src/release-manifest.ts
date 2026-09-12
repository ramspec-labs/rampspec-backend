import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

export interface ReleaseManifestOptions {
  readonly containerDigest?: string;
  readonly containerImage?: string;
  readonly rootDirectory?: string;
  readonly sourceCommit?: string;
}

interface ArtifactDigest {
  readonly path: string;
  readonly sha256: string;
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    }),
  );
  return nested.flat().sort((left, right) => left.localeCompare(right, "en"));
}

async function digest(path: string, root: string): Promise<ArtifactDigest> {
  return {
    path: relative(root, path).replaceAll("\\", "/"),
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
  };
}

export async function createReleaseManifest(
  options: ReleaseManifestOptions = {},
) {
  const root = resolve(options.rootDirectory ?? process.cwd());
  const sourceCommit = options.sourceCommit;
  const containerImage = options.containerImage;
  const containerDigest = options.containerDigest;

  if (!sourceCommit || !/^[a-f\d]{40}$/iu.test(sourceCommit)) {
    throw new Error("SOURCE_COMMIT must be a full Git commit SHA.");
  }
  if (
    !containerImage ||
    !containerDigest ||
    !/^sha256:[a-f\d]{64}$/iu.test(containerDigest)
  ) {
    throw new Error("A container image and sha256 digest are required.");
  }

  const artifactPaths = (
    await Promise.all(
      ["dist", "generated"].map((directory) =>
        filesUnder(resolve(root, directory)),
      ),
    )
  ).flat();
  const artifacts = await Promise.all(
    artifactPaths
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((path) => digest(path, root)),
  );

  return {
    artifacts,
    container: { digest: containerDigest, image: containerImage },
    packageManager: "pnpm@12.4.1",
    runtime: "node@24.21.0",
    schemaVersion: 1,
    sourceCommit,
  } as const;
}
