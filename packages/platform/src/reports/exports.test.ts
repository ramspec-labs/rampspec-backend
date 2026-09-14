import { expect, it } from "vitest";
import { diffReports, exportJunit } from "./exports.js";
it("derives non-authoritative exports", () => { expect(exportJunit({ reportId: "r", checks: { passed: 2, failed: 1 } })).toContain("failures=\"1\""); expect(diffReports({ a: 1 }, { a: 2 })).toEqual(["a"]); });
