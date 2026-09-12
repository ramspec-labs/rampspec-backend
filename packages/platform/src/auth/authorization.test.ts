import { describe, expect, it } from "vitest";

import {
  actions,
  authorize,
  roles,
  type Action,
  type Role,
} from "./authorization.js";

const expected: Readonly<Record<Role, readonly Action[]>> = {
  owner: actions,
  admin: actions.filter(
    (action) =>
      action !== "emergency.execute" && action !== "organization.delete",
  ),
  maintainer: [
    "evidence.read",
    "organization.read",
    "project.create",
    "project.read",
    "project.write",
    "report.read",
    "run.cancel",
    "run.create",
    "run.read",
    "run.retry",
    "suite.publish",
    "suite.read",
    "suite.write",
    "target.read",
    "target.verify",
    "target.write",
  ],
  runner: [
    "evidence.read",
    "project.read",
    "report.read",
    "run.create",
    "run.read",
    "runner.execute",
    "suite.read",
    "target.read",
  ],
  auditor: [
    "audit.read",
    "evidence.raw",
    "evidence.read",
    "organization.read",
    "project.read",
    "report.read",
    "run.read",
    "suite.read",
    "target.read",
  ],
  viewer: [
    "evidence.read",
    "organization.read",
    "project.read",
    "report.read",
    "run.read",
    "suite.read",
    "target.read",
  ],
};

function request(role: Role, action: Action) {
  return {
    action,
    actor: {
      amr: ["pwd", "mfa"],
      kind: "user" as const,
      role,
      userId: "user_actor",
    },
    artifactClassification: "sensitive" as const,
    organizationId: "organization_a",
    rawEvidenceAllowed: true,
    resourceOrganizationId: "organization_a",
  };
}

describe("role authorization", () => {
  it.each(roles)("matches the complete %s action matrix", (role) => {
    for (const action of actions) {
      const permitted = expected[role].includes(action);
      if (permitted && action !== "emergency.execute") {
        expect(authorize(request(role, action))).toEqual({ granted: true });
      } else {
        expect(() => authorize(request(role, action))).toThrow(
          "not authorized",
        );
      }
    }
  });

  it.each(roles)("denies %s across tenant boundaries", (role) => {
    expect(() =>
      authorize({
        ...request(role, "organization.read"),
        resourceOrganizationId: "organization_b",
      }),
    ).toThrow("not authorized");
  });

  it("requires MFA for destructive and sensitive management actions", () => {
    expect(() =>
      authorize({
        ...request("owner", "organization.delete"),
        actor: {
          amr: ["pwd"],
          kind: "user",
          role: "owner",
          userId: "user_actor",
        },
      }),
    ).toThrow("not authorized");
  });

  it("requires explicit raw-evidence policy and blocks prohibited quarantine", () => {
    expect(() =>
      authorize({
        ...request("auditor", "evidence.raw"),
        rawEvidenceAllowed: false,
      }),
    ).toThrow("not authorized");
    expect(() =>
      authorize({
        ...request("auditor", "evidence.raw"),
        artifactClassification: "prohibited_quarantine",
      }),
    ).toThrow("not authorized");
  });

  it("accepts only a current, independent emergency grant", () => {
    const base = request("owner", "emergency.execute");
    const grant = {
      action: "emergency.execute" as const,
      approvedByUserId: "user_approver",
      expiresAt: new Date("2026-09-12T19:00:00.000Z"),
      id: "grant_1",
      organizationId: "organization_a",
      reason: "Restore an unavailable control plane",
    };
    expect(
      authorize({
        ...base,
        emergencyGrant: grant,
        now: new Date("2026-09-12T18:00:00.000Z"),
      }),
    ).toEqual({ granted: true });
    expect(() =>
      authorize({
        ...base,
        emergencyGrant: { ...grant, approvedByUserId: "user_actor" },
        now: new Date("2026-09-12T18:00:00.000Z"),
      }),
    ).toThrow("not authorized");
  });

  it("authorizes service accounts only through exact scopes", () => {
    const base = {
      action: "run.create" as const,
      actor: {
        kind: "service_account" as const,
        scopes: new Set(["run:create"]),
        serviceAccountId: "service_account_runner",
      },
      organizationId: "organization_a",
      resourceOrganizationId: "organization_a",
    };
    expect(authorize(base)).toEqual({ granted: true });
    expect(() => authorize({ ...base, action: "run.cancel" })).toThrow(
      "not authorized",
    );
    expect(() =>
      authorize({
        ...base,
        action: "evidence.raw",
        actor: { ...base.actor, scopes: new Set(["*"]) },
      }),
    ).toThrow("not authorized");
  });
});
