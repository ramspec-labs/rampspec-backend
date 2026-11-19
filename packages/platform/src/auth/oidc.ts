import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";

import { toUtcTimestamp } from "../../../domain/src/index.js";

export interface VerifiedOidcClaims {
  readonly acr?: string;
  readonly amr: readonly string[];
  readonly authTime?: number;
  readonly email?: string;
  readonly expiresAt: number;
  readonly issuer: string;
  readonly name?: string;
  readonly nonce?: string;
  readonly subject: string;
}

export interface OidcVerificationOptions {
  /**
   * Expected nonce value from the initiating authentication request. When
   * set, the identity token must carry the same nonce.
   */
  readonly expectedNonce?: string;
  /**
   * SHA-256 digest of the expected nonce. Equivalent to `expectedNonce`
   * without requiring the raw nonce value at verification time.
   */
  readonly expectedNonceHash?: string;
}

export interface OidcVerifier {
  verify(
    idToken: string,
    now: Date,
    options?: OidcVerificationOptions,
  ): Promise<VerifiedOidcClaims>;
}

export interface JoseOidcVerifierOptions {
  readonly audience: string;
  readonly issuer: string;
  readonly jwks?: JSONWebKeySet;
  readonly jwksUri?: string;
}

export class JoseOidcVerifier implements OidcVerifier {
  private readonly audience: string;
  private readonly issuer: string;
  private readonly key: JWTVerifyGetKey;

  constructor(options: JoseOidcVerifierOptions) {
    if ((options.jwks === undefined) === (options.jwksUri === undefined)) {
      throw new Error("Configure exactly one local JWKS or remote JWKS URI.");
    }
    this.audience = options.audience;
    this.issuer = options.issuer;
    this.key = options.jwks
      ? createLocalJWKSet(options.jwks)
      : createRemoteJWKSet(new URL(options.jwksUri ?? ""));
  }

  async verify(
    idToken: string,
    now: Date,
    options: OidcVerificationOptions = {},
  ): Promise<VerifiedOidcClaims> {
    const { payload } = await jwtVerify(idToken, this.key, {
      audience: this.audience,
      currentDate: now,
      issuer: this.issuer,
    });
    if (!payload.sub || payload.exp === undefined || !payload.iss) {
      throw new Error("OIDC token is missing required claims.");
    }
    this.assertNonce(payload.nonce, options);

    const amr = Array.isArray(payload.amr)
      ? payload.amr.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    return {
      ...(typeof payload.acr === "string" ? { acr: payload.acr } : {}),
      amr,
      ...(typeof payload.auth_time === "number"
        ? { authTime: payload.auth_time }
        : {}),
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      expiresAt: payload.exp,
      issuer: payload.iss,
      ...(typeof payload.name === "string" ? { name: payload.name } : {}),
      ...(typeof payload.nonce === "string" ? { nonce: payload.nonce } : {}),
      subject: payload.sub,
    };
  }

  private assertNonce(nonce: unknown, options: OidcVerificationOptions): void {
    if (
      options.expectedNonce === undefined &&
      options.expectedNonceHash === undefined
    ) {
      return;
    }
    if (typeof nonce !== "string" || nonce.length === 0) {
      throw new Error("OIDC token is missing the expected nonce.");
    }
    if (
      options.expectedNonce !== undefined &&
      !equalValue(nonce, options.expectedNonce)
    ) {
      throw new Error(
        "OIDC token nonce does not match the authentication request.",
      );
    }
    if (
      options.expectedNonceHash !== undefined &&
      !equalDigest(options.expectedNonceHash, digest(nonce))
    ) {
      throw new Error(
        "OIDC token nonce does not match the authentication request.",
      );
    }
  }
}

export type OidcCallbackErrorCode =
  | "oidc-state-expired"
  | "oidc-state-missing"
  | "oidc-state-mismatch"
  | "oidc-state-reused"
  | "oidc-nonce-missing"
  | "oidc-nonce-mismatch";

/**
 * Rejected OIDC callback. Messages are generic on purpose: they carry the
 * failure code for operators and never include state, nonce, or token data.
 */
export class OidcCallbackError extends Error {
  readonly code: OidcCallbackErrorCode;

  constructor(code: OidcCallbackErrorCode) {
    super(`OIDC callback rejected: ${code}.`);
    this.name = "OidcCallbackError";
    this.code = code;
  }
}

export interface OidcAuthorizationRequestRecord {
  /** UTC timestamp after which the request must no longer be consumed. */
  readonly expiresAt: string;
  /** SHA-256 digest of the nonce; the raw nonce is never persisted. */
  readonly nonceHash: string;
  /** SHA-256 digest of the state; the raw state is never persisted. */
  readonly stateHash: string;
}

export type OidcRequestConsumeResult =
  | {
      readonly record: OidcAuthorizationRequestRecord;
      readonly status: "ok";
    }
  | { readonly status: "expired" | "missing" | "reused" };

export interface OidcRequestStore {
  /**
   * Persist a request record. Implementations must reject a duplicate
   * state hash. Consumption is atomic: a successful `consume` removes the
   * record so it can never be consumed twice.
   */
  save(record: OidcAuthorizationRequestRecord): Promise<void>;
  consume(stateHash: string, now: Date): Promise<OidcRequestConsumeResult>;
  pruneExpired(now: Date): Promise<number>;
  pendingCount(): Promise<number>;
}

export class InMemoryOidcRequestStore implements OidcRequestStore {
  private readonly pending = new Map<string, OidcAuthorizationRequestRecord>();
  private readonly consumed = new Map<string, number>();

  save(record: OidcAuthorizationRequestRecord): Promise<void> {
    if (
      this.pending.has(record.stateHash) ||
      this.consumed.has(record.stateHash)
    ) {
      return Promise.reject(new Error("Duplicate OIDC state hash."));
    }
    this.pending.set(record.stateHash, Object.freeze({ ...record }));
    return Promise.resolve();
  }

  consume(stateHash: string, now: Date): Promise<OidcRequestConsumeResult> {
    this.pruneConsumed(now);
    if (this.consumed.has(stateHash)) {
      return Promise.resolve({ status: "reused" });
    }
    const record = this.pending.get(stateHash);
    if (!record) {
      return Promise.resolve({ status: "missing" });
    }
    if (new Date(record.expiresAt) <= now) {
      this.pending.delete(stateHash);
      return Promise.resolve({ status: "expired" });
    }
    this.pending.delete(stateHash);
    this.consumed.set(stateHash, new Date(record.expiresAt).getTime());
    return Promise.resolve({ record, status: "ok" });
  }

  pruneExpired(now: Date): Promise<number> {
    let removed = 0;
    for (const [stateHash, record] of this.pending) {
      if (new Date(record.expiresAt) <= now) {
        this.pending.delete(stateHash);
        removed += 1;
      }
    }
    removed += this.pruneConsumed(now);
    return Promise.resolve(removed);
  }

  pendingCount(): Promise<number> {
    return Promise.resolve(this.pending.size);
  }

  private pruneConsumed(now: Date): number {
    let removed = 0;
    for (const [stateHash, expiresAtMs] of this.consumed) {
      if (expiresAtMs <= now.getTime()) {
        this.consumed.delete(stateHash);
        removed += 1;
      }
    }
    return removed;
  }
}

export interface OidcAuthorizationRequest {
  /** UTC timestamp after which the callback must be rejected as expired. */
  readonly expiresAt: string;
  /** Raw nonce to send to the provider; only its digest is persisted. */
  readonly nonce: string;
  /** Raw state to send to the provider; only its digest is persisted. */
  readonly state: string;
}

export interface ConsumedOidcAuthorizationRequest {
  readonly expiresAt: string;
  readonly nonceHash: string;
}

export interface OidcAuthorizationFlowOptions {
  readonly maxPendingRequests?: number;
  readonly store: OidcRequestStore;
  readonly ttlSeconds?: number;
}

export const DEFAULT_OIDC_REQUEST_TTL_SECONDS = 600;
export const MAX_OIDC_REQUEST_TTL_SECONDS = 3600;
export const MIN_OIDC_REQUEST_TTL_SECONDS = 60;
export const DEFAULT_OIDC_MAX_PENDING_REQUESTS = 1000;

const OIDC_VALUE_BYTES = 32;
const statePattern = /^[A-Za-z0-9_-]{43}$/u;

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function equalDigest(expected: string, candidate: string): boolean {
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(candidate, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function equalValue(left: string, right: string): boolean {
  return equalDigest(digest(left), digest(right));
}

function randomOidcValue(): string {
  return randomBytes(OIDC_VALUE_BYTES).toString("base64url");
}

/**
 * Generates, persists, and single-use consumes bounded OIDC `state` and
 * `nonce` values so a callback succeeds only for the authentication request
 * that initiated it. Only SHA-256 digests are persisted; raw values exist
 * only in the initiating request and the provider redirect.
 */
export class OidcAuthorizationFlow {
  private readonly maxPendingRequests: number;
  private readonly store: OidcRequestStore;
  private readonly ttlSeconds: number;

  constructor(options: OidcAuthorizationFlowOptions) {
    const ttlSeconds = options.ttlSeconds ?? DEFAULT_OIDC_REQUEST_TTL_SECONDS;
    if (
      !Number.isInteger(ttlSeconds) ||
      ttlSeconds < MIN_OIDC_REQUEST_TTL_SECONDS ||
      ttlSeconds > MAX_OIDC_REQUEST_TTL_SECONDS
    ) {
      throw new RangeError(
        `OIDC request TTL must be an integer between ${MIN_OIDC_REQUEST_TTL_SECONDS} and ${MAX_OIDC_REQUEST_TTL_SECONDS} seconds.`,
      );
    }
    const maxPendingRequests =
      options.maxPendingRequests ?? DEFAULT_OIDC_MAX_PENDING_REQUESTS;
    if (!Number.isInteger(maxPendingRequests) || maxPendingRequests < 1) {
      throw new RangeError(
        "OIDC maximum pending requests must be a positive integer.",
      );
    }
    this.maxPendingRequests = maxPendingRequests;
    this.store = options.store;
    this.ttlSeconds = ttlSeconds;
  }

  async begin(now = new Date()): Promise<OidcAuthorizationRequest> {
    await this.store.pruneExpired(now);
    if ((await this.store.pendingCount()) >= this.maxPendingRequests) {
      throw new Error("OIDC authorization request capacity reached.");
    }
    const state = randomOidcValue();
    const nonce = randomOidcValue();
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
    await this.store.save({
      expiresAt: toUtcTimestamp(expiresAt),
      nonceHash: digest(nonce),
      stateHash: digest(state),
    });
    return { expiresAt: toUtcTimestamp(expiresAt), nonce, state };
  }

  async consume(
    state: string,
    now = new Date(),
  ): Promise<ConsumedOidcAuthorizationRequest> {
    if (typeof state !== "string" || state.length === 0) {
      throw new OidcCallbackError("oidc-state-missing");
    }
    if (!statePattern.test(state)) {
      throw new OidcCallbackError("oidc-state-mismatch");
    }
    const result = await this.store.consume(digest(state), now);
    switch (result.status) {
      case "ok":
        return {
          expiresAt: result.record.expiresAt,
          nonceHash: result.record.nonceHash,
        };
      case "expired":
        throw new OidcCallbackError("oidc-state-expired");
      case "reused":
        throw new OidcCallbackError("oidc-state-reused");
      case "missing":
        throw new OidcCallbackError("oidc-state-mismatch");
    }
  }

  pruneExpired(now = new Date()): Promise<number> {
    return this.store.pruneExpired(now);
  }

  pendingCount(): Promise<number> {
    return this.store.pendingCount();
  }
}
