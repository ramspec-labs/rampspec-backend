import { randomUUID } from "node:crypto";

export const entityKinds = [
  "api_key",
  "artifact",
  "attempt",
  "challenge",
  "corridor",
  "event",
  "finding",
  "organization",
  "project",
  "report",
  "run",
  "scenario",
  "service_account",
  "suite",
  "target",
  "user",
] as const;

export type EntityKind = (typeof entityKinds)[number];
declare const opaqueIdBrand: unique symbol;
export type OpaqueId<Kind extends EntityKind> = string & {
  readonly [opaqueIdBrand]: Kind;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function createId<Kind extends EntityKind>(kind: Kind): OpaqueId<Kind> {
  return `${kind}_${randomUUID()}` as OpaqueId<Kind>;
}

export function parseId<Kind extends EntityKind>(
  kind: Kind,
  value: unknown,
): OpaqueId<Kind> {
  if (typeof value !== "string") {
    throw new TypeError(`${kind} ID must be a string.`);
  }
  const prefix = `${kind}_`;
  if (
    !value.startsWith(prefix) ||
    !uuidPattern.test(value.slice(prefix.length))
  ) {
    throw new TypeError(`Invalid ${kind} ID.`);
  }
  return value as OpaqueId<Kind>;
}
