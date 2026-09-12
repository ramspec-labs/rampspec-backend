import { createHash } from "node:crypto";

export interface SpecSnapshot { readonly content: Readonly<Record<string, unknown>>; readonly fetchedAt: string; readonly hash: string; readonly id: string; readonly sourceUrl: string; }
export interface SpecSnapshotRepository { insert(snapshot: SpecSnapshot): Promise<void>; }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`; return JSON.stringify(value); }
export class SpecImporter {
  private readonly clock: () => Date; private readonly repository: SpecSnapshotRepository;
  constructor(options: { readonly repository: SpecSnapshotRepository; readonly clock?: () => Date }) { this.repository = options.repository; this.clock = options.clock ?? (() => new Date()); }
  async import(sourceUrl: string, expectedHash?: string): Promise<SpecSnapshot> {
    const url = new URL(sourceUrl); if (url.protocol !== "https:") throw new Error("Specification source must use HTTPS.");
    const response = await fetch(url); if (!response.ok) throw new Error(`Specification fetch failed with ${response.status}.`);
    const contentLength = Number(response.headers.get("content-length") ?? "0"); if (contentLength > 2_000_000) throw new Error("Specification is too large.");
    const text = await response.text(); if (new TextEncoder().encode(text).byteLength > 2_000_000) throw new Error("Specification is too large.");
    let content: unknown; try { content = JSON.parse(text); } catch { throw new Error("Specification must be valid JSON."); }
    if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("Specification root must be an object.");
    const hash = createHash("sha256").update(canonical(content), "utf8").digest("hex"); if (expectedHash && expectedHash !== hash) throw new Error("Specification hash does not match.");
    const snapshot: SpecSnapshot = Object.freeze({ content: structuredClone(content) as Readonly<Record<string, unknown>>, fetchedAt: this.clock().toISOString(), hash, id: `spec_${hash.slice(0, 24)}`, sourceUrl: url.toString() });
    await this.repository.insert(snapshot); return snapshot;
  }
}
export class InMemorySpecSnapshotRepository implements SpecSnapshotRepository { readonly snapshots = new Map<string, SpecSnapshot>(); insert(snapshot: SpecSnapshot): Promise<void> { if (this.snapshots.has(snapshot.hash)) return Promise.resolve(); this.snapshots.set(snapshot.hash, snapshot); return Promise.resolve(); } }
