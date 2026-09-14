export type ServiceObjective = { name: string; measuredValue: number; unit: string; source: string };
export function publishObjective(objective: ServiceObjective) { if (!Number.isFinite(objective.measuredValue) || !objective.source.trim()) throw new Error("Measured source is required."); return Object.freeze(objective); }
