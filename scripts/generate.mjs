import { mkdir } from "node:fs/promises";

await mkdir(new URL("../generated", import.meta.url), { recursive: true });
console.log("Generated artifact directory is ready.");
