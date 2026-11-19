import { describe, expect, it } from "vitest";

import { authorize } from "../auth/authorization.js";
import {
  AuditService,
  InMemoryAuditStore,
  verifyMetadataHash,
} from "../audit/service.js";
import { InMemoryRunRepository, RunService } from "../runs/service.js";
import {
  countMissedOccurrences,
  resolveMisfire,
} from "./recurrence.js";
import {
  deriveOccurrenceKey,
  ScheduleService,
  ScheduledRunTrigger,
} from "./service.js";

const clock = () => new Date("2026-09-12T18:00:00.000Z");

function request(role: "auditor" | "maintainer" | "owner" | "viewer", action: "schedule.read" | "schedule.write") {
  return {
    action,
    actor: {
      amr: ["pwd", "mfa"],
      kind: "user" as const,
      role,
      userId: "user_actor",
    },
    organizationId: "organization_a",
    resourceOrganizationId: "organization_a",
  };
}

const organizationId = "organization_00000000-0000-4000-8000-000000000001";
const otherOrganizationId = "organization_00000000-0000-4000-8000-000000000099";
const projectId = "project_00000000-0000-4000-8000-000000000002";
const targetId = "target_00000000-0000-4000-8000-000000000003";
const suiteId = "suite_00000000-0000-4000-8000-000000000004";
const runInput = {
  effectiveConfig: { network: "testnet" },
  organizationId,
  projectId,
  suiteId,
  suiteVersion: "1.0.0",
  targetId,
};

function fixedClock(): () => Date {
  return () => new Date("2026-09-12T18:00:00.000Z");
}

function triggerSetup() {
  const schedules = new ScheduleService({ clock: fixedClock() });
  const runs = new RunService({ repository: new InMemoryRunRepository() });
  const trigger = new ScheduledRunTrigger({ runs, schedules });
  schedules.create("nightly_run", 3600);
  return { runs, schedules, trigger };
}

describe("recurring schedules", () => { it("creates deterministic enabled schedules and disables them", () => { const service = new ScheduleService({ clock: () => new Date("2026-09-12T18:00:00.000Z") }); const schedule = service.create("nightly_run", 3600); expect(schedule.nextRunAt).toBe("2026-09-12T19:00:00.000Z"); expect(service.disable(schedule.id).enabled).toBe(false); }); it("rejects unsafe intervals", () => { const service = new ScheduleService(); expect(() => service.create("x", 60)).toThrow("schedule"); expect(() => service.create("valid_schedule", 30)).toThrow("schedule"); }); });

describe("misfire policy configuration", () => {
  it("defaults to skip with the maximum bounded catch-up limit", () => {
    const service = new ScheduleService({ clock });
    const schedule = service.create("nightly_run", 3600);
    expect(schedule.misfirePolicy).toBe("skip");
    expect(schedule.maxCatchUp).toBe(10);
    expect(schedule.lastMisfire).toBeNull();
  });

  it("stores an explicit catch-up policy and custom limit", () => {
    const service = new ScheduleService({ clock });
    const schedule = service.create("hourly_sync", 3600, {
      maxCatchUp: 3,
      misfirePolicy: "catch-up",
    });
    expect(schedule.misfirePolicy).toBe("catch-up");
    expect(schedule.maxCatchUp).toBe(3);
  });

  it("accepts the boundary catch-up limits 1 and 10", () => {
    const service = new ScheduleService({ clock });
    expect(
      service.create("limit_one", 3600, { maxCatchUp: 1 }).maxCatchUp,
    ).toBe(1);
    expect(
      service.create("limit_ten", 3600, { maxCatchUp: 10 }).maxCatchUp,
    ).toBe(10);
  });

  it("rejects an unknown misfire policy", () => {
    const service = new ScheduleService({ clock });
    expect(() =>
      service.create("bad_policy", 3600, {
        misfirePolicy: "replay-all" as unknown as "skip",
      }),
    ).toThrow("misfire policy");
  });

  it("rejects catch-up limits outside 1..10", () => {
    const service = new ScheduleService({ clock });
    expect(() =>
      service.create("limit_zero", 3600, { maxCatchUp: 0 }),
    ).toThrow("catch-up");
    expect(() =>
      service.create("limit_eleven", 3600, { maxCatchUp: 11 }),
    ).toThrow("catch-up");
  });
});

describe("misfire recovery", () => {
  it("skips missed runs and resumes at the next occurrence", () => {
    const service = new ScheduleService({ clock });
    service.create("nightly_run", 3600, { misfirePolicy: "skip" });
    const recovery = service.recover(
      "nightly_run",
      new Date("2026-09-12T22:00:00.000Z"),
    );
    expect(recovery.missedOccurrences).toBe(4);
    expect(recovery.executionsDue).toBe(0);
    expect(recovery.capped).toBe(false);
    expect(recovery.nextRunAt).toBe("2026-09-12T23:00:00.000Z");
    expect(service.get("nightly_run").nextRunAt).toBe(
      "2026-09-12T23:00:00.000Z",
    );
  });

  it("runs once for any number of missed occurrences", () => {
    const service = new ScheduleService({ clock });
    service.create("nightly_run", 3600, { misfirePolicy: "run-once" });
    const recovery = service.recover(
      "nightly_run",
      new Date("2026-09-12T22:00:00.000Z"),
    );
    expect(recovery.missedOccurrences).toBe(4);
    expect(recovery.executionsDue).toBe(1);
    expect(recovery.nextRunAt).toBe("2026-09-12T23:00:00.000Z");
  });

  it("catches up every missed occurrence within the limit", () => {
    const service = new ScheduleService({ clock });
    service.create("nightly_run", 3600, { misfirePolicy: "catch-up" });
    const recovery = service.recover(
      "nightly_run",
      new Date("2026-09-12T22:00:00.000Z"),
    );
    expect(recovery.missedOccurrences).toBe(4);
    expect(recovery.executionsDue).toBe(4);
    expect(recovery.capped).toBe(false);
  });

  it("bounds catch-up at the limit and flags the cap", () => {
    const service = new ScheduleService({ clock });
    service.create("nightly_run", 3600, { misfirePolicy: "catch-up" });
    const recovery = service.recover(
      "nightly_run",
      new Date("2026-09-13T19:00:00.000Z"),
    );
    expect(recovery.missedOccurrences).toBe(25);
    expect(recovery.executionsDue).toBe(10);
    expect(recovery.capped).toBe(true);
    expect(recovery.nextRunAt).toBe("2026-09-13T20:00:00.000Z");
  });

  it("respects a custom catch-up limit below the maximum", () => {
    const service = new ScheduleService({ clock });
    service.create("nightly_run", 3600, {
      maxCatchUp: 2,
      misfirePolicy: "catch-up",
    });
    const recovery = service.recover(
      "nightly_run",
      new Date("2026-09-12T22:00:00.000Z"),
    );
    expect(recovery.missedOccurrences).toBe(4);
    expect(recovery.executionsDue).toBe(2);
    expect(recovery.capped).toBe(true);
  });

  it("counts an occurrence exactly at the recovery instant as missed", () => {
    const service = new ScheduleService({ clock });
    service.create("nightly_run", 3600, { misfirePolicy: "catch-up" });
    const recovery = service.recover(
      "nightly_run",
      new Date("2026-09-12T21:00:00.000Z"),
    );
    expect(recovery.missedOccurrences).toBe(3);
    expect(recovery.nextRunAt).toBe("2026-09-12T22:00:00.000Z");
  });

  it("does not count an occurrence one millisecond in the future", () => {
    const service = new ScheduleService({ clock });
    service.create("nightly_run", 3600, { misfirePolicy: "catch-up" });
    const recovery = service.recover(
      "nightly_run",
      new Date("2026-09-12T20:59:59.999Z"),
    );
    expect(recovery.missedOccurrences).toBe(2);
    expect(recovery.nextRunAt).toBe("2026-09-12T21:00:00.000Z");
  });

  it("reports zero missed occurrences before the first due run", () => {
    const service = new ScheduleService({ clock });
    service.create("nightly_run", 3600, { misfirePolicy: "catch-up" });
    const recovery = service.recover(
      "nightly_run",
      new Date("2026-09-12T18:30:00.000Z"),
    );
    expect(recovery.missedOccurrences).toBe(0);
    expect(recovery.executionsDue).toBe(0);
    expect(recovery.nextRunAt).toBe("2026-09-12T19:00:00.000Z");
  });

  it("is a no-op when recovery repeats at the same instant", () => {
    const service = new ScheduleService({ clock });
    service.create("nightly_run", 3600, { misfirePolicy: "catch-up" });
    const now = new Date("2026-09-12T22:00:00.000Z");
    const first = service.recover("nightly_run", now);
    expect(first.missedOccurrences).toBe(4);
    const second = service.recover("nightly_run", now);
    expect(second.missedOccurrences).toBe(0);
    expect(second.executionsDue).toBe(0);
    expect(second.nextRunAt).toBe("2026-09-12T23:00:00.000Z");
  });

  it("records the recovery on the schedule for operators", () => {
    const service = new ScheduleService({ clock });
    service.create("nightly_run", 3600, { misfirePolicy: "run-once" });
    service.recover("nightly_run", new Date("2026-09-12T22:00:00.000Z"));
    const schedule = service.get("nightly_run");
    expect(schedule.lastMisfire?.policy).toBe("run-once");
    expect(schedule.lastMisfire?.missedOccurrences).toBe(4);
    expect(schedule.lastMisfire?.executionsDue).toBe(1);
    expect(schedule.lastMisfire?.recoveredAt).toBe(
      "2026-09-12T22:00:00.000Z",
    );
  });

  it("rejects recovery for an unknown schedule", () => {
    const service = new ScheduleService({ clock });
    expect(() =>
      service.recover("missing_schedule", new Date("2026-09-12T22:00:00.000Z")),
    ).toThrow("Schedule not found.");
  });

  it("rejects recovery for a disabled schedule", () => {
    const service = new ScheduleService({ clock });
    service.create("nightly_run", 3600, { misfirePolicy: "catch-up" });
    service.disable("nightly_run");
    expect(() =>
      service.recover("nightly_run", new Date("2026-09-12T22:00:00.000Z")),
    ).toThrow("Schedule is disabled.");
  });
});

describe("misfire recurrence helpers", () => {
  it("counts occurrences from the first due time through now", () => {
    expect(
      countMissedOccurrences(
        new Date("2026-09-12T19:00:00.000Z"),
        new Date("2026-09-12T22:00:00.000Z"),
        3600,
      ),
    ).toBe(4);
    expect(
      countMissedOccurrences(
        new Date("2026-09-12T19:00:00.000Z"),
        new Date("2026-09-12T18:59:59.999Z"),
        3600,
      ),
    ).toBe(0);
  });

  it("rejects invalid recurrence intervals", () => {
    expect(() =>
      countMissedOccurrences(
        new Date("2026-09-12T19:00:00.000Z"),
        new Date("2026-09-12T22:00:00.000Z"),
        30,
      ),
    ).toThrow("recurrence");
  });

  it("rejects an unknown policy in resolveMisfire", () => {
    expect(() =>
      resolveMisfire({
        firstDueAt: new Date("2026-09-12T19:00:00.000Z"),
        intervalSeconds: 3600,
        now: new Date("2026-09-12T22:00:00.000Z"),
        policy: "replay-all" as unknown as "skip",
      }),
    ).toThrow("misfire policy");
  });
});

describe("misfire authorization", () => {
  it("allows a maintainer to change scheduling policy", () => {
    expect(authorize(request("maintainer", "schedule.write"))).toEqual({
      granted: true,
    });
  });

  it("denies schedule writes to a viewer", () => {
    expect(() => authorize(request("viewer", "schedule.write"))).toThrow(
      "not authorized",
    );
  });

  it("denies schedule writes to an auditor", () => {
    expect(() => authorize(request("auditor", "schedule.write"))).toThrow(
      "not authorized",
    );
  });

  it("allows an auditor to read schedule state", () => {
    expect(authorize(request("auditor", "schedule.read"))).toEqual({
      granted: true,
    });
  });

  it("denies schedule reads across tenant boundaries", () => {
    expect(() =>
      authorize({
        ...request("owner", "schedule.read"),
        resourceOrganizationId: "organization_b",
      }),
    ).toThrow("not authorized");
  });

  it("requires the schedule scope for service accounts", () => {
    expect(
      authorize({
        action: "schedule.write",
        actor: {
          kind: "service_account",
          scopes: new Set(["schedule:write"]),
          serviceAccountId: "service_account_1",
        },
        organizationId: "organization_a",
        resourceOrganizationId: "organization_a",
      }),
    ).toEqual({ granted: true });
    expect(() =>
      authorize({
        action: "schedule.write",
        actor: {
          kind: "service_account",
          scopes: new Set(["run:create"]),
          serviceAccountId: "service_account_1",
        },
        organizationId: "organization_a",
        resourceOrganizationId: "organization_a",
      }),
    ).toThrow("not authorized");
  });
});

describe("misfire audit integration", () => {
  it("records the policy and missed count in audit metadata", async () => {
    const service = new ScheduleService({ clock });
    service.create("nightly_run", 3600, { misfirePolicy: "catch-up" });
    const recovery = service.recover(
      "nightly_run",
      new Date("2026-09-12T22:00:00.000Z"),
    );
    const audit = new AuditService(new InMemoryAuditStore());
    const event = await audit.record({
      action: "schedule.misfire.recovered",
      actorId: "system",
      actorType: "system",
      metadata: recovery.auditMetadata,
      now: new Date("2026-09-12T22:00:00.000Z"),
      organizationId: "organization_a",
      requestId: "request_1",
      targetId: "nightly_run",
      targetType: "schedule",
    });
    expect(event.metadata).toEqual({
      executions_due: 4,
      misfire_capped: false,
      misfire_policy: "catch-up",
      missed_occurrences: 4,
      schedule_id: "nightly_run",
    });
    expect(verifyMetadataHash(event)).toBe(true);
    expect(service.get("nightly_run").lastMisfire?.auditMetadata).toEqual(
      event.metadata,
    );
  });
});

describe("occurrence keys", () => {
  it("derives a stable key for one schedule occurrence", () => {
    expect(deriveOccurrenceKey("nightly_run", "2026-09-12T19:00:00.000Z")).toBe(
      "schedule:nightly_run:2026-09-12T19:00:00.000Z",
    );
  });

  it("normalizes equivalent timestamps to the same key", () => {
    const fromString = deriveOccurrenceKey(
      "nightly_run",
      "2026-09-12T19:00:00.000Z",
    );
    expect(
      deriveOccurrenceKey("nightly_run", new Date("2026-09-12T19:00:00.000Z")),
    ).toBe(fromString);
    expect(
      deriveOccurrenceKey("nightly_run", "2026-09-12T21:00:00.000+02:00"),
    ).toBe(fromString);
  });

  it("separates keys by schedule and by occurrence", () => {
    const key = deriveOccurrenceKey("nightly_run", "2026-09-12T19:00:00.000Z");
    expect(
      deriveOccurrenceKey("weekly_run", "2026-09-12T19:00:00.000Z"),
    ).not.toBe(key);
    expect(
      deriveOccurrenceKey("nightly_run", "2026-09-12T20:00:00.000Z"),
    ).not.toBe(key);
  });

  it("stays inside the idempotency-key bounds at both id lengths", () => {
    const shortKey = deriveOccurrenceKey("abc", "2026-09-12T19:00:00.000Z");
    const longKey = deriveOccurrenceKey(
      "a".repeat(64),
      "2026-09-12T19:00:00.000Z",
    );
    for (const key of [shortKey, longKey]) {
      expect(key.length).toBeGreaterThanOrEqual(16);
      expect(key.length).toBeLessThanOrEqual(128);
      expect(key).toMatch(/^[A-Za-z0-9._:-]+$/u);
    }
  });

  it("rejects invalid schedule ids and occurrences", () => {
    expect(() => deriveOccurrenceKey("x", "2026-09-12T19:00:00.000Z")).toThrow(
      "schedule",
    );
    expect(() =>
      deriveOccurrenceKey("nightly_run", "not-a-date"),
    ).toThrow("occurrence");
  });
});

describe("occurrence claims", () => {
  it("claims an occurrence once and reports the repeat claim", () => {
    const service = new ScheduleService({ clock: fixedClock() });
    service.create("nightly_run", 3600);
    const first = service.claimOccurrence("nightly_run");
    expect(first.claimed).toBe(true);
    expect(first.occurrenceAt).toBe("2026-09-12T19:00:00.000Z");
    expect(first.occurrenceKey).toBe(
      "schedule:nightly_run:2026-09-12T19:00:00.000Z",
    );
    const second = service.claimOccurrence("nightly_run");
    expect(second.claimed).toBe(false);
    expect(second.occurrenceKey).toBe(first.occurrenceKey);
  });

  it("rejects claims for unknown, disabled, or non-due occurrences", () => {
    const service = new ScheduleService({ clock: fixedClock() });
    service.create("nightly_run", 3600);
    expect(() => service.claimOccurrence("missing_run")).toThrow(
      "Schedule not found.",
    );
    expect(() =>
      service.claimOccurrence("nightly_run", "2026-09-12T20:00:00.000Z"),
    ).toThrow("Invalid occurrence.");
    service.disable("nightly_run");
    expect(() => service.claimOccurrence("nightly_run")).toThrow(
      "Schedule is disabled.",
    );
  });

  it("advances exactly one interval and ignores a retried advance", () => {
    const service = new ScheduleService({ clock: fixedClock() });
    const schedule = service.create("nightly_run", 3600);
    const advanced = service.advance(
      schedule.id,
      "2026-09-12T19:00:00.000Z",
    );
    expect(advanced.nextRunAt).toBe("2026-09-12T20:00:00.000Z");
    expect(
      service.advance(schedule.id, "2026-09-12T19:00:00.000Z").nextRunAt,
    ).toBe("2026-09-12T20:00:00.000Z");
    expect(() =>
      service.advance(schedule.id, "2026-09-12T21:00:00.000Z"),
    ).toThrow("Invalid occurrence.");
  });

  it("lists only due and enabled schedules", () => {
    const service = new ScheduleService({ clock: fixedClock() });
    service.create("nightly_run", 3600);
    const disabled = service.create("disabled_run", 3600);
    service.disable(disabled.id);
    expect(service.due()).toEqual([]);
    expect(
      service.due(new Date("2026-09-12T19:00:00.000Z")).map(
        (schedule) => schedule.id,
      ),
    ).toEqual(["nightly_run"]);
  });
});

describe("scheduled run triggers", () => {
  it("creates one run per occurrence and advances the schedule once", async () => {
    const { schedules, trigger } = triggerSetup();
    const first = await trigger.trigger("nightly_run", runInput);
    expect(first.created).toBe(true);
    expect(first.claimed).toBe(true);
    expect(first.run.idempotencyKey).toBe(
      "schedule:nightly_run:2026-09-12T19:00:00.000Z",
    );
    expect(first.run.state).toBe("requested");
    expect(first.occurrenceAt).toBe("2026-09-12T19:00:00.000Z");
    const next = await trigger.trigger("nightly_run", runInput);
    expect(next.created).toBe(true);
    expect(next.run.id).not.toBe(first.run.id);
    expect(next.occurrenceKey).toBe(
      "schedule:nightly_run:2026-09-12T20:00:00.000Z",
    );
    expect(
      schedules.claimOccurrence("nightly_run").occurrenceAt,
    ).toBe("2026-09-12T21:00:00.000Z");
  });

  it("returns the original run for concurrent duplicate triggers", async () => {
    const { schedules, trigger } = triggerSetup();
    const [first, second] = await Promise.all([
      trigger.trigger("nightly_run", runInput),
      trigger.trigger("nightly_run", runInput),
    ]);
    expect(first.run.id).toBe(second.run.id);
    expect(first.run).toEqual(second.run);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect([first.claimed, second.claimed].filter(Boolean)).toHaveLength(1);
    // The schedule advanced exactly one interval despite the duplicate.
    expect(
      schedules.claimOccurrence("nightly_run").occurrenceAt,
    ).toBe("2026-09-12T20:00:00.000Z");
  });

  it("keeps the same occurrence separate across organizations", async () => {
    const repository = new InMemoryRunRepository();
    const makeTrigger = () => {
      const schedules = new ScheduleService({ clock: fixedClock() });
      schedules.create("nightly_run", 3600);
      return new ScheduledRunTrigger({
        runs: new RunService({ repository }),
        schedules,
      });
    };
    const [first, other] = await Promise.all([
      makeTrigger().trigger("nightly_run", runInput),
      makeTrigger().trigger("nightly_run", {
        ...runInput,
        organizationId: otherOrganizationId,
      }),
    ]);
    expect(first.created).toBe(true);
    expect(other.created).toBe(true);
    expect(other.run.id).not.toBe(first.run.id);
    expect(other.run.idempotencyKey).toBe(first.run.idempotencyKey);
    expect(other.occurrenceKey).toBe(first.occurrenceKey);
  });

  it("recovers the original run when a replica fails over mid-occurrence", async () => {
    const repository = new InMemoryRunRepository();
    const primarySchedules = new ScheduleService({ clock: fixedClock() });
    const primaryRuns = new RunService({ repository });
    primarySchedules.create("nightly_run", 3600);
    // Primary claims the occurrence and creates the run, then crashes
    // before advancing the schedule.
    const claim = primarySchedules.claimOccurrence("nightly_run");
    const { created, run } = await primaryRuns.createClaim({
      ...runInput,
      idempotencyKey: claim.occurrenceKey,
    });
    expect(created).toBe(true);

    // Failover replica starts from the same due occurrence.
    const replicaSchedules = new ScheduleService({ clock: fixedClock() });
    const replicaRuns = new RunService({ repository });
    const replicaTrigger = new ScheduledRunTrigger({
      runs: replicaRuns,
      schedules: replicaSchedules,
    });
    replicaSchedules.create("nightly_run", 3600);
    const recovered = await replicaTrigger.trigger("nightly_run", runInput);
    expect(recovered.created).toBe(false);
    expect(recovered.run).toEqual(run);
    expect(
      replicaSchedules.claimOccurrence("nightly_run").occurrenceAt,
    ).toBe("2026-09-12T20:00:00.000Z");
  });

  it("creates one run when two failover replicas trigger concurrently", async () => {
    const repository = new InMemoryRunRepository();
    const makeReplica = () => {
      const schedules = new ScheduleService({ clock: fixedClock() });
      schedules.create("nightly_run", 3600);
      return new ScheduledRunTrigger({
        runs: new RunService({ repository }),
        schedules,
      });
    };
    const [first, second] = await Promise.all([
      makeReplica().trigger("nightly_run", runInput),
      makeReplica().trigger("nightly_run", runInput),
    ]);
    expect(first.run.id).toBe(second.run.id);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
  });
});
