import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import {
  JoseOidcVerifier,
  type OidcVerifier,
  type VerifiedOidcClaims,
} from "./oidc.js";
import {
  csrfCookie,
  InMemorySessionStore,
  sessionCookie,
  SessionService,
  type AuthenticationAuditSink,
} from "./sessions.js";

const now = new Date("2026-09-12T18:00:00.000Z");
const claims: VerifiedOidcClaims = {
  acr: "urn:rampspec:mfa",
  amr: ["pwd", "mfa"],
  authTime: Math.floor(now.getTime() / 1000),
  email: "person@example.test",
  expiresAt: Math.floor(now.getTime() / 1000) + 3600,
  issuer: "https://identity.example.test",
  name: "Synthetic Person",
  subject: "oidc|synthetic-person",
};

class FakeVerifier implements OidcVerifier {
  constructor(private readonly result: VerifiedOidcClaims | Error = claims) {}

  verify(): Promise<VerifiedOidcClaims> {
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}

describe("web identity sessions", () => {
  let store: InMemorySessionStore;
  let events: Parameters<AuthenticationAuditSink["record"]>[0][];

  beforeEach(() => {
    store = new InMemorySessionStore();
    events = [];
  });

  function service(
    verifier: OidcVerifier = new FakeVerifier(),
    requireMfa = false,
  ) {
    return new SessionService({
      audit: {
        record: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      },
      identityResolver: { resolve: () => Promise.resolve("user_synthetic") },
      requireMfa,
      ...(requireMfa ? { requiredAcr: "urn:rampspec:mfa" } : {}),
      sessionTtlSeconds: 900,
      store,
      verifier,
    });
  }

  it("exchanges a verified identity without persisting raw identity or session tokens", async () => {
    const auth = service();
    const credentials = await auth.exchange("signed-id-token", now, {
      ipPrefixHash: "a".repeat(64),
      userAgentHash: "b".repeat(64),
    });
    const principal = await auth.authenticate(credentials.sessionToken, {
      method: "GET",
      now,
    });
    expect(principal).toMatchObject({
      sessionId: credentials.sessionId,
      userId: "user_synthetic",
    });
    const tokenHash = createHash("sha256")
      .update(credentials.sessionToken, "utf8")
      .digest("hex");
    const persisted = await store.findByTokenHash(tokenHash);
    expect(persisted).toMatchObject({
      ipPrefixHash: "a".repeat(64),
      tokenHash,
      userAgentHash: "b".repeat(64),
    });
    expect(persisted?.subjectHash).toMatch(/^[a-f\d]{64}$/u);
    expect(JSON.stringify(persisted)).not.toContain("signed-id-token");
    expect(JSON.stringify(persisted)).not.toContain(credentials.sessionToken);
    expect(events).toEqual([
      {
        action: "login.succeeded",
        sessionId: credentials.sessionId,
        userId: "user_synthetic",
      },
    ]);
  });

  it("requires CSRF for unsafe methods", async () => {
    const auth = service();
    const credentials = await auth.exchange("signed-id-token", now);
    await expect(
      auth.authenticate(credentials.sessionToken, { method: "POST", now }),
    ).rejects.toMatchObject({ code: "csrf-check-failed", status: 403 });
    await expect(
      auth.authenticate(credentials.sessionToken, {
        csrfToken: credentials.csrfToken,
        method: "POST",
        now,
      }),
    ).resolves.toMatchObject({ userId: "user_synthetic" });
  });

  it("rotates credentials atomically and rejects replay of the old token", async () => {
    const auth = service();
    const first = await auth.exchange("signed-id-token", now);
    const second = await auth.renew(
      first.sessionToken,
      first.csrfToken,
      new Date(now.getTime() + 1000),
    );
    await expect(
      auth.authenticate(first.sessionToken, { method: "GET", now }),
    ).rejects.toThrow("invalid or expired");
    await expect(
      auth.authenticate(second.sessionToken, { method: "GET", now }),
    ).resolves.toMatchObject({ sessionId: first.sessionId });
  });

  it("never renews beyond the identity expiry", async () => {
    const expiring = {
      ...claims,
      expiresAt: Math.floor(now.getTime() / 1000) + 120,
    };
    const auth = service(new FakeVerifier(expiring));
    const first = await auth.exchange("signed-id-token", now);
    const second = await auth.renew(
      first.sessionToken,
      first.csrfToken,
      new Date(now.getTime() + 60_000),
    );
    expect(second.expiresAt).toBe("2026-09-12T18:02:00.000Z");
    await expect(
      auth.renew(
        second.sessionToken,
        second.csrfToken,
        new Date(now.getTime() + 120_000),
      ),
    ).rejects.toThrow("invalid or expired");
  });

  it("rejects expired and revoked sessions", async () => {
    const auth = service();
    const credentials = await auth.exchange("signed-id-token", now);
    await expect(
      auth.authenticate(credentials.sessionToken, {
        method: "GET",
        now: new Date(now.getTime() + 901_000),
      }),
    ).rejects.toThrow("invalid or expired");

    const active = await auth.exchange("another-token", now);
    await auth.logout(active.sessionToken, active.csrfToken, now);
    await expect(
      auth.authenticate(active.sessionToken, { method: "GET", now }),
    ).rejects.toThrow("invalid or expired");
  });

  it("revokes all sessions for a user", async () => {
    const auth = service();
    const first = await auth.exchange("first", now);
    const second = await auth.exchange("second", now);
    await expect(
      auth.revokeUser("user_synthetic", "account_disabled", now),
    ).resolves.toBe(2);
    await expect(
      auth.authenticate(first.sessionToken, { method: "GET", now }),
    ).rejects.toThrow();
    await expect(
      auth.authenticate(second.sessionToken, { method: "GET", now }),
    ).rejects.toThrow();
  });

  it("enforces optional MFA and maps provider failures without sensitive audit data", async () => {
    const noMfa = {
      ...claims,
      acr: undefined,
      amr: ["pwd"],
    } as unknown as VerifiedOidcClaims;
    await expect(
      service(new FakeVerifier(noMfa), true).exchange("raw-token", now),
    ).rejects.toThrow("identity provider token was rejected");
    await expect(
      service(
        new FakeVerifier(new Error("provider included raw-token")),
      ).exchange("raw-token", now),
    ).rejects.toThrow("identity provider token was rejected");
    expect(JSON.stringify(events)).not.toContain("raw-token");
  });

  it("creates hardened session and CSRF cookies", () => {
    expect(sessionCookie("rss_value", 900)).toBe(
      "rampspec_session=rss_value; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax",
    );
    expect(csrfCookie("rcsrf_value", 900)).toBe(
      "rampspec_csrf=rcsrf_value; Path=/; Max-Age=900; Secure; SameSite=Strict",
    );
    expect(() => sessionCookie("rss_value\r\nInjected: true", 900)).toThrow(
      "Invalid rss cookie token",
    );
    expect(() => csrfCookie("rcsrf_value", -1)).toThrow("non-negative integer");
  });

  it("rejects unhashed device bindings", async () => {
    await expect(
      service().exchange("signed-id-token", now, {
        userAgentHash: "raw user agent",
      }),
    ).rejects.toThrow("SHA-256 digest");
  });

  it("verifies JWT signature, issuer, audience, expiry, and assurance claims", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.alg = "ES256";
    publicJwk.kid = "test-key";
    publicJwk.use = "sig";
    const verifier = new JoseOidcVerifier({
      audience: "rampspec-api",
      issuer: claims.issuer,
      jwks: { keys: [publicJwk] },
    });
    const token = await new SignJWT({ acr: claims.acr, amr: claims.amr })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(claims.issuer)
      .setAudience("rampspec-api")
      .setSubject(claims.subject)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 300)
      .sign(privateKey);

    await expect(verifier.verify(token, now)).resolves.toMatchObject({
      amr: ["pwd", "mfa"],
      subject: claims.subject,
    });
    await expect(
      new JoseOidcVerifier({
        audience: "wrong-audience",
        issuer: claims.issuer,
        jwks: { keys: [publicJwk] },
      }).verify(token, now),
    ).rejects.toThrow();
  });

  it("stores only hashes in the session table", async () => {
    const sql = await readFile(
      new URL(
        "../../../../migrations/0006_web_sessions.up.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain("token_hash char(64) NOT NULL UNIQUE");
    expect(sql).toContain("csrf_hash char(64) NOT NULL");
    expect(sql).not.toMatch(
      /id_token|access_token|refresh_token|token_value/iu,
    );
  });
});
