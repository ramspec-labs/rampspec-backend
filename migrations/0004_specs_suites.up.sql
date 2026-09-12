-- rampspec:transaction required
CREATE TABLE rampspec.spec_snapshots (
  id text PRIMARY KEY CHECK (id ~ '^spec_snapshot_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  source_repository text NOT NULL CHECK (source_repository ~ '^https://github.com/'),
  source_commit char(40) NOT NULL CHECK (source_commit ~ '^[0-9a-f]{40}$'),
  sep_id text NOT NULL CHECK (sep_id ~ '^SEP-[0-9]{4}$'),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  content jsonb NOT NULL,
  upstream_status text NOT NULL CHECK (upstream_status IN ('draft', 'fcp', 'final', 'deprecated', 'removed')),
  upstream_version text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, source_repository, source_commit, sep_id),
  UNIQUE (organization_id, content_hash)
);

CREATE TABLE rampspec.rule_packs (
  id text PRIMARY KEY CHECK (id ~ '^rule_pack_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (slug ~ '^[a-z][a-z0-9-]{2,62}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, slug)
);

CREATE TABLE rampspec.rule_pack_versions (
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  rule_pack_id text NOT NULL,
  version text NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  manifest_hash char(64) NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  signature bytea,
  signer_key_id text,
  minimum_backend_version text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'deprecated')),
  published_at timestamptz,
  deprecated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, rule_pack_id, version),
  UNIQUE (organization_id, manifest_hash),
  FOREIGN KEY (organization_id, rule_pack_id)
    REFERENCES rampspec.rule_packs(organization_id, id)
    ON DELETE CASCADE,
  CHECK ((status IN ('published', 'deprecated')) = (published_at IS NOT NULL)),
  CHECK ((status = 'deprecated') = (deprecated_at IS NOT NULL)),
  CHECK ((signature IS NULL) = (signer_key_id IS NULL)),
  CHECK (status = 'draft' OR signature IS NOT NULL)
);

CREATE TABLE rampspec.rules (
  id text NOT NULL CHECK (id ~ '^rule_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  rule_pack_id text NOT NULL,
  rule_pack_version text NOT NULL,
  stable_key text NOT NULL CHECK (stable_key ~ '^[a-z][a-z0-9.-]+$'),
  spec_snapshot_id text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('normative', 'recommended', 'informational', 'draft')),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  implementation_hash char(64) NOT NULL CHECK (implementation_hash ~ '^[0-9a-f]{64}$'),
  definition jsonb NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, rule_pack_id, rule_pack_version, stable_key),
  FOREIGN KEY (organization_id, rule_pack_id, rule_pack_version)
    REFERENCES rampspec.rule_pack_versions(organization_id, rule_pack_id, version)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, spec_snapshot_id)
    REFERENCES rampspec.spec_snapshots(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE rampspec.scenarios (
  id text NOT NULL CHECK (id ~ '^scenario_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  stable_key text NOT NULL CHECK (stable_key ~ '^scenario\.[a-z0-9.-]+$'),
  version text NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  definition_hash char(64) NOT NULL CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
  definition jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'deprecated')),
  published_at timestamptz,
  deprecated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id, version),
  UNIQUE (organization_id, stable_key, version),
  UNIQUE (organization_id, definition_hash),
  CHECK ((status IN ('published', 'deprecated')) = (published_at IS NOT NULL)),
  CHECK ((status = 'deprecated') = (deprecated_at IS NOT NULL))
);

CREATE TABLE rampspec.suites (
  id text PRIMARY KEY CHECK (id ~ '^suite_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (slug ~ '^[a-z][a-z0-9-]{2,62}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, slug)
);

CREATE TABLE rampspec.suite_versions (
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  suite_id text NOT NULL,
  version text NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  lock_hash char(64) NOT NULL CHECK (lock_hash ~ '^[0-9a-f]{64}$'),
  lock_document jsonb NOT NULL,
  baseline_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'deprecated')),
  published_at timestamptz,
  deprecated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, suite_id, version),
  UNIQUE (organization_id, lock_hash),
  FOREIGN KEY (organization_id, suite_id)
    REFERENCES rampspec.suites(organization_id, id)
    ON DELETE CASCADE,
  CHECK ((status IN ('published', 'deprecated')) = (published_at IS NOT NULL)),
  CHECK ((status = 'deprecated') = (deprecated_at IS NOT NULL))
);

CREATE TABLE rampspec.suite_version_scenarios (
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  suite_id text NOT NULL,
  suite_version text NOT NULL,
  scenario_id text NOT NULL,
  scenario_version text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (organization_id, suite_id, suite_version, scenario_id, scenario_version),
  UNIQUE (organization_id, suite_id, suite_version, position),
  FOREIGN KEY (organization_id, suite_id, suite_version)
    REFERENCES rampspec.suite_versions(organization_id, suite_id, version)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, scenario_id, scenario_version)
    REFERENCES rampspec.scenarios(organization_id, id, version)
    ON DELETE RESTRICT
);

CREATE FUNCTION rampspec.reject_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'specification snapshots are immutable' USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER spec_snapshots_immutable
BEFORE UPDATE OR DELETE ON rampspec.spec_snapshots
FOR EACH ROW EXECUTE FUNCTION rampspec.reject_snapshot_mutation();

CREATE FUNCTION rampspec.protect_published_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('published', 'deprecated') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'published versions are immutable' USING ERRCODE = '55000';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'deprecated_at' - 'updated_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'deprecated_at' - 'updated_at') THEN
      RAISE EXCEPTION 'published version content is immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW.status NOT IN ('published', 'deprecated')
       OR (OLD.status = 'deprecated' AND NEW.status <> 'deprecated') THEN
      RAISE EXCEPTION 'published lifecycle cannot move backward' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER rule_pack_versions_immutable
BEFORE UPDATE OR DELETE ON rampspec.rule_pack_versions
FOR EACH ROW EXECUTE FUNCTION rampspec.protect_published_version();
CREATE TRIGGER scenarios_immutable
BEFORE UPDATE OR DELETE ON rampspec.scenarios
FOR EACH ROW EXECUTE FUNCTION rampspec.protect_published_version();
CREATE TRIGGER suite_versions_immutable
BEFORE UPDATE OR DELETE ON rampspec.suite_versions
FOR EACH ROW EXECUTE FUNCTION rampspec.protect_published_version();

CREATE FUNCTION rampspec.protect_published_rule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
  parent_organization_id text;
  parent_rule_pack_id text;
  parent_rule_pack_version text;
BEGIN
  parent_organization_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  parent_rule_pack_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.rule_pack_id ELSE NEW.rule_pack_id END;
  parent_rule_pack_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.rule_pack_version ELSE NEW.rule_pack_version END;
  SELECT status INTO parent_status
  FROM rampspec.rule_pack_versions
  WHERE organization_id = parent_organization_id
    AND rule_pack_id = parent_rule_pack_id
    AND version = parent_rule_pack_version;
  IF parent_status IN ('published', 'deprecated') THEN
    RAISE EXCEPTION 'rules in published packs are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER rules_immutable_with_pack
BEFORE INSERT OR UPDATE OR DELETE ON rampspec.rules
FOR EACH ROW EXECUTE FUNCTION rampspec.protect_published_rule();

CREATE FUNCTION rampspec.protect_published_suite_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
  parent_organization_id text;
  parent_suite_id text;
  parent_suite_version text;
BEGIN
  parent_organization_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  parent_suite_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.suite_id ELSE NEW.suite_id END;
  parent_suite_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.suite_version ELSE NEW.suite_version END;
  SELECT status INTO parent_status
  FROM rampspec.suite_versions
  WHERE organization_id = parent_organization_id
    AND suite_id = parent_suite_id
    AND version = parent_suite_version;
  IF parent_status IN ('published', 'deprecated') THEN
    RAISE EXCEPTION 'published suite membership is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER suite_membership_immutable_with_version
BEFORE INSERT OR UPDATE OR DELETE ON rampspec.suite_version_scenarios
FOR EACH ROW EXECUTE FUNCTION rampspec.protect_published_suite_membership();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'spec_snapshots', 'rule_packs', 'rule_pack_versions', 'rules',
    'scenarios', 'suites', 'suite_versions', 'suite_version_scenarios'
  ] LOOP
    EXECUTE format('ALTER TABLE rampspec.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE rampspec.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I_tenant ON rampspec.%I USING (organization_id = rampspec.current_organization_id()) WITH CHECK (organization_id = rampspec.current_organization_id())',
      table_name,
      table_name
    );
  END LOOP;
END
$$;
