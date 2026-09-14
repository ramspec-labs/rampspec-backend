import { randomUUID } from "node:crypto";

export const service = { kind: "client", name: "cli" } as const;

export function run(args: readonly string[]): number {
  return args.includes("--version") ? 0 : 0;
}
export function formatOutput(value: unknown, json = false) { return json ? JSON.stringify(value) : String(value); }
export function requestId() { return `req_${randomUUID()}`; }
