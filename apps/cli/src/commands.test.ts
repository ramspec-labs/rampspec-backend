import { describe, expect, it } from "vitest";
import { exitCode, parseCommand } from "./commands.js";
describe("CLI commands", () => { it("parses supported commands", () => { expect(parseCommand(["run", "run_1"])).toEqual({ command: "run", args: ["run_1"] }); expect(parseCommand(["health"]).command).toBe("health"); }); it("rejects incomplete commands and maps failures", () => { expect(() => parseCommand(["run"])).toThrow("resource"); expect(() => parseCommand(["bad"])).toThrow("Unknown"); expect(exitCode(false)).toBe(1); }); });
