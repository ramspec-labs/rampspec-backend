import { createHash } from "node:crypto";

import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  InMemoryOidcRequestStore,
  JoseOidcVerifier,
  OidcAuthorizationFlow,
  OidcCallbackError,
  type OidcVerifier,
  type VerifiedOidcClaims,
} from "./oidc.js";
import {
  InMemorySessionStore,
  SessionService,
  type AuthenticationAuditSink,
} from "./sessions.js";

const now = new Date("2026-09-12T18:00:00.000Z");
const issuer = "https://identity.example.test";
const claims: VerifiedOidcClaims = {
  acr: "urn:rampspec:mfa",
  amr: ["pwd", "mfa"],
  authTime: Math.floor(now.getTime() / 1000),
  email: "person@example.test",
  expiresAt: Math.floor(now.getTime() / 1000) + 3600,
  issuer,
  name: "Synthetic Person",
  subject: "oidc|synthetic-person",
};

const statePattern = /^[A-Za-z0-9_-]{43}$/u;

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

class CountingVerifier implements OidcVerifier {
  calls = 0;

  constructor(private readonly result: VerifiedOidcClaims | Error = claims) {}

  verify(): Promise<VerifiedOidcClaims> {
    this.calls += 1;
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}

describe("OIDC authorization request flow", () => {
  it("issues distinct bounded state and nonce values with a TTL", async () => {
    const flow = new OidcAuthorizationFlow({
      store: new InMemoryOidcRequestStore(),
    });
    const first = await flow.begin(now);
    const second = await flow.begin(now);
    expect(first.state).toMatch(statePattern);
    expect(first.nonce).toMatch(statePattern);
    expect(first.state).not.toBe(second.state);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.expiresAt).toBe("2026-09-12T18:10:00.000Z");
    expect(await flow.pendingCount()).toBe(2);
  });

  it("consumes a request once and returns only the nonce digest", async () => {
    const flow = new OidcAuthorizationFlow({
      store: new InMemoryOidcRequestStore(),
    });
    const request = await flow.begin(now);
    const consumed = await flow.consume(request.state, now);
    expect(consumed).toEqual({
      expiresAt: "2026-09-12T18:10:00.000Z",
      nonceHash: digest(request.nonce),
    });
    expect(consumed.nonceHash).not.toBe(request.nonce);
    expect(consumed.nonceHash).toMatch(/^[a-f\d]{64}$/u);
    expect(await flow.pendingCount()).toBe(0);
  });

  it("rejects reuse of a consumed state", async () => {
    const flow = new OidcAuthorizationFlow({
      store: new InMemoryOidcRequestStore(),
    });
    const request = await flow.begin(now);
    await flow.consume(request.state, now);
    await expect(flow.consume(request.state, now)).rejects.toMatchObject({
      code: "oidc-state-reused",
    });
    await expect(flow.consume(request.state, now)).rejects.toMatchObject({
      code: "oidc-state-reused",
    });
  });

  it("rejects missing, malformed, and unknown states", async () => {
    const flow = new OidcAuthorizationFlow({
      store: new InMemoryOidcRequestStore(),
    });
    await expect(flow.consume("", now)).rejects.toMatchObject({
      code: "oidc-state-missing",
    });
    for (const malformed of [
      "too-short",
      "a".repeat(42),
      "a".repeat(44),
      `${"a".repeat(42)}+`,
    ]) {
      await expect(flow.consume(malformed, now)).rejects.toMatchObject({
        code: "oidc-state-mismatch",
      });
    }
    await expect(flow.consume("b".repeat(43), now)).rejects.toMatchObject({
      code: "oidc-state-mismatch",
    });
    expect(await flow.pendingCount()).toBe(0);
  });

  it("rejects expired states at the expiry boundary", async () => {
    const flow = new OidcAuthorizationFlow({
      store: new InMemoryOidcRequestStore(),
    });
    const request = await flow.begin(now);
    await expect(
      flow.consume(request.state, new Date(now.getTime() + 600_000)),
    ).rejects.toMatchObject({ code: "oidc-state-expired" });

    const live = await flow.begin(now);
    await expect(
      flow.consume(live.state, new Date(now.getTime() + 599_999)),
    ).resolves.toMatchObject({ nonceHash: digest(live.nonce) });
  });

  it("refuses new requests at capacity instead of evicting in-flight ones", async () => {
    const flow = new OidcAuthorizationFlow({
      maxPendingRequests: 2,
      store: new InMemoryOidcRequestStore(),
    });
    const first = await flow.begin(now);
    const second = await flow.begin(now);
    await expect(flow.begin(now)).rejects.toThrow(
      "OIDC authorization request capacity reached",
    );
    await expect(flow.consume(first.state, now)).resolves.toBeDefined();
    await expect(flow.consume(second.state, now)).resolves.toBeDefined();
  });

  it("recovers capacity after expired requests are pruned", async () => {
    const flow = new OidcAuthorizationFlow({
      maxPendingRequests: 1,
      store: new InMemoryOidcRequestStore(),
    });
    await flow.begin(now);
    await expect(flow.begin(now)).rejects.toThrow("capacity reached");
    expect(await flow.pruneExpired(new Date(now.getTime() + 601_000))).toBe(1);
    await expect(
      flow.begin(new Date(now.getTime() + 601_000)),
    ).resolves.toBeDefined();
  });

  it("rejects invalid TTL and capacity configuration", () => {
    const store = () => new InMemoryOidcRequestStore();
    expect(
      () => new OidcAuthorizationFlow({ store: store(), ttlSeconds: 59 }),
    ).toThrow(RangeError);
    expect(
      () => new OidcAuthorizationFlow({ store: store(), ttlSeconds: 3601 }),
    ).toThrow(RangeError);
    expect(
      () => new OidcAuthorizationFlow({ store: store(), ttlSeconds: 60.5 }),
    ).toThrow(RangeError);
    expect(
      () =>
        new OidcAuthorizationFlow({ maxPendingRequests: 0, store: store() }),
    ).toThrow(RangeError);
    expect(
      () => new OidcAuthorizationFlow({ store: store(), ttlSeconds: 60 }),
    ).not.toThrow();
  });

  it("prunes expired requests and reports how many were removed", async () => {
    const flow = new OidcAuthorizationFlow({
      store: new InMemoryOidcRequestStore(),
    });
    await flow.begin(now);
    await flow.begin(now);
    expect(await flow.pruneExpired(now)).toBe(0);
    expect(await flow.pruneExpired(new Date(now.getTime() + 601_000))).toBe(2);
    expect(await flow.pendingCount()).toBe(0);
  });

  it("rejects duplicate state records in the store", async () => {
    const store = new InMemoryOidcRequestStore();
    const record = {
      expiresAt: "2026-09-12T18:10:00.000Z",
      nonceHash: digest("nonce"),
      stateHash: digest("state"),
    };
    await store.save(record);
    await expect(store.save(record)).rejects.toThrow("Duplicate OIDC state");
  });

  it("carries a stable error code without sensitive data", () => {
    const error = new OidcCallbackError("oidc-state-reused");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("oidc-state-reused");
    expect(error.message).not.toContain("secret");
  });
});

describe("OIDC nonce verification", () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  let publicJwk: JWK;

  beforeAll(async () => {
    const keys = await generateKeyPair("ES256");
    privateKey = keys.privateKey;
    const exported = await exportJWK(keys.publicKey);
    exported.alg = "ES256";
    exported.kid = "test-key";
    exported.use = "sig";
    publicJwk = exported;
  });

  function verifier() {
    return new JoseOidcVerifier({
      audience: "rampspec-api",
      issuer,
      jwks: { keys: [publicJwk] },
    });
  }

  async function signIdToken(options: { nonce?: string } = {}) {
    return new SignJWT({
      acr: claims.acr,
      amr: claims.amr,
      ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience("rampspec-api")
      .setSubject(claims.subject)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 300)
      .sign(privateKey);
  }

  it("accepts a token whose nonce matches the request and returns it", async () => {
    const token = await signIdToken({ nonce: "request-nonce" });
    await expect(
      verifier().verify(token, now, { expectedNonce: "request-nonce" }),
    ).resolves.toMatchObject({
      nonce: "request-nonce",
      subject: claims.subject,
    });
  });

  it("rejects a mismatched nonce", async () => {
    const token = await signIdToken({ nonce: "request-nonce" });
    await expect(
      verifier().verify(token, now, { expectedNonce: "other-nonce" }),
    ).rejects.toThrow("nonce does not match");
  });

  it("rejects a token without a nonce when one is expected", async () => {
    const token = await signIdToken();
    await expect(
      verifier().verify(token, now, { expectedNonce: "request-nonce" }),
    ).rejects.toThrow("missing the expected nonce");
  });

  it("verifies by nonce digest without the raw nonce value", async () => {
    const token = await signIdToken({ nonce: "request-nonce" });
    await expect(
      verifier().verify(token, now, {
        expectedNonceHash: digest("request-nonce"),
      }),
    ).resolves.toMatchObject({ subject: claims.subject });
    await expect(
      verifier().verify(token, now, {
        expectedNonceHash: digest("other-nonce"),
      }),
    ).rejects.toThrow("nonce does not match");
    await expect(
      verifier().verify(token, now, {
        expectedNonceHash: digest("request-nonce"),
      }),
    ).resolves.toMatchObject({ nonce: "request-nonce" });
  });

  it("keeps verifying without a nonce expectation for existing callers", async () => {
    const token = await signIdToken({ nonce: "request-nonce" });
    await expect(verifier().verify(token, now)).resolves.toMatchObject({
      nonce: "request-nonce",
      subject: claims.subject,
    });
    const bare = await signIdToken();
    await expect(verifier().verify(bare, now)).resolves.toMatchObject({
      subject: claims.subject,
    });
  });
});

describe("session exchange with an OIDC callback", () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  let publicJwk: JWK;

  beforeAll(async () => {
    const keys = await generateKeyPair("ES256");
    privateKey = keys.privateKey;
    const exported = await exportJWK(keys.publicKey);
    exported.alg = "ES256";
    exported.kid = "test-key";
    exported.use = "sig";
    publicJwk = exported;
  });

  function service(
    verifier: OidcVerifier,
    events: Parameters<AuthenticationAuditSink["record"]>[0][],
  ) {
    return new SessionService({
      audit: {
        record: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      },
      identityResolver: { resolve: () => Promise.resolve("user_synthetic") },
      sessionTtlSeconds: 900,
      store: new InMemorySessionStore(),
      verifier,
    });
  }

  function realVerifier() {
    return new JoseOidcVerifier({
      audience: "rampspec-api",
      issuer,
      jwks: { keys: [publicJwk] },
    });
  }

  async function signIdToken(nonce: string) {
    return new SignJWT({ acr: claims.acr, amr: claims.amr, nonce })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience("rampspec-api")
      .setSubject(claims.subject)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 300)
      .sign(privateKey);
  }

  it("succeeds only for the initiating authentication request", async () => {
    const events: Parameters<AuthenticationAuditSink["record"]>[0][] = [];
    const auth = service(realVerifier(), events);
    const flow = new OidcAuthorizationFlow({
      store: new InMemoryOidcRequestStore(),
    });
    const request = await flow.begin(now);
    const token = await signIdToken(request.nonce);
    const credentials = await auth.exchange(
      token,
      now,
      {},
      {
        flow,
        state: request.state,
      },
    );
    await expect(
      auth.authenticate(credentials.sessionToken, { method: "GET", now }),
    ).resolves.toMatchObject({ userId: "user_synthetic" });
    expect(events).toEqual([
      {
        action: "login.succeeded",
        sessionId: credentials.sessionId,
        userId: "user_synthetic",
      },
    ]);
  });

  it("rejects a replayed state and creates no session", async () => {
    const events: Parameters<AuthenticationAuditSink["record"]>[0][] = [];
    const auth = service(realVerifier(), events);
    const flow = new OidcAuthorizationFlow({
      store: new InMemoryOidcRequestStore(),
    });
    const request = await flow.begin(now);
    const token = await signIdToken(request.nonce);
    await auth.exchange(token, now, {}, { flow, state: request.state });
    events.length = 0;
    await expect(
      auth.exchange(token, now, {}, { flow, state: request.state }),
    ).rejects.toThrow("identity provider token was rejected");
    expect(events).toEqual([
      { action: "login.failed", reason: "callback_rejected" },
    ]);
  });

  it("rejects a tampered state without verifying the token", async () => {
    const events: Parameters<AuthenticationAuditSink["record"]>[0][] = [];
    const verifier = new CountingVerifier();
    const auth = service(verifier, events);
    const flow = new OidcAuthorizationFlow({
      store: new InMemoryOidcRequestStore(),
    });
    const request = await flow.begin(now);
    const tampered = `${request.state.slice(0, 42)}${request.state.endsWith("A") ? "B" : "A"}`;
    await expect(
      auth.exchange("signed-id-token", now, {}, { flow, state: tampered }),
    ).rejects.toThrow("identity provider token was rejected");
    expect(verifier.calls).toBe(0);
    expect(events).toEqual([
      { action: "login.failed", reason: "callback_rejected" },
    ]);
    await expect(flow.consume(request.state, now)).resolves.toBeDefined();
  });

  it("rejects missing and expired states", async () => {
    const events: Parameters<AuthenticationAuditSink["record"]>[0][] = [];
    const auth = service(new CountingVerifier(), events);
    const flow = new OidcAuthorizationFlow({
      store: new InMemoryOidcRequestStore(),
    });
    await expect(
      auth.exchange("signed-id-token", now, {}, { flow, state: "" }),
    ).rejects.toThrow("identity provider token was rejected");
    const request = await flow.begin(now);
    await expect(
      auth.exchange(
        "signed-id-token",
        new Date(now.getTime() + 601_000),
        {},
        { flow, state: request.state },
      ),
    ).rejects.toThrow("identity provider token was rejected");
    expect(events).toEqual([
      { action: "login.failed", reason: "callback_rejected" },
      { action: "login.failed", reason: "callback_rejected" },
    ]);
  });

  it("rejects a token whose nonce does not match and burns the state", async () => {
    const events: Parameters<AuthenticationAuditSink["record"]>[0][] = [];
    const auth = service(realVerifier(), events);
    const flow = new OidcAuthorizationFlow({
      store: new InMemoryOidcRequestStore(),
    });
    const request = await flow.begin(now);
    const wrongNonceToken = await signIdToken("attacker-nonce");
    await expect(
      auth.exchange(
        wrongNonceToken,
        now,
        {},
        {
          flow,
          state: request.state,
        },
      ),
    ).rejects.toThrow("identity provider token was rejected");
    expect(events).toEqual([
      { action: "login.failed", reason: "provider_rejected" },
    ]);
    await expect(
      auth.exchange(
        wrongNonceToken,
        now,
        {},
        {
          flow,
          state: request.state,
        },
      ),
    ).rejects.toThrow("identity provider token was rejected");
    expect(events).toEqual([
      { action: "login.failed", reason: "provider_rejected" },
      { action: "login.failed", reason: "callback_rejected" },
    ]);
  });

  it("keeps exchanging without a callback for existing callers", async () => {
    const events: Parameters<AuthenticationAuditSink["record"]>[0][] = [];
    const auth = service(new CountingVerifier(), events);
    const credentials = await auth.exchange("signed-id-token", now);
    await expect(
      auth.authenticate(credentials.sessionToken, { method: "GET", now }),
    ).resolves.toMatchObject({ userId: "user_synthetic" });
  });

  it("reveals no state, nonce, or token data in failures", async () => {
    const events: Parameters<AuthenticationAuditSink["record"]>[0][] = [];
    const auth = service(realVerifier(), events);
    const flow = new OidcAuthorizationFlow({
      store: new InMemoryOidcRequestStore(),
    });
    const request = await flow.begin(now);
    const token = await signIdToken(request.nonce);
    await expect(
      auth.exchange(token, now, {}, { flow, state: "c".repeat(43) }),
    ).rejects.toThrow("identity provider token was rejected");
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(request.state);
    expect(serialized).not.toContain(request.nonce);
    expect(serialized).not.toContain(token);
  });
});
