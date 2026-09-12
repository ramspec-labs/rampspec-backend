import { describe, expect, it } from "vitest";
import { AttemptService } from "./attempts.js";
const runId = "run_00000000-0000-4000-8000-000000000001" as never;
describe("run attempts", () => { it("numbers attempts and enforces retry limits", () => { const service = new AttemptService(); const first = service.create(runId, 1); expect(first.attemptNumber).toBe(1); expect(service.update(first, "running").state).toBe("running"); expect(() => service.create(runId, 1)).not.toThrow(); expect(() => service.create(runId, 1)).toThrow("limit"); }); it("prevents terminal mutations", () => { const service = new AttemptService(); const attempt = service.create(runId); const failed = service.update(attempt, "failed"); expect(() => service.update(failed, "running")).toThrow("terminal"); }); });
