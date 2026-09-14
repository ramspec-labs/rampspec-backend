import { expect, it } from "vitest";
import { createRecoveryManifest } from "./recovery.js";
it("creates deterministic recovery manifests", () => expect(createRecoveryManifest(["b", "a"]).objectKeys).toEqual(["a", "b"]));
