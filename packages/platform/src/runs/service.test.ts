import { describe, expect, it } from "vitest";
import { RunQuotaManager } from "../security/rate-limit.js";
import {
  InMemoryRunRepository,
  QuotaExceededError,
  RunService,
} from "./service.js";

const organizationId = "organization_00000000-0000-4000-8000-000000000001";
const projectId = "project_00000000-0000-4000-8000-000000000002";
const targetId = "target_00000000-0000-4000-8000-000000000003";
const suiteId = "suite_00000000-0000-4000-8000-000000000004";

describe("run creation", () => {
  it("creates requested runs and returns the same record for retries", async () => {
    const service = new RunService({
      repository: new InMemoryRunRepository(),
    });
    const input = {
      organizationId,
      projectId,
      targetId,
      suiteId,
      suiteVersion: "1.0.0",
      idempotencyKey: "request-key-000001",
      effectiveConfig: { network: "testnet" },
    };
    const first = await service.create(input);
    expect(first.state).toBe("requested");
    expect(await service.create(input)).toEqual(first);
    expect(first.effectiveConfigHash).toHaveLength(64);
  });

  it("rejects malformed idempotency keys and identifiers", async () => {
    const service = new RunService({
      repository: new InMemoryRunRepository(),
    });
    await expect(
      service.create({
        organizationId,
        projectId,
        targetId,
        suiteId,
        suiteVersion: "1.0.0",
        idempotencyKey: "short",
        effectiveConfig: {},
      }),
    ).rejects.toThrow("idempotency");
  });
});

describe("run quota enforcement", () => {
  it("rejects runs when concurrent quota is exceeded", async () => {
    let now = 0;
    const quotaManager = new RunQuotaManager({
      concurrentLimit: 1,
      windowedLimit: 10,
      windowMs: 60_000,
      clock: () => now,
    });
    const service = new RunService({
      repository: new InMemoryRunRepository(),
      quotaManager,
    });

    const input = {
      organizationId,
      projectId,
      targetId,
      suiteId,
      suiteVersion: "1.0.0",
      idempotencyKey: "request-key-concurrent-1",
      effectiveConfig: { network: "testnet" },
    };

    // First run succeeds
    await expect(service.create(input)).resolves.toMatchObject({
      state: "requested",
    });

    // Second run with different idempotency key fails due to concurrent limit
    await expect(
      service.create({
        ...input,
        idempotencyKey: "request-key-concurrent-2",
      }),
    ).rejects.toThrow(QuotaExceededError);
  });

  it("provides deterministic retry-after metadata for quota exceeded", async () => {
    let now = 0;
    const quotaManager = new RunQuotaManager({
      concurrentLimit: 1,
      windowedLimit: 10,
      windowMs: 60_000,
      clock: () => now,
    });
    const service = new RunService({
      repository: new InMemoryRunRepository(),
      quotaManager,
    });

    const input = {
      organizationId,
      projectId,
      targetId,
      suiteId,
      suiteVersion: "1.0.0",
      idempotencyKey: "request-key-quota-1",
      effectiveConfig: { network: "testnet" },
    };

    await service.create(input);

    try {
      await service.create({
        ...input,
        idempotencyKey: "request-key-quota-2",
      });
      throw new Error("Should have thrown QuotaExceededError");
    } catch (error) {
      expect(error).toBeInstanceOf(QuotaExceededError);
      const quotaError = error as QuotaExceededError;
      expect(quotaError.type).toBe("concurrent");
      expect(quotaError.retryAfterSeconds).toBeGreaterThan(0);
      expect(quotaError.status).toBe(429);
      expect(quotaError.code).toBe("quota_exceeded");
    }
  });

  it("enforces windowed quota across time window", async () => {
    let now = 0;
    const quotaManager = new RunQuotaManager({
      concurrentLimit: 10,
      windowedLimit: 2,
      windowMs: 1000,
      clock: () => now,
    });
    const service = new RunService({
      repository: new InMemoryRunRepository(),
      quotaManager,
    });

    // Create two runs within window
    for (let i = 0; i < 2; i++) {
      await expect(
        service.create({
          organizationId,
          projectId,
          targetId,
          suiteId,
          suiteVersion: "1.0.0",
          idempotencyKey: `request-key-windowed-${i}`,
          effectiveConfig: { network: "testnet" },
        }),
      ).resolves.toBeDefined();
    }

    // Third run within window fails
    await expect(
      service.create({
        organizationId,
        projectId,
        targetId,
        suiteId,
        suiteVersion: "1.0.0",
        idempotencyKey: "request-key-windowed-3",
        effectiveConfig: { network: "testnet" },
      }),
    ).rejects.toThrow(QuotaExceededError);

    // After window expires, new run succeeds
    now = 1001;
    await expect(
      service.create({
        organizationId,
        projectId,
        targetId,
        suiteId,
        suiteVersion: "1.0.0",
        idempotencyKey: "request-key-windowed-4",
        effectiveConfig: { network: "testnet" },
      }),
    ).resolves.toBeDefined();
  });

  it("isolates quotas between organizations", async () => {
    const quotaManager = new RunQuotaManager({
      concurrentLimit: 1,
      windowedLimit: 10,
      windowMs: 60_000,
    });
    const service = new RunService({
      repository: new InMemoryRunRepository(),
      quotaManager,
    });

    const org1 = "organization_org1-0000-4000-8000-000000000001";
    const org2 = "organization_org2-0000-4000-8000-000000000002";

    // Org1 creates first run
    await expect(
      service.create({
        organizationId: org1,
        projectId,
        targetId,
        suiteId,
        suiteVersion: "1.0.0",
        idempotencyKey: "request-key-org1-1",
        effectiveConfig: { network: "testnet" },
      }),
    ).resolves.toBeDefined();

    // Org1 hits concurrent limit
    await expect(
      service.create({
        organizationId: org1,
        projectId,
        targetId,
        suiteId,
        suiteVersion: "1.0.0",
        idempotencyKey: "request-key-org1-2",
        effectiveConfig: { network: "testnet" },
      }),
    ).rejects.toThrow(QuotaExceededError);

    // Org2 can still create runs independently
    await expect(
      service.create({
        organizationId: org2,
        projectId,
        targetId,
        suiteId,
        suiteVersion: "1.0.0",
        idempotencyKey: "request-key-org2-1",
        effectiveConfig: { network: "testnet" },
      }),
    ).resolves.toBeDefined();
  });

  it("allows retries with same idempotency key when quota exceeded", async () => {
    let now = 0;
    const quotaManager = new RunQuotaManager({
      concurrentLimit: 1,
      windowedLimit: 10,
      windowMs: 60_000,
      clock: () => now,
    });
    const service = new RunService({
      repository: new InMemoryRunRepository(),
      quotaManager,
    });

    const input = {
      organizationId,
      projectId,
      targetId,
      suiteId,
      suiteVersion: "1.0.0",
      idempotencyKey: "request-key-idempotent-1",
      effectiveConfig: { network: "testnet" },
    };

    // Create first run
    const first = await service.create(input);

    // Try to create another run with same idempotency key should return same run
    const retry = await service.create(input);
    expect(retry).toEqual(first);
  });
});
