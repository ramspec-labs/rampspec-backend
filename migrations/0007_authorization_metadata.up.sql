-- rampspec:transaction required
CREATE TABLE rampspec.authorization_grants (
  id text PRIMARY KEY CHECK (id ~ '^grant_[a-z0-9_-]{8,96}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'service_account')),
  subject_id text NOT NULL,
  role text CHECK (role IN ('owner', 'admin', 'maintainer', 'runner', 'auditor', 'viewer')),
  scopes text[] NOT NULL DEFAULT '{}',
  source text NOT NULL CHECK (source IN ('membership', 'service_account', 'emergency')),
  expires_at timestamptz,
  approved_by_user_id text REFERENCES rampspec.users(id) ON DELETE RESTRICT,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK ((subject_type = 'user') = (role IS NOT NULL)),
  CHECK ((subject_type = 'service_account') = (cardinality(scopes) > 0)),
  CHECK ((source = 'emergency') = (expires_at IS NOT NULL AND approved_by_user_id IS NOT NULL AND reason IS NOT NULL)),
  CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX authorization_grants_subject_idx
  ON rampspec.authorization_grants(organization_id, subject_type, subject_id)
  WHERE revoked_at IS NULL;

ALTER TABLE rampspec.authorization_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE rampspec.authorization_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY authorization_grants_tenant ON rampspec.authorization_grants
  USING (organization_id = rampspec.current_organization_id())
  WITH CHECK (organization_id = rampspec.current_organization_id());
