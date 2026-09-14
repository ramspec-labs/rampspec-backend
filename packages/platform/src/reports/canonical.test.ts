import { expect, it } from "vitest";
import { buildCanonicalReport } from "./canonical.js";
it("finalizes one immutable report", () => expect(buildCanonicalReport({ schemaVersion: "1", reportId: "r", runId: "run", targetId: "t", suiteHash: "h", checks: { passed: 1, failed: 0, skipped: 0 }, findings: [], indeterminate: false })).toHaveProperty("finalizedAt"));
