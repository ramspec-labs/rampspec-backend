import { createHash } from "node:crypto";
import { createId, type OpaqueId } from "../../../domain/src/index.js";

export interface EvidenceArtifact {
  readonly byteLength: number;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly id: OpaqueId<"artifact">;
  readonly mediaType: string;
  readonly objectKey: string;
  readonly runId: OpaqueId<"run">;
}

export interface EvidenceStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get?(key: string): Promise<Uint8Array | null>;
  verify?(key: string, expectedHash: string): Promise<boolean>;
  record(artifact: EvidenceArtifact): Promise<void>;
}

export function computeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function captureEvidence(input: {
  readonly runId: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly store: EvidenceStore;
  readonly clock?: () => Date;
  readonly maxBytes?: number;
  readonly expectedChecksum?: string;
}): Promise<EvidenceArtifact> {
  if (!input.mediaType.trim()) {
    throw new Error("Evidence media type is required.");
  }
  if (input.bytes.byteLength > (input.maxBytes ?? 5_000_000)) {
    throw new Error("Evidence is too large.");
  }

  const contentHash = computeSha256(input.bytes);

  if (input.expectedChecksum && input.expectedChecksum.toLowerCase() !== contentHash.toLowerCase()) {
    throw new Error("Evidence checksum mismatch during capture streaming verification.");
  }

  const objectKey = `evidence/${contentHash}`;
  await input.store.put(objectKey, input.bytes);

  // Verify the stored object before publishing/recording its reference
  if (input.store.verify) {
    const verified = await input.store.verify(objectKey, contentHash);
    if (!verified) {
      throw new Error("Stored evidence verification failed.");
    }
  } else if (input.store.get) {
    const storedBytes = await input.store.get(objectKey);
    if (!storedBytes) {
      throw new Error("Stored evidence verification failed: object not found.");
    }
    const storedHash = computeSha256(storedBytes);
    if (storedHash !== contentHash) {
      throw new Error("Stored evidence verification failed: checksum mismatch.");
    }
  }

  const artifact: EvidenceArtifact = Object.freeze({
    byteLength: input.bytes.byteLength,
    contentHash,
    createdAt: (input.clock ?? (() => new Date()))().toISOString(),
    id: createId("artifact"),
    mediaType: input.mediaType,
    objectKey,
    runId: input.runId as OpaqueId<"run">
  });

  await input.store.record(artifact);
  return artifact;
}
