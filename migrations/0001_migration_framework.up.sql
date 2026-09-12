-- rampspec:transaction required
CREATE SCHEMA IF NOT EXISTS rampspec;

CREATE TABLE rampspec.system_metadata (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE rampspec.system_metadata IS
  'Non-secret installation metadata managed by versioned migrations.';
