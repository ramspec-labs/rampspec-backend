import { describe, expect, it } from "vitest";
import { startSpan } from "./tracing.js";
describe("observability tracing", () => { it("propagates opaque trace and parent span ids", () => { const root = startSpan("run.start"); const child = startSpan("run.execute", root); expect(child.traceId).toBe(root.traceId); expect(child.parentSpanId).toBe(root.spanId); }); it("rejects unsafe span names", () => { expect(() => startSpan("bad name")).toThrow("span"); }); });
