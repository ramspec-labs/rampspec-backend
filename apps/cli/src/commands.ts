export type CliCommand = "health" | "report" | "run";
export interface ParsedCommand { readonly command: CliCommand; readonly args: readonly string[]; }
export function parseCommand(argv: readonly string[]): ParsedCommand { const command = argv[0]; if (command !== "health" && command !== "run" && command !== "report") throw new Error("Unknown CLI command."); if (command !== "health" && !argv[1]) throw new Error("A resource ID is required."); return { args: argv.slice(1), command }; }
export function exitCode(success: boolean): 0 | 1 { return success ? 0 : 1; }
