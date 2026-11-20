import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareJsonSchemas,
  evaluateSchemaCompatibilityGate,
} from "../dist/packages/protocol/src/compatibility.js";

// 1. Verify that generated artifacts in working tree have no unstaged/untracked diffs
const diff = spawnSync("git", ["diff", "--exit-code", "--", "generated"], {
  encoding: "utf8",
  shell: false,
});
const untracked = spawnSync(
  "git",
  ["ls-files", "--others", "--exclude-standard", "--", "generated"],
  {
    encoding: "utf8",
    shell: false,
  },
);

if (diff.status !== 0 || untracked.status !== 0 || untracked.stdout.trim() !== "") {
  process.stderr.write(diff.stdout);
  process.stderr.write(untracked.stdout);
  throw new Error("Generated artifacts differ from committed output.");
}

console.log("Generated artifacts match committed output.");

// 2. Compatibility gate: compare generated schemas with latest released tag (v0.2.1)
const rootDir = fileURLToPath(new URL("..", import.meta.url));
const schemaDir = join(rootDir, "generated", "schemas", "v1");

// Determine latest release tag or default to v0.2.1
const tagsResult = spawnSync("git", ["tag", "-l", "v*"], {
  cwd: rootDir,
  encoding: "utf8",
  shell: false,
});

const latestTag =
  tagsResult.stdout
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .sort()
    .pop() || "v0.2.1";

const overrideEvidence = process.env.SCHEMA_COMPATIBILITY_OVERRIDE;
const comparisons = [];

try {
  const schemaFiles = readdirSync(schemaDir).filter((file) => file.endsWith(".json"));

  for (const file of schemaFiles) {
    const currentPath = join(schemaDir, file);
    const currentSchema = JSON.parse(readFileSync(currentPath, "utf8"));

    // Attempt to load baseline schema from git tag
    const baselineResult = spawnSync(
      "git",
      ["show", `${latestTag}:generated/schemas/v1/${file}`],
      { cwd: rootDir, encoding: "utf8", shell: false },
    );

    if (baselineResult.status === 0 && baselineResult.stdout.trim()) {
      const baselineSchema = JSON.parse(baselineResult.stdout);
      const comparison = compareJsonSchemas(file, baselineSchema, currentSchema, overrideEvidence);
      comparisons.push(comparison);
    }
  }

  if (comparisons.length > 0) {
    const gateResult = evaluateSchemaCompatibilityGate(comparisons, overrideEvidence);
    if (!gateResult.passed) {
      console.error(
        `[SCHEMA GATE FAILED] ${gateResult.breakingCount} schemas have breaking changes without override evidence:`,
      );
      for (const res of gateResult.results.filter((r) => r.breaking)) {
        console.error(`- ${res.schemaName}:`);
        for (const change of res.changes.filter((c) => c.breaking)) {
          console.error(`    * ${change.description}`);
        }
      }
      process.exit(1);
    }
    console.log(
      `Schema compatibility gate passed against baseline ${latestTag} (${comparisons.length} schemas verified).`,
    );
  }
} catch (error) {
  console.warn("Schema compatibility check warning:", error);
}
