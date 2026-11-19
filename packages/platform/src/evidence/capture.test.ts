import { describe, expect, it, vi } from "vitest";
import { captureEvidence } from "./capture.js";
describe("evidence capture", () => { it("hashes and stores immutable content-addressed artifacts", async () => { const keys: string[] = []; const artifact = await captureEvidence({ runId: "run_00000000-0000-4000-8000-000000000001", mediaType: "application/json", bytes: new TextEncoder().encode("{}"), store: { put: (key) => { keys.push(key); return Promise.resolve(); }, record: () => Promise.resolve() } }); expect(artifact.contentHash).toHaveLength(64); expect(keys[0]).toBe(`evidence/${artifact.contentHash}`); }); it("enforces media type and byte limits", async () => { const store = { put: () => Promise.resolve(), record: () => Promise.resolve() }; await expect(captureEvidence({ runId: "run_00000000-0000-4000-8000-000000000001", mediaType: "", bytes: new Uint8Array(), store })).rejects.toThrow("media"); await expect(captureEvidence({ runId: "run_00000000-0000-4000-8000-000000000001", mediaType: "text/plain", bytes: new Uint8Array(11), maxBytes: 10, store })).rejects.toThrow("large"); });
  it("rejects over-limit evidence before any store interaction", async () => {
    const put = vi.fn(() => Promise.resolve());
    const record = vi.fn(() => Promise.resolve());
    await expect(
      captureEvidence({
        runId: "run_00000000-0000-4000-8000-000000000001",
        mediaType: "text/plain",
        bytes: new Uint8Array(11),
        maxBytes: 10,
        store: { put, record },
      }),
    ).rejects.toThrow("large");
    expect(put).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
  it("accepts evidence exactly at the byte limit", async () => {
    const put = vi.fn(() => Promise.resolve());
    const record = vi.fn(() => Promise.resolve());
    const artifact = await captureEvidence({
      runId: "run_00000000-0000-4000-8000-000000000001",
      mediaType: "text/plain",
      bytes: new Uint8Array(10),
      maxBytes: 10,
      store: { put, record },
    });
    expect(artifact.byteLength).toBe(10);
    expect(put).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
  });
});
