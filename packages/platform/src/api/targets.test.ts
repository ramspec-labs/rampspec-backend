import { describe, expect, it } from "vitest";
import { InMemoryTargetRepository, TargetService } from "./targets.js";

const organizationId = "organization_00000000-0000-4000-8000-000000000001";
const projectId = "project_00000000-0000-4000-8000-000000000002";
const assetA = "asset_00000000-0000-4000-8000-000000000003";
const assetB = "asset_00000000-0000-4000-8000-000000000004";

describe("target and corridor service", () => {
  it("normalizes target origins, validates networks, and archives targets", async () => {
    const repository = new InMemoryTargetRepository();
    const service = new TargetService({ clock: () => new Date("2026-09-12T18:00:00.000Z"), repository });
    const target = await service.create({ organizationId, projectId, name: "API", origin: "https://EXAMPLE.com/", stellarNetwork: "testnet", networkPassphrase: "Test SDF Network ; September 2015" });
    expect(target.normalizedOrigin).toBe("https://example.com");
    expect((await service.archive(organizationId, target.id)).status).toBe("archived");
    await expect(service.create({ organizationId, projectId, name: "Bad", origin: "https://other.example", stellarNetwork: "pubnet", networkPassphrase: "wrong" })).rejects.toThrow("passphrase");
  });

  it("creates tenant-scoped corridors with distinct existing assets", async () => {
    const repository = new InMemoryTargetRepository();
    const service = new TargetService({ repository });
    const target = await service.create({ organizationId, projectId, name: "API", origin: "https://example.com", stellarNetwork: "custom", customNetworkId: "local-1", networkPassphrase: "local passphrase" });
    await repository.insertAsset({ canonicalAssetId: "native", code: null, contractId: null, createdAt: new Date().toISOString(), decimals: 7, enabled: true, id: assetA as never, issuer: null, organizationId: organizationId as never, targetId: target.id, type: "native" });
    await repository.insertAsset({ canonicalAssetId: "usd", code: "USD", contractId: null, createdAt: new Date().toISOString(), decimals: 7, enabled: true, id: assetB as never, issuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", organizationId: organizationId as never, targetId: target.id, type: "credit_alphanum4" });
    const corridor = await service.createCorridor({ organizationId, targetId: target.id, inputAssetId: assetA, outputAssetId: assetB, direction: "deposit", methods: ["sepa"] });
    expect(corridor.enabled).toBe(true);
    expect((await service.setCorridorEnabled(organizationId, corridor.id, false)).enabled).toBe(false);
    await expect(service.createCorridor({ organizationId, targetId: target.id, inputAssetId: assetA, outputAssetId: assetA, direction: "deposit", methods: ["sepa"] })).rejects.toThrow("differ");
  });

  it("rejects unsafe origins and duplicate target origins", async () => {
    const service = new TargetService({ repository: new InMemoryTargetRepository() });
    const input = { organizationId, projectId, name: "API", origin: "https://example.com", stellarNetwork: "testnet" as const, networkPassphrase: "Test SDF Network ; September 2015" };
    await service.create(input);
    await expect(service.create(input)).rejects.toThrow("already exists");
    await expect(service.create({ ...input, origin: "https://example.com/path" })).rejects.toThrow("path");
  });
});
