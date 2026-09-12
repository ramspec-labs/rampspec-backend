-- rampspec:transaction required
CREATE TABLE rampspec.web_sessions (
  id text PRIMARY KEY CHECK (id ~ '^session_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  user_id text NOT NULL REFERENCES rampspec.users(id) ON DELETE CASCADE,
  issuer text NOT NULL CHECK (issuer ~ '^https://'),
  subject_hash char(64) NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  csrf_hash char(64) NOT NULL CHECK (csrf_hash ~ '^[0-9a-f]{64}$'),
  assurance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(assurance::text) <= 4096),
  user_agent_hash char(64) CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$'),
  ip_prefix_hash char(64) CHECK (ip_prefix_hash IS NULL OR ip_prefix_hash ~ '^[0-9a-f]{64}$'),
  identity_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (expires_at <= identity_expires_at),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);

CREATE INDEX web_sessions_user_active_idx
  ON rampspec.web_sessions(user_id, expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON COLUMN rampspec.web_sessions.token_hash IS
  'SHA-256 digest only; the session bearer token is never persisted.';
COMMENT ON COLUMN rampspec.web_sessions.csrf_hash IS
  'SHA-256 digest only; the CSRF token is never persisted.';
