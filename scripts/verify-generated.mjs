import { spawnSync } from "node:child_process";

const diff = spawnSync("git", ["diff", "--exit-code", "--", "generated"], {
  encoding: "utf8",
  shell: false,
});
const status = spawnSync("git", ["status", "--porcelain", "--", "generated"], {
  encoding: "utf8",
  shell: false,
});

if (diff.status !== 0 || status.status !== 0 || status.stdout.trim() !== "") {
  process.stderr.write(diff.stdout);
  process.stderr.write(status.stdout);
  throw new Error("Generated artifacts differ from committed output.");
}

console.log("Generated artifacts match committed output.");
