export type CliCommand = "health" | "report" | "run" | "discover" | "validate" | "verify" | "evidence" | "runner";
export interface ParsedCommand { readonly command: CliCommand; readonly args: readonly string[]; }
export function parseCommand(argv: readonly string[]): ParsedCommand { const command = argv[0]; if (!command || !["health", "run", "report", "discover", "validate", "verify", "evidence", "runner"].includes(command)) throw new Error("Unknown CLI command."); if (command !== "health" && !argv[1]) throw new Error("A resource ID is required."); return { args: argv.slice(1), command: command as CliCommand }; }
export type CliExit = "success" | "conformance" | "policy" | "config" | "infrastructure" | "auth" | "cancel";
export const exitCodes: Record<CliExit, number> = { success: 0, conformance: 10, policy: 11, config: 12, infrastructure: 13, auth: 14, cancel: 15 };
export function exitCode(success: boolean): 0 | 1 { return success ? 0 : 1; }
