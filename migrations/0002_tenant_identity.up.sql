-- rampspec:transaction required
CREATE FUNCTION rampspec.current_organization_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('rampspec.organization_id', true), '')
$$;

CREATE TABLE rampspec.users (
  id text PRIMARY KEY CHECK (id ~ '^user_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  oidc_subject text NOT NULL UNIQUE CHECK (length(oidc_subject) BETWEEN 3 AND 512),
  email text CHECK (email IS NULL OR email = lower(email)),
  display_name text CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rampspec.organizations (
  id text PRIMARY KEY CHECK (id ~ '^organization_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]{2,62}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  owner_user_id text NOT NULL REFERENCES rampspec.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rampspec.memberships (
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES rampspec.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'maintainer', 'runner', 'auditor', 'viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE rampspec.service_accounts (
  id text NOT NULL CHECK (id ~ '^service_account_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by_user_id text NOT NULL REFERENCES rampspec.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name)
);

CREATE TABLE rampspec.api_keys (
  id text PRIMARY KEY CHECK (id ~ '^api_key_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  service_account_id text NOT NULL,
  key_prefix text NOT NULL UNIQUE CHECK (key_prefix ~ '^rsk_[a-z0-9]{12}$'),
  key_hash bytea NOT NULL CHECK (octet_length(key_hash) >= 32),
  scopes text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 64),
  expires_at timestamptz,
  last_used_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, service_account_id)
    REFERENCES rampspec.service_accounts(organization_id, id)
    ON DELETE CASCADE,
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (last_used_at IS NULL OR last_used_at >= created_at),
  CHECK (disabled_at IS NULL OR disabled_at >= created_at)
);

CREATE UNIQUE INDEX users_email_lower_unique_idx
  ON rampspec.users(lower(email))
  WHERE email IS NOT NULL;
CREATE INDEX memberships_user_idx ON rampspec.memberships(user_id, status);
CREATE INDEX api_keys_service_account_idx
  ON rampspec.api_keys(organization_id, service_account_id)
  WHERE disabled_at IS NULL;

ALTER TABLE rampspec.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rampspec.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_tenant ON rampspec.organizations
  USING (id = rampspec.current_organization_id())
  WITH CHECK (id = rampspec.current_organization_id());

ALTER TABLE rampspec.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE rampspec.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_tenant ON rampspec.memberships
  USING (organization_id = rampspec.current_organization_id())
  WITH CHECK (organization_id = rampspec.current_organization_id());

ALTER TABLE rampspec.service_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE rampspec.service_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY service_accounts_tenant ON rampspec.service_accounts
  USING (organization_id = rampspec.current_organization_id())
  WITH CHECK (organization_id = rampspec.current_organization_id());

ALTER TABLE rampspec.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE rampspec.api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY api_keys_tenant ON rampspec.api_keys
  USING (organization_id = rampspec.current_organization_id())
  WITH CHECK (organization_id = rampspec.current_organization_id());
