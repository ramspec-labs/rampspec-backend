-- rampspec:transaction required
CREATE TABLE rampspec.projects (
  id text PRIMARY KEY CHECK (id ~ '^project_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (slug ~ '^[a-z][a-z0-9-]{2,62}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  repository_url text CHECK (repository_url IS NULL OR repository_url ~ '^https://'),
  policy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(policy::text) <= 32768),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, slug),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);

CREATE TABLE rampspec.targets (
  id text PRIMARY KEY CHECK (id ~ '^target_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  normalized_origin text NOT NULL CHECK (
    normalized_origin = lower(normalized_origin)
    AND normalized_origin ~ '^https://[a-z0-9]'
    AND normalized_origin !~ '^https://[^/]+/'
    AND normalized_origin !~ '[@?#]'
    AND normalized_origin !~ ':443$'
    AND normalized_origin !~ '\.$'
  ),
  stellar_network text NOT NULL CHECK (stellar_network IN ('testnet', 'pubnet', 'futurenet', 'custom')),
  network_passphrase text NOT NULL,
  custom_network_id text,
  expected_seps text[] NOT NULL DEFAULT '{}' CHECK (cardinality(expected_seps) <= 128),
  expected_methods text[] NOT NULL DEFAULT '{}' CHECK (cardinality(expected_methods) <= 64),
  runner_policy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(runner_policy::text) <= 32768),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(metadata::text) <= 16384),
  status text NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'verified', 'suspended', 'archived')),
  verified_until timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, normalized_origin),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES rampspec.projects(organization_id, id)
    ON DELETE CASCADE,
  CHECK (
    (stellar_network = 'testnet' AND network_passphrase = 'Test SDF Network ; September 2015' AND custom_network_id IS NULL)
    OR (stellar_network = 'pubnet' AND network_passphrase = 'Public Global Stellar Network ; September 2015' AND custom_network_id IS NULL)
    OR (stellar_network = 'futurenet' AND network_passphrase = 'Test SDF Future Network ; October 2022' AND custom_network_id IS NULL)
    OR (stellar_network = 'custom' AND length(custom_network_id) >= 3
        AND network_passphrase NOT IN (
          'Test SDF Network ; September 2015',
          'Public Global Stellar Network ; September 2015',
          'Test SDF Future Network ; October 2022'
        ))
  ),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
  CHECK ((status = 'verified') = (verified_until IS NOT NULL))
);

CREATE TABLE rampspec.target_verifications (
  id text PRIMARY KEY CHECK (id ~ '^verification_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  target_id text NOT NULL,
  method text NOT NULL CHECK (method IN ('dns_txt', 'well_known')),
  status text NOT NULL CHECK (status IN ('pending', 'verified', 'expired', 'revoked')),
  evidence_hash char(64) CHECK (evidence_hash IS NULL OR evidence_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, target_id)
    REFERENCES rampspec.targets(organization_id, id)
    ON DELETE CASCADE,
  CHECK (expires_at > created_at),
  CHECK ((status = 'verified') = (verified_at IS NOT NULL))
);

CREATE TABLE rampspec.assets (
  id text PRIMARY KEY CHECK (id ~ '^asset_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  target_id text NOT NULL,
  canonical_asset_id text NOT NULL CHECK (length(canonical_asset_id) BETWEEN 1 AND 200),
  asset_type text NOT NULL CHECK (asset_type IN ('native', 'credit_alphanum4', 'credit_alphanum12', 'contract')),
  code text,
  issuer text,
  contract_id text,
  decimals smallint NOT NULL DEFAULT 7 CHECK (decimals BETWEEN 0 AND 18),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, target_id, canonical_asset_id),
  FOREIGN KEY (organization_id, target_id)
    REFERENCES rampspec.targets(organization_id, id)
    ON DELETE CASCADE,
  CHECK (
    (asset_type = 'native' AND canonical_asset_id = 'native' AND code IS NULL AND issuer IS NULL AND contract_id IS NULL)
    OR (asset_type = 'credit_alphanum4' AND code ~ '^[A-Z0-9]{1,4}$'
        AND issuer ~ '^G[A-Z2-7]{55}$' AND contract_id IS NULL)
    OR (asset_type = 'credit_alphanum12' AND code ~ '^[A-Z0-9]{5,12}$'
        AND issuer ~ '^G[A-Z2-7]{55}$' AND contract_id IS NULL)
    OR (asset_type = 'contract' AND contract_id ~ '^C[A-Z2-7]{55}$'
        AND code IS NULL AND issuer IS NULL)
  )
);

CREATE TABLE rampspec.corridors (
  id text PRIMARY KEY CHECK (id ~ '^corridor_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  target_id text NOT NULL,
  input_asset_id text NOT NULL,
  output_asset_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('deposit', 'withdrawal', 'send', 'receive')),
  methods text[] NOT NULL CHECK (cardinality(methods) BETWEEN 1 AND 64),
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(metadata::text) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, target_id, input_asset_id, output_asset_id, direction),
  FOREIGN KEY (organization_id, target_id)
    REFERENCES rampspec.targets(organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, input_asset_id)
    REFERENCES rampspec.assets(organization_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, output_asset_id)
    REFERENCES rampspec.assets(organization_id, id)
    ON DELETE RESTRICT,
  CHECK (input_asset_id <> output_asset_id)
);

CREATE TABLE rampspec.target_secret_references (
  id text PRIMARY KEY CHECK (id ~ '^secret_reference_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  target_id text NOT NULL,
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_-]{2,63}$'),
  provider text NOT NULL CHECK (provider IN ('aws', 'azure', 'gcp', 'vault', 'local')),
  locator_hash char(64) NOT NULL CHECK (locator_hash ~ '^[0-9a-f]{64}$'),
  provider_version text,
  last_used_at timestamptz,
  rotated_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, target_id, name),
  FOREIGN KEY (organization_id, target_id)
    REFERENCES rampspec.targets(organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX targets_project_idx ON rampspec.targets(organization_id, project_id, status);
CREATE INDEX target_verifications_expiry_idx
  ON rampspec.target_verifications(organization_id, expires_at)
  WHERE status = 'verified';

ALTER TABLE rampspec.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE rampspec.projects FORCE ROW LEVEL SECURITY;
CREATE POLICY projects_tenant ON rampspec.projects
  USING (organization_id = rampspec.current_organization_id())
  WITH CHECK (organization_id = rampspec.current_organization_id());

ALTER TABLE rampspec.targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE rampspec.targets FORCE ROW LEVEL SECURITY;
CREATE POLICY targets_tenant ON rampspec.targets
  USING (organization_id = rampspec.current_organization_id())
  WITH CHECK (organization_id = rampspec.current_organization_id());

ALTER TABLE rampspec.target_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE rampspec.target_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY target_verifications_tenant ON rampspec.target_verifications
  USING (organization_id = rampspec.current_organization_id())
  WITH CHECK (organization_id = rampspec.current_organization_id());

ALTER TABLE rampspec.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE rampspec.assets FORCE ROW LEVEL SECURITY;
CREATE POLICY assets_tenant ON rampspec.assets
  USING (organization_id = rampspec.current_organization_id())
  WITH CHECK (organization_id = rampspec.current_organization_id());

ALTER TABLE rampspec.corridors ENABLE ROW LEVEL SECURITY;
ALTER TABLE rampspec.corridors FORCE ROW LEVEL SECURITY;
CREATE POLICY corridors_tenant ON rampspec.corridors
  USING (organization_id = rampspec.current_organization_id())
  WITH CHECK (organization_id = rampspec.current_organization_id());

ALTER TABLE rampspec.target_secret_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE rampspec.target_secret_references FORCE ROW LEVEL SECURITY;
CREATE POLICY target_secret_references_tenant ON rampspec.target_secret_references
  USING (organization_id = rampspec.current_organization_id())
  WITH CHECK (organization_id = rampspec.current_organization_id());
