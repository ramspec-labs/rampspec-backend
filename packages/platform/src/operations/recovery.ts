import { createHash } from "node:crypto";
export type BackupManifest = { createdAt: string; objectKeys: string[]; checksum: string; rpoMinutes: number; rtoHours: number };
export function createRecoveryManifest(objectKeys: string[], now = new Date()): BackupManifest { const keys = [...objectKeys].sort(); return { createdAt: now.toISOString(), objectKeys: keys, checksum: createHash("sha256").update(keys.join("\n")).digest("hex"), rpoMinutes: 15, rtoHours: 4 }; }
