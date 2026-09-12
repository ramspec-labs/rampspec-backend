export interface HealthCheck { readonly name: string; readonly check: () => Promise<boolean>; }
export async function readiness(checks: readonly HealthCheck[]): Promise<{ readonly status: "ready" | "not_ready"; readonly checks: Readonly<Record<string, boolean>> }> { const results: Record<string, boolean> = {}; for (const check of checks) results[check.name] = await check.check().catch(() => false); return { checks: results, status: Object.values(results).every(Boolean) ? "ready" : "not_ready" }; }
export function liveness(): { readonly status: "ok" } { return { status: "ok" }; }
