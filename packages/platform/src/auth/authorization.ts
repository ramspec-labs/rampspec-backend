import { DomainError } from "../../../domain/src/index.js";

export const roles = [
  "owner",
  "admin",
  "maintainer",
  "runner",
  "auditor",
  "viewer",
] as const;
export type Role = (typeof roles)[number];

export const actions = [
  "audit.read",
  "emergency.execute",
  "evidence.raw",
  "evidence.read",
  "organization.delete",
  "organization.invite",
  "organization.read",
  "organization.roles.write",
  "organization.write",
  "project.create",
  "project.delete",
  "project.read",
  "project.write",
  "report.read",
  "report.sign",
  "run.cancel",
  "run.create",
  "run.read",
  "run.retry",
  "runner.execute",
  "runner.manage",
  "secret.manage",
  "suite.publish",
  "suite.read",
  "suite.write",
  "target.read",
  "target.verify",
  "target.write",
] as const;
export type Action = (typeof actions)[number];

const readActions: readonly Action[] = [
  "evidence.read",
  "organization.read",
  "project.read",
  "report.read",
  "run.read",
  "suite.read",
  "target.read",
];

function actionSet(actionsToGrant: readonly Action[]): ReadonlySet<Action> {
  return new Set<Action>(actionsToGrant);
}

export const rolePermissions: Readonly<Record<Role, ReadonlySet<Action>>> =
  Object.freeze({
    owner: actionSet(actions),
    admin: actionSet(
      actions.filter(
        (action) =>
          !["emergency.execute", "organization.delete"].includes(action),
      ),
    ),
    maintainer: actionSet([
      ...readActions,
      "project.create",
      "project.write",
      "run.cancel",
      "run.create",
      "run.retry",
      "suite.publish",
      "suite.write",
      "target.verify",
      "target.write",
    ]),
    runner: actionSet([
      "evidence.read",
      "project.read",
      "report.read",
      "run.create",
      "run.read",
      "runner.execute",
      "suite.read",
      "target.read",
    ]),
    auditor: actionSet([...readActions, "audit.read", "evidence.raw"]),
    viewer: actionSet(readActions),
  });

const mfaActions = new Set<Action>([
  "emergency.execute",
  "organization.delete",
  "organization.roles.write",
  "project.delete",
  "report.sign",
  "runner.manage",
  "secret.manage",
]);

export interface UserActor {
  readonly amr: readonly string[];
  readonly kind: "user";
  readonly role: Role;
  readonly userId: string;
}

export interface ServiceAccountActor {
  readonly kind: "service_account";
  readonly scopes: ReadonlySet<string>;
  readonly serviceAccountId: string;
}

export type AuthorizationActor = ServiceAccountActor | UserActor;

export interface EmergencyGrant {
  readonly action: Action;
  readonly approvedByUserId: string;
  readonly expiresAt: Date;
  readonly id: string;
  readonly organizationId: string;
  readonly reason: string;
}

export interface AuthorizationRequest {
  readonly action: Action;
  readonly actor: AuthorizationActor;
  readonly artifactClassification?:
    "internal" | "prohibited_quarantine" | "public" | "sensitive";
  readonly emergencyGrant?: EmergencyGrant;
  readonly now?: Date;
  readonly organizationId: string;
  readonly rawEvidenceAllowed?: boolean;
  readonly resourceOrganizationId: string;
}

function denied(reason: string): never {
  throw new DomainError({
    code: "access-denied",
    detail: "The actor is not authorized for this operation.",
    extensions: { reason },
    status: 403,
    title: "Access Denied",
  });
}

function serviceScope(action: Action): string {
  return action.replace(".", ":");
}

export function authorize(request: AuthorizationRequest): {
  readonly granted: true;
} {
  if (
    !request.organizationId ||
    !request.resourceOrganizationId ||
    request.organizationId !== request.resourceOrganizationId
  ) {
    return denied("cross_tenant");
  }

  if (request.actor.kind === "service_account") {
    if (
      mfaActions.has(request.action) ||
      request.action === "evidence.raw" ||
      request.action === "emergency.execute"
    ) {
      return denied("interactive_actor_required");
    }
    if (
      !request.actor.scopes.has(serviceScope(request.action)) &&
      !request.actor.scopes.has("*")
    ) {
      return denied("scope_missing");
    }
  } else {
    if (!rolePermissions[request.actor.role].has(request.action)) {
      return denied("role_missing");
    }
    if (mfaActions.has(request.action) && !request.actor.amr.includes("mfa")) {
      return denied("mfa_required");
    }
  }

  if (request.action === "evidence.raw") {
    if (
      !request.rawEvidenceAllowed ||
      request.artifactClassification === "prohibited_quarantine"
    ) {
      return denied("raw_evidence_policy");
    }
  }

  if (request.action === "emergency.execute") {
    const grant = request.emergencyGrant;
    const now = request.now ?? new Date();
    if (
      request.actor.kind !== "user" ||
      !grant ||
      grant.organizationId !== request.organizationId ||
      grant.action !== request.action ||
      grant.expiresAt <= now ||
      grant.approvedByUserId === request.actor.userId ||
      grant.reason.trim().length < 10
    ) {
      return denied("emergency_grant_invalid");
    }
  }

  return { granted: true };
}
