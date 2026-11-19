import { describe, expect, it } from "vitest";
import { parseId } from "../../../domain/src/index.js";
import { InMemoryRunRepository, RunService } from "./service.js";
const organizationId = "organization_00000000-0000-4000-8000-000000000001"; const projectId = "project_00000000-0000-4000-8000-000000000002"; const targetId = "target_00000000-0000-4000-8000-000000000003"; const suiteId = "suite_00000000-0000-4000-8000-000000000004";
const otherOrganizationId = "organization_00000000-0000-4000-8000-000000000099";
describe("run creation", () => { it("creates requested runs and returns the same record for retries", async () => { const service = new RunService({ repository: new InMemoryRunRepository() }); const input = { organizationId, projectId, targetId, suiteId, suiteVersion: "1.0.0", idempotencyKey: "request-key-000001", effectiveConfig: { network: "testnet" } }; const first = await service.create(input); expect(first.state).toBe("requested"); expect(await service.create(input)).toEqual(first); expect(first.effectiveConfigHash).toHaveLength(64); }); it("rejects malformed idempotency keys and identifiers", async () => { const service = new RunService({ repository: new InMemoryRunRepository() }); await expect(service.create({ organizationId, projectId, targetId, suiteId, suiteVersion: "1.0.0", idempotencyKey: "short", effectiveConfig: {} })).rejects.toThrow("idempotency"); }); });

describe("atomic idempotency claims", () => {
  const input = {
    organizationId,
    projectId,
    targetId,
    suiteId,
    suiteVersion: "1.0.0",
    idempotencyKey: "request-key-000002",
    effectiveConfig: { network: "testnet" },
  };

  it("creates exactly one run for concurrent duplicate claims", async () => {
    const service = new RunService({ repository: new InMemoryRunRepository() });
    const [first, second] = await Promise.all([
      service.create(input),
      service.create(input),
    ]);
    expect(first.id).toBe(second.id);
    expect(first).toEqual(second);
  });

  it("reports which claim created the run and which returned the original", async () => {
    const service = new RunService({ repository: new InMemoryRunRepository() });
    const created = await service.createClaim(input);
    expect(created.created).toBe(true);
    const duplicate = await service.createClaim(input);
    expect(duplicate.created).toBe(false);
    expect(duplicate.run).toEqual(created.run);
  });

  it("returns the original run when a duplicate claim carries different config", async () => {
    const service = new RunService({ repository: new InMemoryRunRepository() });
    const first = await service.create(input);
    const duplicate = await service.create({
      ...input,
      effectiveConfig: { network: "pubnet" },
    });
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.effectiveConfig).toEqual({ network: "testnet" });
    expect(duplicate.effectiveConfigHash).toBe(first.effectiveConfigHash);
  });

  it("keeps the same key separate across organizations", async () => {
    const service = new RunService({ repository: new InMemoryRunRepository() });
    const first = await service.create(input);
    const other = await service.create({
      ...input,
      organizationId: otherOrganizationId,
    });
    expect(other.id).not.toBe(first.id);
    expect(other.organizationId).toBe(otherOrganizationId);
    expect(
      await service.create({ ...input, organizationId: otherOrganizationId }),
    ).toEqual(other);
  });

  it("claims atomically at the repository level", async () => {
    const repository = new InMemoryRunRepository();
    const service = new RunService({ repository });
    const first = await service.create(input);
    const [again, missing] = await Promise.all([
      repository.findByIdempotency(
        parseId("organization", organizationId),
        "request-key-000002",
      ),
      repository.findByIdempotency(
        parseId("organization", organizationId),
        "request-key-999999",
      ),
    ]);
    expect(again).toEqual(first);
    expect(missing).toBeUndefined();
  });
});
