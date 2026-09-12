import { access } from "node:fs/promises";

const entrypoints = [
  "api",
  "browser",
  "cli",
  "evidence",
  "gateway",
  "report",
  "scheduler",
  "webhook",
  "workflow",
];

await Promise.all(
  entrypoints.map((name) =>
    access(new URL(`../dist/apps/${name}/src/index.js`, import.meta.url)),
  ),
);

console.log(`Verified ${entrypoints.length} built application entrypoints.`);
