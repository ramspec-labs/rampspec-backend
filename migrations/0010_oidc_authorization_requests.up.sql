-- rampspec:transaction required
CREATE TABLE rampspec.oidc_authorization_requests (
  state_hash char(64) PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  nonce_hash char(64) NOT NULL CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK ((consumed_at IS NULL) OR (consumed_at >= created_at))
);

CREATE INDEX oidc_authorization_requests_expiry_idx
  ON rampspec.oidc_authorization_requests(expires_at);

COMMENT ON COLUMN rampspec.oidc_authorization_requests.state_hash IS
  'SHA-256 digest only; the OIDC state value is never persisted.';
COMMENT ON COLUMN rampspec.oidc_authorization_requests.nonce_hash IS
  'SHA-256 digest only; the OIDC nonce value is never persisted.';
