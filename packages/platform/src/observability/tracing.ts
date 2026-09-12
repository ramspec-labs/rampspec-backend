import { randomUUID } from "node:crypto";
export interface TraceContext { readonly traceId: string; readonly spanId: string; readonly parentSpanId: string | null; readonly name: string; }
export function startSpan(name: string, parent?: TraceContext): TraceContext { if (!/^[a-z][a-z0-9_.-]{1,63}$/u.test(name)) throw new Error("Invalid span name."); return { name, parentSpanId: parent?.spanId ?? null, spanId: randomUUID().replaceAll("-", "").slice(0, 16), traceId: parent?.traceId ?? randomUUID().replaceAll("-", "") }; }
