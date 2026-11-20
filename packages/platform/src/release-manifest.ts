import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

export interface ReleaseManifestOptions {
  readonly containerDigest?: string;
  readonly containerImage?: string;
  readonly rootDirectory?: string;
  readonly sourceCommit?: string;
}

export interface ArtifactDigest {
  readonly path: string;
  readonly sha256: string;
}

export interface ReleaseManifest {
  readonly artifacts: readonly ArtifactDigest[];
  readonly container: {
    readonly digest: string;
    readonly image: string;
  };
  readonly packageManager: string;
  readonly runtime: string;
  readonly schemaVersion: number;
  readonly sourceCommit: string;
}

export interface VerificationDiagnostic {
  readonly expected?: string;
  readonly found?: string;
  readonly message: string;
  readonly path?: string;
}

export interface VerificationResult {
  readonly diagnostics: readonly VerificationDiagnostic[];
  readonly verified: boolean;
}

async function filesUnder(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? filesUnder(path) : [path];
      }),
    );
    return nested.flat().sort((left, right) => left.localeCompare(right, "en"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
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
): Promise<ReleaseManifest> {
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
  };
}

export async function verifyReleaseManifest(
  manifest: ReleaseManifest,
  options: { readonly rootDirectory?: string } = {},
): Promise<VerificationResult> {
  const root = resolve(options.rootDirectory ?? process.cwd());
  const diagnostics: VerificationDiagnostic[] = [];

  if (manifest.schemaVersion !== 1) {
    diagnostics.push({
      expected: "1",
      found: String(manifest.schemaVersion),
      message: "Unsupported schemaVersion.",
    });
  }

  if (!manifest.sourceCommit || !/^[a-f\d]{40}$/iu.test(manifest.sourceCommit)) {
    diagnostics.push({
      message: "Invalid or missing sourceCommit in release manifest.",
    });
  }

  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    diagnostics.push({
      message: "Release manifest must declare at least one verified artifact.",
    });
  } else {
    for (const item of manifest.artifacts) {
      const artifact = item as ArtifactDigest;
      const fullPath = resolve(root, artifact.path);
      try {
        const fileContent = await readFile(fullPath);
        const actualHash = createHash("sha256").update(fileContent).digest("hex");
        if (actualHash !== artifact.sha256) {
          diagnostics.push({
            expected: artifact.sha256,
            found: actualHash,
            message: "Checksum mismatch.",
            path: artifact.path,
          });
        }
      } catch (err) {
        diagnostics.push({
          message: `Artifact missing or unreadable: ${err instanceof Error ? err.message : String(err)}`,
          path: artifact.path,
        });
      }
    }
  }

  return {
    diagnostics,
    verified: diagnostics.length === 0,
  };
}
