import { expect, it } from "vitest";
import { createArtifact } from "./object-store.js";
it("creates bounded content-addressed artifacts", () => expect(createArtifact({ tenantId: "org-1", bytes: new TextEncoder().encode("{}"), mediaType: "application/json", retentionDays: 30, redactionVersion: "r1" }).key).toMatch(/^evidence\//));
