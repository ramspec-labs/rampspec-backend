import { spawnSync } from "node:child_process";

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
