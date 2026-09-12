export const service = { kind: "client", name: "cli" } as const;

export function run(args: readonly string[]): number {
  return args.includes("--version") ? 0 : 0;
}
