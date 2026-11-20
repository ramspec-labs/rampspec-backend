import { describe, expect, it } from "vitest";

import type { AuthorizationActor } from "../auth/authorization.js";
import {
  InMemorySchedulerLeaseStore,
  ScheduleService,
  type RenewSchedulerLeaseInput,
  type SchedulerLease,
  type SchedulerLeaseEvent,
} from "./service.js";

const organizationId = "organization_a";
const otherOrganizationId = "organization_b";

function userActor(
  role: "maintainer" | "runner" | "viewer",
): AuthorizationActor {
  return { amr: ["pwd"], kind: "user", role, userId: "user_scheduler" };
}

function serviceActor(scopes: readonly string[]): AuthorizationActor {
  return {
    kind: "service_account",
    scopes: new Set(scopes),
    serviceAccountId: "service_account_scheduler",
  };
}

function realSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function createHarness() {
  let now = new Date("2026-09-12T18:00:00.000Z").getTime();
  let tokens = 0;
  const events: SchedulerLeaseEvent[] = [];
  const service = new ScheduleService({
    clock: () => new Date(now),
    onLeaseEvent: (event) => {
      events.push(event);
    },
    tokenFactory: () => `token-${(tokens += 1)}`,
  });
  service.create("nightly_run", 3600);
  return {
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    events,
    now: () => new Date(now),
    service,
  };
}

function createLiveHarness() {
  let tokens = 0;
  const events: SchedulerLeaseEvent[] = [];
  const service = new ScheduleService({
    onLeaseEvent: (event) => {
      events.push(event);
    },
    tokenFactory: () => `token-${(tokens += 1)}`,
  });
  service.create("nightly_run", 3600);
  return { events, service };
}

async function acquireLease(
  service: ScheduleService,
  overrides: Partial<{
    readonly actor: AuthorizationActor;
    readonly leaseTtlSeconds: number;
    readonly organizationId: string;
    readonly ownerId: string;
  }> = {},
): Promise<SchedulerLease> {
  const result = await service.acquireLease({
    actor: userActor("runner"),
    leaseTtlSeconds: 300,
    organizationId,
    ownerId: "scheduler-a",
    scheduleId: "nightly_run",
    ...overrides,
  });
  if (!result.acquired) {
    throw new Error(`Expected acquisition, got ${result.reason}.`);
  }
  return result.lease;
}

function renewInput(
  lease: SchedulerLease,
  overrides: Partial<RenewSchedulerLeaseInput> = {},
): RenewSchedulerLeaseInput {
  return {
    actor: userActor("runner"),
    leaseTtlSeconds: 300,
    organizationId,
    ownerId: lease.ownerId,
    scheduleId: lease.scheduleId,
    token: lease.token,
    ...overrides,
  };
}

describe("recurring schedules", () => {
  it("creates deterministic enabled schedules and disables them", () => {
    const service = new ScheduleService({
      clock: () => new Date("2026-09-12T18:00:00.000Z"),
    });
    const schedule = service.create("nightly_run", 3600);
    expect(schedule.nextRunAt).toBe("2026-09-12T19:00:00.000Z");
    expect(service.disable(schedule.id).enabled).toBe(false);
  });
  it("rejects unsafe intervals", () => {
    const service = new ScheduleService();
    expect(() => service.create("x", 60)).toThrow("schedule");
    expect(() => service.create("valid_schedule", 30)).toThrow("schedule");
  });
});

describe("scheduler leases", () => {
  it("acquires a lease with a token, version 1, and a TTL expiry", async () => {
    const { events, service } = createHarness();
    const lease = await acquireLease(service);
    expect(lease.token).toBe("token-1");
    expect(lease.version).toBe(1);
    expect(lease.renewalCount).toBe(0);
    expect(lease.acquiredAt).toBe("2026-09-12T18:00:00.000Z");
    expect(lease.expiresAt).toBe("2026-09-12T18:05:00.000Z");
    expect(lease.renewedAt).toBeUndefined();
    expect(events.map((event) => event.type)).toEqual(["lease.acquired"]);
  });

  it("refuses a second acquisition while the schedule is leased", async () => {
    const { service } = createHarness();
    await acquireLease(service);
    const sameOwner = await service.acquireLease({
      actor: userActor("runner"),
      leaseTtlSeconds: 300,
      organizationId,
      ownerId: "scheduler-a",
      scheduleId: "nightly_run",
    });
    expect(sameOwner).toEqual({
      acquired: false,
      expiresAt: "2026-09-12T18:05:00.000Z",
      ownerId: "scheduler-a",
      reason: "already_leased",
    });
    const otherOwner = await service.acquireLease({
      actor: userActor("runner"),
      leaseTtlSeconds: 300,
      organizationId,
      ownerId: "scheduler-b",
      scheduleId: "nightly_run",
    });
    expect(otherOwner.acquired).toBe(false);
    if (!otherOwner.acquired) {
      expect(otherOwner.reason).toBe("already_leased");
      expect(otherOwner.ownerId).toBe("scheduler-a");
    }
  });

  it("allows takeover exactly when the previous lease expires", async () => {
    const { advance, service } = createHarness();
    await acquireLease(service);
    advance(300_000);
    const takeover = await service.acquireLease({
      actor: userActor("runner"),
      leaseTtlSeconds: 300,
      organizationId,
      ownerId: "scheduler-b",
      scheduleId: "nightly_run",
    });
    expect(takeover.acquired).toBe(true);
  });

  it("rejects acquisition for unknown or disabled schedules and invalid inputs", async () => {
    const { service } = createHarness();
    await expect(
      service.acquireLease({
        actor: userActor("runner"),
        leaseTtlSeconds: 300,
        organizationId,
        ownerId: "scheduler-a",
        scheduleId: "missing_schedule",
      }),
    ).rejects.toThrow("Schedule not found.");
    service.disable("nightly_run");
    await expect(
      service.acquireLease({
        actor: userActor("runner"),
        leaseTtlSeconds: 300,
        organizationId,
        ownerId: "scheduler-a",
        scheduleId: "nightly_run",
      }),
    ).rejects.toThrow("Schedule is disabled.");
  });

  it("rejects lease TTLs outside the bounded range", async () => {
    const { service } = createHarness();
    for (const leaseTtlSeconds of [0, 29, 3601, 30.5]) {
      await expect(
        service.acquireLease({
          actor: userActor("runner"),
          leaseTtlSeconds,
          organizationId,
          ownerId: "scheduler-a",
          scheduleId: "nightly_run",
        }),
      ).rejects.toThrow("Invalid lease TTL.");
    }
    await expect(
      service.acquireLease({
        actor: userActor("runner"),
        leaseTtlSeconds: 300,
        organizationId,
        ownerId: "  ",
        scheduleId: "nightly_run",
      }),
    ).rejects.toThrow("Invalid lease owner.");
  });

  it("renews with compare-and-set: version, expiry, and renewal count advance", async () => {
    const { advance, events, service } = createHarness();
    const lease = await acquireLease(service);
    advance(60_000);
    const renewed = await service.renewLease(renewInput(lease));
    expect(renewed.renewed).toBe(true);
    if (!renewed.renewed) throw new Error("Expected renewal to succeed.");
    expect(renewed.lease.version).toBe(2);
    expect(renewed.lease.renewalCount).toBe(1);
    expect(renewed.lease.token).toBe("token-1");
    expect(renewed.lease.acquiredAt).toBe("2026-09-12T18:00:00.000Z");
    expect(renewed.lease.renewedAt).toBe("2026-09-12T18:01:00.000Z");
    expect(renewed.lease.expiresAt).toBe("2026-09-12T18:06:00.000Z");
    expect(events.map((event) => event.type)).toEqual([
      "lease.acquired",
      "lease.renewed",
    ]);
  });

  it("rejects renewal with a stale token and leaves the lease untouched", async () => {
    const { advance, service } = createHarness();
    const lease = await acquireLease(service);
    advance(300_000);
    const retaken = await acquireLease(service);
    expect(retaken.token).toBe("token-2");
    const stale = await service.renewLease(renewInput(lease));
    expect(stale).toEqual({ reason: "stale_token", renewed: false });
    const current = await service.renewLease(renewInput(retaken));
    expect(current.renewed).toBe(true);
    if (!current.renewed) throw new Error("Expected renewal to succeed.");
    expect(current.lease.version).toBe(2);
  });

  it("rejects renewal after ownership transfer and leaves the new lease intact", async () => {
    const { advance, service } = createHarness();
    const lease = await acquireLease(service);
    advance(300_000);
    const takeover = await acquireLease(service, { ownerId: "scheduler-b" });
    expect(takeover.ownerId).toBe("scheduler-b");
    const lost = await service.renewLease(renewInput(lease));
    expect(lost).toEqual({ reason: "ownership_changed", renewed: false });
    const kept = await service.renewLease(renewInput(takeover));
    expect(kept.renewed).toBe(true);
  });

  it("rejects renewal of an expired lease", async () => {
    const { advance, events, service } = createHarness();
    const lease = await acquireLease(service);
    advance(300_001);
    const renewed = await service.renewLease(renewInput(lease));
    expect(renewed).toEqual({ reason: "expired", renewed: false });
    expect(events.map((event) => event.type)).toContain("lease.expired");
  });

  it("renews one millisecond before expiry and fails exactly at expiry", async () => {
    const { advance, service } = createHarness();
    const lease = await acquireLease(service);
    advance(299_999);
    const edge = await service.renewLease(renewInput(lease));
    expect(edge.renewed).toBe(true);
    if (!edge.renewed) throw new Error("Expected renewal to succeed.");
    advance(300_000);
    const expired = await service.renewLease(renewInput(edge.lease));
    expect(expired).toEqual({ reason: "expired", renewed: false });
  });

  it("reports renewal of an unknown schedule as not found", async () => {
    const { service } = createHarness();
    const renewed = await service.renewLease({
      actor: userActor("runner"),
      leaseTtlSeconds: 300,
      organizationId,
      ownerId: "scheduler-a",
      scheduleId: "missing_schedule",
      token: "token-1",
    });
    expect(renewed).toEqual({ reason: "not_found", renewed: false });
  });

  it("allows exactly one of two concurrent renewals with the same token", async () => {
    const { service } = createHarness();
    const lease = await acquireLease(service);
    const results = await Promise.all([
      service.renewLease(renewInput(lease)),
      service.renewLease(renewInput(lease)),
    ]);
    const successes = results.filter((result) => result.renewed);
    expect(successes).toHaveLength(1);
    const winner = successes[0];
    if (winner === undefined) throw new Error("Expected one renewal to win.");
    expect(winner.lease.version).toBe(2);
    expect(winner.lease.renewalCount).toBe(1);
    const loser = results.find((result) => !result.renewed);
    expect(loser).toEqual({ reason: "stale_token", renewed: false });
    const next = await service.renewLease(renewInput(winner.lease));
    expect(next.renewed).toBe(true);
    if (!next.renewed) throw new Error("Expected renewal to succeed.");
    expect(next.lease.version).toBe(3);
  });

  it("allows exactly one of two concurrent acquisitions", async () => {
    const { service } = createHarness();
    const results = await Promise.all([
      service.acquireLease({
        actor: userActor("runner"),
        leaseTtlSeconds: 300,
        organizationId,
        ownerId: "scheduler-a",
        scheduleId: "nightly_run",
      }),
      service.acquireLease({
        actor: userActor("runner"),
        leaseTtlSeconds: 300,
        organizationId,
        ownerId: "scheduler-b",
        scheduleId: "nightly_run",
      }),
    ]);
    expect(results.filter((result) => result.acquired)).toHaveLength(1);
    expect(results.filter((result) => !result.acquired)).toHaveLength(1);
  });

  it("releases with the current token and allows immediate re-acquisition", async () => {
    const { events, service } = createHarness();
    const lease = await acquireLease(service);
    const released = await service.releaseLease({
      actor: userActor("runner"),
      organizationId,
      ownerId: lease.ownerId,
      scheduleId: lease.scheduleId,
      token: lease.token,
    });
    expect(released).toEqual({ released: true });
    expect(events.map((event) => event.type)).toContain("lease.released");
    const reacquired = await acquireLease(service, { ownerId: "scheduler-b" });
    expect(reacquired.ownerId).toBe("scheduler-b");
    expect(reacquired.token).toBe("token-2");
  });

  it("rejects release with a stale token and leaves the lease held", async () => {
    const { advance, service } = createHarness();
    const lease = await acquireLease(service);
    advance(300_000);
    const retaken = await acquireLease(service);
    expect(retaken.token).toBe("token-2");
    const stale = await service.releaseLease({
      actor: userActor("runner"),
      organizationId,
      ownerId: lease.ownerId,
      scheduleId: lease.scheduleId,
      token: lease.token,
    });
    expect(stale).toEqual({ reason: "stale_token", released: false });
    const kept = await service.renewLease(renewInput(retaken));
    expect(kept.renewed).toBe(true);
  });

  it("rejects release after ownership transfer", async () => {
    const { advance, service } = createHarness();
    const lease = await acquireLease(service);
    advance(300_000);
    const takeover = await acquireLease(service, { ownerId: "scheduler-b" });
    const released = await service.releaseLease({
      actor: userActor("runner"),
      organizationId,
      ownerId: lease.ownerId,
      scheduleId: lease.scheduleId,
      token: lease.token,
    });
    expect(released).toEqual({
      reason: "ownership_changed",
      released: false,
    });
    const kept = await service.renewLease(renewInput(takeover));
    expect(kept.renewed).toBe(true);
  });

  it("lets a held lease renew after the schedule is disabled, but blocks new acquisition", async () => {
    const { service } = createHarness();
    const lease = await acquireLease(service);
    service.disable("nightly_run");
    const renewed = await service.renewLease(renewInput(lease));
    expect(renewed.renewed).toBe(true);
  });

  it("denies cross-tenant renewal and release without touching the lease", async () => {
    const { service } = createHarness();
    const lease = await acquireLease(service);
    await expect(
      service.renewLease(
        renewInput(lease, { organizationId: otherOrganizationId }),
      ),
    ).rejects.toThrow("not authorized");
    await expect(
      service.releaseLease({
        actor: userActor("runner"),
        organizationId: otherOrganizationId,
        ownerId: lease.ownerId,
        scheduleId: lease.scheduleId,
        token: lease.token,
      }),
    ).rejects.toThrow("not authorized");
    const kept = await service.renewLease(renewInput(lease));
    expect(kept.renewed).toBe(true);
  });

  it("authorizes lease operations by role and service-account scope", async () => {
    const { service } = createHarness();
    await expect(
      service.acquireLease({
        actor: userActor("viewer"),
        leaseTtlSeconds: 300,
        organizationId,
        ownerId: "scheduler-a",
        scheduleId: "nightly_run",
      }),
    ).rejects.toThrow("not authorized");
    await expect(
      service.acquireLease({
        actor: serviceActor([]),
        leaseTtlSeconds: 300,
        organizationId,
        ownerId: "scheduler-a",
        scheduleId: "nightly_run",
      }),
    ).rejects.toThrow("not authorized");
    const scoped = await service.acquireLease({
      actor: serviceActor(["schedule:lease"]),
      leaseTtlSeconds: 300,
      organizationId,
      ownerId: "scheduler-a",
      scheduleId: "nightly_run",
    });
    expect(scoped.acquired).toBe(true);
    const maintained = await service.acquireLease({
      actor: userActor("maintainer"),
      leaseTtlSeconds: 300,
      organizationId,
      ownerId: "scheduler-b",
      scheduleId: "nightly_run",
    });
    expect(maintained.acquired).toBe(false);
  });
});

describe("leased jobs", () => {
  it("completes a job, renews while running, and releases the lease", async () => {
    const { events, service } = createLiveHarness();
    const outcome = await service.runLeasedJob({
      actor: userActor("runner"),
      job: async () => {
        await realSleep(120);
        return "done";
      },
      leaseTtlSeconds: 30,
      organizationId,
      ownerId: "scheduler-a",
      renewalIntervalMs: 50,
      scheduleId: "nightly_run",
    });
    expect(outcome.completed).toBe(true);
    if (!outcome.completed) throw new Error("Expected the job to complete.");
    expect(outcome.result).toBe("done");
    expect(outcome.renewals).toBeGreaterThanOrEqual(1);
    expect(outcome.lease.version).toBe(outcome.renewals + 1);
    const types = events.map((event) => event.type);
    expect(types).toContain("lease.acquired");
    expect(types).toContain("lease.renewed");
    expect(types).toContain("job.completed");
    expect(types).toContain("lease.released");
    const reacquired = await acquireLease(service, { ownerId: "scheduler-b" });
    expect(reacquired.ownerId).toBe("scheduler-b");
  });

  it("aborts the job when the lease is released mid-run and emits no completion", async () => {
    const { events, service } = createLiveHarness();
    let jobSawAbort = false;
    const outcomePromise = service.runLeasedJob({
      actor: userActor("runner"),
      job: async (signal) => {
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            jobSawAbort = true;
            resolve();
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              jobSawAbort = true;
              resolve();
            },
            { once: true },
          );
          setTimeout(resolve, 5000);
        });
        return signal.aborted ? "aborted" : "finished";
      },
      leaseTtlSeconds: 30,
      organizationId,
      ownerId: "scheduler-a",
      renewalIntervalMs: 50,
      scheduleId: "nightly_run",
    });
    await realSleep(120);
    const released = await service.releaseLease({
      actor: userActor("runner"),
      organizationId,
      ownerId: "scheduler-a",
      scheduleId: "nightly_run",
      token: "token-1",
    });
    expect(released).toEqual({ released: true });
    const outcome = await outcomePromise;
    expect(outcome.completed).toBe(false);
    if (outcome.completed) throw new Error("Expected the job to abort.");
    expect(outcome.reason).toBe("lease_lost");
    expect(jobSawAbort).toBe(true);
    const types = events.map((event) => event.type);
    expect(types).toContain("job.aborted");
    expect(types).not.toContain("job.completed");
  });

  it("suppresses completion when ownership is lost just before the job finishes", async () => {
    const { events, service } = createLiveHarness();
    const outcome = await service.runLeasedJob({
      actor: userActor("runner"),
      job: async () => {
        await realSleep(60);
        await service.releaseLease({
          actor: userActor("runner"),
          organizationId,
          ownerId: "scheduler-a",
          scheduleId: "nightly_run",
          token: "token-1",
        });
        return "done";
      },
      leaseTtlSeconds: 30,
      organizationId,
      ownerId: "scheduler-a",
      renewalIntervalMs: 50,
      scheduleId: "nightly_run",
    });
    expect(outcome.completed).toBe(false);
    if (outcome.completed) throw new Error("Expected no completion.");
    expect(outcome.reason).toBe("lease_lost");
    const types = events.map((event) => event.type);
    expect(types).toContain("job.aborted");
    expect(types).not.toContain("job.completed");
  });

  it("aborts when the renewal budget is exhausted", async () => {
    const { events, service } = createLiveHarness();
    let jobSawAbort = false;
    const outcome = await service.runLeasedJob({
      actor: userActor("runner"),
      job: async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            jobSawAbort = true;
            resolve();
          });
          setTimeout(resolve, 5000);
        });
        return "done";
      },
      leaseTtlSeconds: 30,
      maxRenewals: 0,
      organizationId,
      ownerId: "scheduler-a",
      renewalIntervalMs: 50,
      scheduleId: "nightly_run",
    });
    expect(outcome.completed).toBe(false);
    if (outcome.completed) throw new Error("Expected the job to abort.");
    expect(outcome.reason).toBe("max_renewals");
    expect(outcome.renewals).toBe(0);
    expect(jobSawAbort).toBe(true);
    expect(events.map((event) => event.type)).not.toContain("job.completed");
  });

  it("aborts when the maximum job duration is reached", async () => {
    const { service } = createLiveHarness();
    let jobSawAbort = false;
    const outcome = await service.runLeasedJob({
      actor: userActor("runner"),
      job: async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            jobSawAbort = true;
            resolve();
          });
          setTimeout(resolve, 5000);
        });
        return "done";
      },
      leaseTtlSeconds: 30,
      maxDurationMs: 120,
      organizationId,
      ownerId: "scheduler-a",
      renewalIntervalMs: 50,
      scheduleId: "nightly_run",
    });
    expect(outcome.completed).toBe(false);
    if (outcome.completed) throw new Error("Expected the job to abort.");
    expect(outcome.reason).toBe("max_duration");
    expect(jobSawAbort).toBe(true);
  });

  it("reports job failure without a completion event and releases the lease", async () => {
    const { events, service } = createLiveHarness();
    const outcome = await service.runLeasedJob({
      actor: userActor("runner"),
      job: async () => {
        await realSleep(20);
        throw new Error("boom");
      },
      leaseTtlSeconds: 30,
      organizationId,
      ownerId: "scheduler-a",
      renewalIntervalMs: 50,
      scheduleId: "nightly_run",
    });
    expect(outcome.completed).toBe(false);
    if (outcome.completed) throw new Error("Expected the job to fail.");
    expect(outcome.reason).toBe("job_failed");
    expect(outcome.error).toBeInstanceOf(Error);
    if (outcome.error instanceof Error) {
      expect(outcome.error.message).toBe("boom");
    }
    expect(events.map((event) => event.type)).not.toContain("job.completed");
    const reacquired = await acquireLease(service, { ownerId: "scheduler-b" });
    expect(reacquired.ownerId).toBe("scheduler-b");
  });

  it("rejects a renewal interval that is not shorter than the lease TTL", async () => {
    const { service } = createLiveHarness();
    await expect(
      service.runLeasedJob({
        actor: userActor("runner"),
        job: () => Promise.resolve("done"),
        leaseTtlSeconds: 30,
        organizationId,
        ownerId: "scheduler-a",
        renewalIntervalMs: 30_000,
        scheduleId: "nightly_run",
      }),
    ).rejects.toThrow("shorter than the lease TTL");
  });

  it("reports an already-leased schedule instead of running a second job", async () => {
    const { service } = createLiveHarness();
    await acquireLease(service);
    const outcome = await service.runLeasedJob({
      actor: userActor("runner"),
      job: () => Promise.resolve("done"),
      leaseTtlSeconds: 30,
      organizationId,
      ownerId: "scheduler-b",
      renewalIntervalMs: 50,
      scheduleId: "nightly_run",
    });
    expect(outcome).toEqual({
      completed: false,
      reason: "already_leased",
      renewals: 0,
    });
  });
});

describe("in-memory lease store", () => {
  function leaseFixture(expiresAt: string): SchedulerLease {
    return {
      acquiredAt: "2026-09-12T18:00:00.000Z",
      expiresAt,
      organizationId,
      ownerId: "scheduler-a",
      renewalCount: 0,
      scheduleId: "nightly_run",
      token: "token-1",
      version: 1,
    };
  }

  it("refuses a live lease on insert and replaces an expired one", async () => {
    let now = new Date("2026-09-12T18:00:00.000Z").getTime();
    const store = new InMemorySchedulerLeaseStore({
      clock: () => new Date(now),
    });
    const lease = leaseFixture("2026-09-12T18:05:00.000Z");
    await expect(store.insert(lease)).resolves.toBe(true);
    await expect(store.insert(lease)).resolves.toBe(false);
    now = new Date("2026-09-12T18:05:00.000Z").getTime();
    await expect(store.insert({ ...lease, token: "token-2" })).resolves.toBe(
      true,
    );
    await expect(store.find("nightly_run")).resolves.toMatchObject({
      token: "token-2",
    });
  });

  it("requires owner, token, and version to match and refuses expired leases on compare-and-swap", async () => {
    let now = new Date("2026-09-12T18:00:00.000Z").getTime();
    const store = new InMemorySchedulerLeaseStore({
      clock: () => new Date(now),
    });
    const lease = leaseFixture("2026-09-12T18:05:00.000Z");
    await store.insert(lease);
    const next: SchedulerLease = {
      ...lease,
      expiresAt: "2026-09-12T18:10:00.000Z",
      renewalCount: 1,
      renewedAt: "2026-09-12T18:01:00.000Z",
      version: 2,
    };
    const owner = {
      ownerId: "scheduler-a",
      scheduleId: "nightly_run",
      token: "token-1",
      version: 1,
    };
    await expect(
      store.compareAndSwap({ ...owner, version: 2 }, next),
    ).resolves.toBe(false);
    await expect(
      store.compareAndSwap({ ...owner, token: "token-9" }, next),
    ).resolves.toBe(false);
    await expect(
      store.compareAndSwap({ ...owner, ownerId: "scheduler-b" }, next),
    ).resolves.toBe(false);
    await expect(store.compareAndSwap(owner, next)).resolves.toBe(true);
    await expect(store.compareAndSwap(owner, next)).resolves.toBe(false);
    now = new Date("2026-09-12T18:10:00.000Z").getTime();
    await expect(
      store.compareAndSwap({ ...owner, version: 2 }, { ...next, version: 3 }),
    ).resolves.toBe(false);
  });

  it("requires owner, token, and version to match on compare-and-delete", async () => {
    const store = new InMemorySchedulerLeaseStore({
      clock: () => new Date("2026-09-12T18:00:00.000Z"),
    });
    const lease = leaseFixture("2026-09-12T18:05:00.000Z");
    await store.insert(lease);
    const owner = {
      ownerId: "scheduler-a",
      scheduleId: "nightly_run",
      token: "token-1",
      version: 1,
    };
    await expect(
      store.compareAndDelete({ ...owner, token: "token-9" }),
    ).resolves.toBe(false);
    await expect(store.compareAndDelete(owner)).resolves.toBe(true);
    await expect(store.find("nightly_run")).resolves.toBeUndefined();
  });
});
