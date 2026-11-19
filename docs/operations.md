# Operations

Liveness is exposed at `/health`; dependency readiness is exposed at `/ready`. Review trace IDs and audit events together when investigating a run. Treat evidence as immutable and use the retention planner before deleting expired artifacts.

Deploy only immutable image digests through the protected staging or production environment. Verify backup manifests before restores and stop traffic when tenant isolation, readiness, or signature checks fail.

Target probes are memory-bounded: a single retained header value is capped at 4,096 bytes, retained headers at 8,192 bytes combined, all response headers at 65,536 bytes combined, and the response body at 65,536 bytes, with at most 32 SEP identifiers retained. A probe that exceeds any budget aborts, discards all partial content, and records `budgetExceeded` with a `limitReason` on the probe plus a `target-probe-response-bounded` finding on the run report. No partial response content reaches logs or evidence manifests.

## Web session revocation

`DELETE /v1/sessions/{sessionId}` revokes one web session selected by its
identifier. The caller authenticates with their own session token and CSRF
token; only a session owned by the caller can be revoked. Malformed, missing,
and foreign session identifiers all return the same `session-not-found`
(404) response so session existence cannot be enumerated. Revocation is
idempotent: repeating it returns the original revocation time without
emitting a second audit record. Server state is invalidated before the
`session.revoked` audit record is emitted and before success is returned,
and any later use of the revoked session is rejected. An optional
`reason` (1–128 characters, default `user_revoked`) is stored on the
session row. No new migration is required: `rampspec.web_sessions` already
carries `revoked_at` and `revoke_reason` and is keyed by session id.

## OIDC login callbacks

`OidcAuthorizationFlow` generates, persists, and single-use consumes bounded `state` and `nonce` values for each login. Only SHA-256 digests are persisted (table `rampspec.oidc_authorization_requests`, migration 0010); raw values exist only in the initiating request and the provider redirect.

- Requests expire after 600 seconds by default (configurable 60–3600 seconds) and pending requests are capped at 1000; a new request is refused rather than evicting an in-flight one.
- A callback succeeds only for the initiating authentication request: missing, malformed, unknown, expired, or already-consumed `state` is rejected, and the identity token nonce must match the request. Consuming a `state` is atomic, so a failed token check still burns the `state` and it can never be replayed.
- Callback failures create no session and the audit event (`login.failed`, reason `callback_rejected`) and the returned error contain no state, nonce, or provider token data.
- Expired pending requests are pruned when a new request begins; the `oidc_authorization_requests_expiry_idx` index supports that cleanup in the database.
