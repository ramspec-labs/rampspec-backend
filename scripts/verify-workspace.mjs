import { readFile } from "node:fs/promises";

const expectedApplications = [
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
const expectedPackages = ["domain", "platform", "protocol", "testing"];

async function readName(kind, name) {
  const manifest = JSON.parse(
    await readFile(
      new URL(`../${kind}/${name}/package.json`, import.meta.url),
      "utf8",
    ),
  );
  return manifest.name;
}

const applicationNames = await Promise.all(
  expectedApplications.map((name) => readName("apps", name)),
);
const packageNames = await Promise.all(
  expectedPackages.map((name) => readName("packages", name)),
);

const expectedNames = [
  ...expectedApplications.map((name) => `@rampspec/${name}`),
  ...expectedPackages.map((name) => `@rampspec/${name}`),
];
const actualNames = [...applicationNames, ...packageNames];

if (new Set(actualNames).size !== expectedNames.length) {
  throw new Error("Workspace package names must be unique.");
}

for (const name of expectedNames) {
  if (!actualNames.includes(name)) {
    throw new Error(`Missing workspace package ${name}.`);
  }
}

console.log(`Verified ${actualNames.length} workspace packages.`);
