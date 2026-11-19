import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  createId,
  DomainError,
  parseId,
  toUtcTimestamp,
} from "../../../domain/src/index.js";
import type {
  OidcAuthorizationFlow,
  OidcVerifier,
  VerifiedOidcClaims,
} from "./oidc.js";

export interface SessionRecord {
  readonly assurance: {
    readonly acr?: string;
    readonly amr: readonly string[];
    readonly authTime?: number;
  };
  readonly csrfHash: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly identityExpiresAt: string;
  readonly ipPrefixHash?: string;
  readonly issuer: string;
  readonly lastSeenAt: string;
  readonly revokedAt?: string;
  readonly revokeReason?: string;
  readonly subjectHash: string;
  readonly tokenHash: string;
  readonly userAgentHash?: string;
  readonly userId: string;
}

export interface SessionStore {
  insert(record: SessionRecord): Promise<void>;
  findById(sessionId: string): Promise<SessionRecord | undefined>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | undefined>;
  replaceToken(
    previousTokenHash: string,
    next: SessionRecord,
  ): Promise<boolean>;
  revoke(
    tokenHash: string,
    revokedAt: string,
    reason: string,
  ): Promise<boolean>;
  revokeById(
    sessionId: string,
    revokedAt: string,
    reason: string,
  ): Promise<boolean>;
  revokeUser(
    userId: string,
    revokedAt: string,
    reason: string,
  ): Promise<number>;
}

export interface IdentityResolver {
  resolve(claims: VerifiedOidcClaims): Promise<string>;
}

export interface AuthenticationAuditSink {
  record(event: {
    readonly action:
      | "login.failed"
      | "login.succeeded"
      | "session.logout"
      | "session.renewed"
      | "session.revoked";
    readonly reason?: string;
    readonly sessionId?: string;
    readonly userId?: string;
  }): Promise<void>;
}

export interface SessionCredentials {
  readonly csrfToken: string;
  readonly expiresAt: string;
  readonly sessionId: string;
  readonly sessionToken: string;
}

/**
 * OIDC callback binding for `SessionService.exchange`. When present, the
 * callback `state` is single-use consumed before the identity token is
 * verified, and the token nonce must match the initiating request. When
 * absent, exchange keeps its previous behaviour for callers that already
 * validated the callback.
 */
export interface OidcCallback {
  readonly flow: OidcAuthorizationFlow;
  readonly state: string;
}

export interface SessionPrincipal {
  readonly assurance: SessionRecord["assurance"];
  readonly sessionId: string;
  readonly userId: string;
}

export interface SessionServiceOptions {
  readonly audit: AuthenticationAuditSink;
  readonly identityResolver: IdentityResolver;
  readonly requireMfa?: boolean;
  readonly requiredAcr?: string;
  readonly sessionTtlSeconds: number;
  readonly store: SessionStore;
  readonly verifier: OidcVerifier;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function assertDigest(value: string | undefined, name: string): void {
  if (value !== undefined && !/^[a-f\d]{64}$/u.test(value)) {
    throw new TypeError(`${name} must be a SHA-256 digest.`);
  }
}

function equalDigest(expected: string, candidate: string): boolean {
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(digest(candidate), "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function authenticationError(
  detail = "The session is invalid or expired.",
): DomainError {
  return new DomainError({
    code: "authentication-required",
    detail,
    status: 401,
    title: "Authentication Required",
  });
}

// One error for every unresolvable revocation target (malformed, missing,
// or owned by another user) so callers cannot probe for session existence.
function sessionNotFoundError(): DomainError {
  return new DomainError({
    code: "session-not-found",
    detail: "The session does not exist or cannot be revoked.",
    status: 404,
    title: "Session Not Found",
  });
}

const MAX_REVOKE_REASON_LENGTH = 128;

function assertRevokeReason(reason: string | undefined): string {
  if (reason === undefined) return "user_revoked";
  if (
    typeof reason !== "string" ||
    reason.length < 1 ||
    reason.length > MAX_REVOKE_REASON_LENGTH
  ) {
    throw new DomainError({
      code: "invalid-revocation-reason",
      detail: "The revocation reason must be between 1 and 128 characters.",
      status: 400,
      title: "Invalid Revocation Reason",
    });
  }
  return reason;
}

export class SessionService {
  constructor(private readonly options: SessionServiceOptions) {
    if (
      !Number.isInteger(options.sessionTtlSeconds) ||
      options.sessionTtlSeconds < 60
    ) {
      throw new RangeError("Session TTL must be at least 60 seconds.");
    }
  }

  async exchange(
    idToken: string,
    now = new Date(),
    binding: {
      readonly ipPrefixHash?: string;
      readonly userAgentHash?: string;
    } = {},
    callback?: OidcCallback,
  ): Promise<SessionCredentials> {
    assertDigest(binding.ipPrefixHash, "IP prefix hash");
    assertDigest(binding.userAgentHash, "User-agent hash");
    let expectedNonceHash: string | undefined;
    if (callback !== undefined) {
      try {
        ({ nonceHash: expectedNonceHash } = await callback.flow.consume(
          callback.state,
          now,
        ));
      } catch {
        await this.options.audit.record({
          action: "login.failed",
          reason: "callback_rejected",
        });
        throw authenticationError("The identity provider token was rejected.");
      }
    }
    let claims: VerifiedOidcClaims;
    try {
      claims = await this.options.verifier.verify(
        idToken,
        now,
        expectedNonceHash === undefined ? undefined : { expectedNonceHash },
      );
      this.assertAssurance(claims);
    } catch {
      await this.options.audit.record({
        action: "login.failed",
        reason: "provider_rejected",
      });
      throw authenticationError("The identity provider token was rejected.");
    }

    const userId = await this.options.identityResolver.resolve(claims);
    const sessionToken = randomToken("rss");
    const csrfToken = randomToken("rcsrf");
    const sessionId = createId("session");
    const expiresAt = new Date(
      Math.min(
        claims.expiresAt * 1000,
        now.getTime() + this.options.sessionTtlSeconds * 1000,
      ),
    );
    if (expiresAt <= now) {
      await this.options.audit.record({
        action: "login.failed",
        reason: "expired",
      });
      throw authenticationError();
    }

    await this.options.store.insert({
      assurance: {
        ...(claims.acr === undefined ? {} : { acr: claims.acr }),
        amr: [...claims.amr],
        ...(claims.authTime === undefined ? {} : { authTime: claims.authTime }),
      },
      csrfHash: digest(csrfToken),
      expiresAt: toUtcTimestamp(expiresAt),
      id: sessionId,
      identityExpiresAt: toUtcTimestamp(new Date(claims.expiresAt * 1000)),
      ...(binding.ipPrefixHash === undefined
        ? {}
        : { ipPrefixHash: binding.ipPrefixHash }),
      issuer: claims.issuer,
      lastSeenAt: toUtcTimestamp(now),
      subjectHash: digest(`${claims.issuer}\u0000${claims.subject}`),
      tokenHash: digest(sessionToken),
      ...(binding.userAgentHash === undefined
        ? {}
        : { userAgentHash: binding.userAgentHash }),
      userId,
    });
    await this.options.audit.record({
      action: "login.succeeded",
      sessionId,
      userId,
    });
    return {
      csrfToken,
      expiresAt: toUtcTimestamp(expiresAt),
      sessionId,
      sessionToken,
    };
  }

  private assertAssurance(claims: VerifiedOidcClaims): void {
    if (this.options.requireMfa && !claims.amr.includes("mfa")) {
      throw new Error("MFA assurance is required.");
    }
    if (this.options.requiredAcr && claims.acr !== this.options.requiredAcr) {
      throw new Error("Required authentication context is absent.");
    }
  }

  async authenticate(
    sessionToken: string,
    options: {
      readonly csrfToken?: string;
      readonly method: string;
      readonly now?: Date;
    },
  ): Promise<SessionPrincipal> {
    const now = options.now ?? new Date();
    const record = await this.options.store.findByTokenHash(
      digest(sessionToken),
    );
    if (!record || record.revokedAt || new Date(record.expiresAt) <= now) {
      throw authenticationError();
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(options.method.toUpperCase())) {
      if (
        !options.csrfToken ||
        !equalDigest(record.csrfHash, options.csrfToken)
      ) {
        throw new DomainError({
          code: "csrf-check-failed",
          detail: "The CSRF token is missing or invalid.",
          status: 403,
          title: "CSRF Check Failed",
        });
      }
    }
    return {
      assurance: record.assurance,
      sessionId: record.id,
      userId: record.userId,
    };
  }

  async renew(
    sessionToken: string,
    csrfToken: string,
    now = new Date(),
  ): Promise<SessionCredentials> {
    await this.authenticate(sessionToken, { csrfToken, method: "POST", now });
    const record = await this.options.store.findByTokenHash(
      digest(sessionToken),
    );
    if (!record) throw authenticationError();

    const nextSessionToken = randomToken("rss");
    const nextCsrfToken = randomToken("rcsrf");
    const expiresAt = new Date(
      Math.min(
        new Date(record.identityExpiresAt).getTime(),
        now.getTime() + this.options.sessionTtlSeconds * 1000,
      ),
    );
    if (expiresAt <= now) throw authenticationError();
    const next: SessionRecord = {
      ...record,
      csrfHash: digest(nextCsrfToken),
      expiresAt: toUtcTimestamp(expiresAt),
      lastSeenAt: toUtcTimestamp(now),
      tokenHash: digest(nextSessionToken),
    };
    if (!(await this.options.store.replaceToken(record.tokenHash, next))) {
      throw authenticationError();
    }
    await this.options.audit.record({
      action: "session.renewed",
      sessionId: record.id,
      userId: record.userId,
    });
    return {
      csrfToken: nextCsrfToken,
      expiresAt: next.expiresAt,
      sessionId: next.id,
      sessionToken: nextSessionToken,
    };
  }

  async logout(
    sessionToken: string,
    csrfToken: string,
    now = new Date(),
  ): Promise<void> {
    const principal = await this.authenticate(sessionToken, {
      csrfToken,
      method: "POST",
      now,
    });
    await this.options.store.revoke(
      digest(sessionToken),
      toUtcTimestamp(now),
      "logout",
    );
    await this.options.audit.record({
      action: "session.logout",
      sessionId: principal.sessionId,
      userId: principal.userId,
    });
  }

  /**
   * Revoke one session selected by its identifier.
   *
   * The caller authenticates with their own session token and CSRF token.
   * Only a session owned by the caller can be revoked; malformed, missing,
   * and foreign session identifiers all fail with the same not-found error
   * so session existence cannot be enumerated. Revocation is idempotent:
   * repeating it returns the original revocation time without emitting a
   * second audit record. Server state is invalidated before the audit
   * record is emitted and before success is returned.
   */
  async revokeSession(input: {
    readonly csrfToken: string;
    readonly reason?: string;
    readonly sessionToken: string;
    readonly targetSessionId: string;
    readonly now?: Date;
  }): Promise<{ readonly revokedAt: string; readonly sessionId: string }> {
    const now = input.now ?? new Date();
    const principal = await this.authenticate(input.sessionToken, {
      csrfToken: input.csrfToken,
      method: "POST",
      now,
    });
    const reason = assertRevokeReason(input.reason);
    let targetSessionId: string;
    try {
      targetSessionId = parseId("session", input.targetSessionId);
    } catch {
      throw sessionNotFoundError();
    }
    const record = await this.options.store.findById(targetSessionId);
    if (!record || record.userId !== principal.userId) {
      throw sessionNotFoundError();
    }
    if (record.revokedAt) {
      return { revokedAt: record.revokedAt, sessionId: record.id };
    }
    const revokedAt = toUtcTimestamp(now);
    const revoked = await this.options.store.revokeById(
      record.id,
      revokedAt,
      reason,
    );
    if (!revoked) {
      // Lost a race with a concurrent revocation; the session is already
      // invalidated, so report the stored revocation time.
      const current = await this.options.store.findById(record.id);
      if (!current?.revokedAt) throw sessionNotFoundError();
      return { revokedAt: current.revokedAt, sessionId: current.id };
    }
    await this.options.audit.record({
      action: "session.revoked",
      reason,
      sessionId: record.id,
      userId: principal.userId,
    });
    return { revokedAt, sessionId: record.id };
  }

  async revokeUser(
    userId: string,
    reason: string,
    now = new Date(),
  ): Promise<number> {
    const count = await this.options.store.revokeUser(
      userId,
      toUtcTimestamp(now),
      reason,
    );
    await this.options.audit.record({
      action: "session.revoked",
      reason,
      userId,
    });
    return count;
  }
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  insert(record: SessionRecord): Promise<void> {
    if (this.sessions.has(record.tokenHash)) {
      return Promise.reject(new Error("Duplicate session token hash."));
    }
    this.sessions.set(record.tokenHash, Object.freeze(record));
    return Promise.resolve();
  }

  findById(sessionId: string): Promise<SessionRecord | undefined> {
    for (const record of this.sessions.values()) {
      if (record.id === sessionId) return Promise.resolve(record);
    }
    return Promise.resolve(undefined);
  }

  findByTokenHash(tokenHash: string): Promise<SessionRecord | undefined> {
    return Promise.resolve(this.sessions.get(tokenHash));
  }

  replaceToken(
    previousTokenHash: string,
    next: SessionRecord,
  ): Promise<boolean> {
    if (
      !this.sessions.has(previousTokenHash) ||
      this.sessions.has(next.tokenHash)
    )
      return Promise.resolve(false);
    this.sessions.delete(previousTokenHash);
    this.sessions.set(next.tokenHash, Object.freeze(next));
    return Promise.resolve(true);
  }

  revoke(
    tokenHash: string,
    revokedAt: string,
    reason: string,
  ): Promise<boolean> {
    const record = this.sessions.get(tokenHash);
    if (!record || record.revokedAt) return Promise.resolve(false);
    this.sessions.set(tokenHash, {
      ...record,
      revokedAt,
      revokeReason: reason,
    });
    return Promise.resolve(true);
  }

  revokeById(
    sessionId: string,
    revokedAt: string,
    reason: string,
  ): Promise<boolean> {
    for (const [tokenHash, record] of this.sessions) {
      if (record.id !== sessionId) continue;
      if (record.revokedAt) return Promise.resolve(false);
      this.sessions.set(tokenHash, {
        ...record,
        revokedAt,
        revokeReason: reason,
      });
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  revokeUser(
    userId: string,
    revokedAt: string,
    reason: string,
  ): Promise<number> {
    let count = 0;
    for (const [tokenHash, record] of this.sessions) {
      if (record.userId === userId && !record.revokedAt) {
        this.sessions.set(tokenHash, {
          ...record,
          revokedAt,
          revokeReason: reason,
        });
        count += 1;
      }
    }
    return Promise.resolve(count);
  }
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  assertCookieValue(token, "rss", maxAgeSeconds);
  return `rampspec_session=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function csrfCookie(token: string, maxAgeSeconds: number): string {
  assertCookieValue(token, "rcsrf", maxAgeSeconds);
  return `rampspec_csrf=${token}; Path=/; Max-Age=${maxAgeSeconds}; Secure; SameSite=Strict`;
}

function assertCookieValue(
  token: string,
  prefix: "rcsrf" | "rss",
  maxAgeSeconds: number,
): void {
  if (!new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`, "u").test(token)) {
    throw new TypeError(`Invalid ${prefix} cookie token.`);
  }
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
    throw new RangeError("Cookie max age must be a non-negative integer.");
  }
}
