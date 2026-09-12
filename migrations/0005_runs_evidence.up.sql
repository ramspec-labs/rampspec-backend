-- rampspec:transaction required
CREATE TABLE rampspec.runs (
  id text PRIMARY KEY CHECK (id ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  target_id text NOT NULL,
  suite_id text NOT NULL,
  suite_version text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 128),
  effective_config jsonb NOT NULL CHECK (octet_length(effective_config::text) <= 262144),
  effective_config_hash char(64) NOT NULL CHECK (effective_config_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN (
    'requested', 'policy_check', 'queued', 'provisioning', 'running',
    'waiting_external', 'finalizing', 'completed', 'failed', 'blocked',
    'cancelled', 'expired'
  )),
  terminal_reason text,
  requested_by_user_id text REFERENCES rampspec.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES rampspec.projects(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, target_id)
    REFERENCES rampspec.targets(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, suite_id, suite_version)
    REFERENCES rampspec.suite_versions(organization_id, suite_id, version) ON DELETE RESTRICT,
  CHECK ((state IN ('completed', 'failed', 'blocked', 'cancelled', 'expired')) = (finished_at IS NOT NULL)),
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE rampspec.run_events (
  id text PRIMARY KEY CHECK (id ~ '^event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 0),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9.]+$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(payload::text) <= 65536),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, run_id, sequence),
  FOREIGN KEY (organization_id, run_id)
    REFERENCES rampspec.runs(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE rampspec.run_attempts (
  id text PRIMARY KEY CHECK (id ~ '^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  state text NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired')),
  runner_id text,
  terminal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, run_id, id),
  UNIQUE (organization_id, run_id, attempt_number),
  FOREIGN KEY (organization_id, run_id)
    REFERENCES rampspec.runs(organization_id, id) ON DELETE CASCADE,
  CHECK ((state IN ('succeeded', 'failed', 'cancelled', 'expired')) = (finished_at IS NOT NULL))
);

CREATE TABLE rampspec.run_steps (
  id text PRIMARY KEY CHECK (id ~ '^step_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  attempt_id text NOT NULL,
  scenario_key text NOT NULL,
  scenario_version text NOT NULL,
  step_key text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  status text NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'failed', 'warning', 'skipped', 'not_applicable')),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, run_id, id),
  UNIQUE (organization_id, attempt_id, scenario_key, step_key),
  FOREIGN KEY (organization_id, run_id, attempt_id)
    REFERENCES rampspec.run_attempts(organization_id, run_id, id) ON DELETE CASCADE,
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE rampspec.artifacts (
  id text PRIMARY KEY CHECK (id ~ '^artifact_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  attempt_id text,
  classification text NOT NULL CHECK (classification IN ('public', 'internal', 'sensitive', 'prohibited_quarantine')),
  media_type text NOT NULL,
  object_key text NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  redaction_version text NOT NULL,
  encryption_key_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'finalized', 'deleted')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, object_key),
  FOREIGN KEY (organization_id, run_id)
    REFERENCES rampspec.runs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, run_id, attempt_id)
    REFERENCES rampspec.run_attempts(organization_id, run_id, id) ON DELETE CASCADE,
  CHECK (expires_at > created_at),
  CHECK ((status = 'finalized') = (finalized_at IS NOT NULL AND deleted_at IS NULL)),
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL))
);

CREATE TABLE rampspec.findings (
  id text PRIMARY KEY CHECK (id ~ '^finding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  step_id text NOT NULL,
  rule_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('pass', 'fail', 'warning', 'skipped', 'not_applicable')),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  message text NOT NULL,
  remediation text,
  source_reference jsonb NOT NULL,
  evidence_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, run_id, step_id, rule_key),
  FOREIGN KEY (organization_id, run_id)
    REFERENCES rampspec.runs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, run_id, step_id)
    REFERENCES rampspec.run_steps(organization_id, run_id, id) ON DELETE CASCADE
);

CREATE TABLE rampspec.finding_triage_events (
  id text PRIMARY KEY CHECK (id ~ '^event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  finding_id text NOT NULL,
  actor_user_id text NOT NULL REFERENCES rampspec.users(id) ON DELETE RESTRICT,
  disposition text NOT NULL CHECK (disposition IN ('open', 'accepted', 'false_positive', 'fixed', 'reopened')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, finding_id)
    REFERENCES rampspec.findings(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE rampspec.protocol_exchanges (
  id text PRIMARY KEY CHECK (id ~ '^exchange_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  step_id text,
  method text NOT NULL,
  redacted_url text NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response_hash char(64) CHECK (response_hash IS NULL OR response_hash ~ '^[0-9a-f]{64}$'),
  response_status integer CHECK (response_status BETWEEN 100 AND 599),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, run_id)
    REFERENCES rampspec.runs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, run_id, step_id)
    REFERENCES rampspec.run_steps(organization_id, run_id, id) ON DELETE CASCADE
);

CREATE TABLE rampspec.ledger_observations (
  id text PRIMARY KEY CHECK (id ~ '^ledger_observation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  network text NOT NULL CHECK (network IN ('testnet', 'pubnet', 'futurenet', 'custom')),
  transaction_hash char(64) NOT NULL CHECK (transaction_hash ~ '^[0-9a-f]{64}$'),
  ledger_sequence bigint CHECK (ledger_sequence >= 0),
  destination text NOT NULL,
  asset_id text NOT NULL,
  amount text NOT NULL CHECK (amount ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  memo jsonb,
  finality text NOT NULL CHECK (finality IN ('pending', 'confirmed', 'failed', 'not_found', 'unknown')),
  observed_at timestamptz NOT NULL,
  UNIQUE (organization_id, run_id, transaction_hash),
  FOREIGN KEY (organization_id, run_id)
    REFERENCES rampspec.runs(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE rampspec.reports (
  id text PRIMARY KEY CHECK (id ~ '^report_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  schema_version text NOT NULL,
  report_hash char(64) NOT NULL CHECK (report_hash ~ '^[0-9a-f]{64}$'),
  evidence_manifest_hash char(64) NOT NULL CHECK (evidence_manifest_hash ~ '^[0-9a-f]{64}$'),
  content jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'signed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, run_id, report_hash),
  FOREIGN KEY (organization_id, run_id)
    REFERENCES rampspec.runs(organization_id, id) ON DELETE CASCADE,
  CHECK ((status IN ('finalized', 'signed')) = (finalized_at IS NOT NULL))
);

CREATE TABLE rampspec.report_signatures (
  report_id text NOT NULL,
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  key_id text NOT NULL,
  algorithm text NOT NULL,
  signature bytea NOT NULL,
  signed_hash char(64) NOT NULL CHECK (signed_hash ~ '^[0-9a-f]{64}$'),
  signed_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, report_id, key_id),
  FOREIGN KEY (organization_id, report_id)
    REFERENCES rampspec.reports(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE rampspec.commitments (
  id text PRIMARY KEY CHECK (id ~ '^commitment_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  report_id text NOT NULL,
  network text NOT NULL,
  contract_id text NOT NULL,
  transaction_hash char(64),
  commitment_hash char(64) NOT NULL CHECK (commitment_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  FOREIGN KEY (organization_id, report_id)
    REFERENCES rampspec.reports(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE rampspec.schedules (
  id text PRIMARY KEY CHECK (id ~ '^schedule_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  target_id text NOT NULL,
  suite_id text NOT NULL,
  suite_version text NOT NULL,
  cron_expression text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES rampspec.projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, target_id)
    REFERENCES rampspec.targets(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, suite_id, suite_version)
    REFERENCES rampspec.suite_versions(organization_id, suite_id, version) ON DELETE RESTRICT
);

CREATE TABLE rampspec.integrations (
  id text PRIMARY KEY CHECK (id ~ '^integration_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('github', 'webhook', 'slack')),
  configuration jsonb NOT NULL CHECK (octet_length(configuration::text) <= 32768),
  secret_reference_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE TABLE rampspec.deliveries (
  id text PRIMARY KEY CHECK (id ~ '^delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  run_id text NOT NULL,
  event_type text NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('pending', 'delivered', 'failed', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, integration_id)
    REFERENCES rampspec.integrations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, run_id)
    REFERENCES rampspec.runs(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE rampspec.audit_events (
  id text PRIMARY KEY CHECK (id ~ '^audit_event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'service_account', 'system')),
  actor_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  request_id text NOT NULL,
  trace_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(metadata::text) <= 32768),
  metadata_hash char(64) NOT NULL CHECK (metadata_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION rampspec.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only records cannot be changed' USING ERRCODE = '55000';
END
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'run_events', 'findings', 'finding_triage_events', 'protocol_exchanges',
    'ledger_observations', 'report_signatures', 'audit_events'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON rampspec.%I FOR EACH ROW EXECUTE FUNCTION rampspec.reject_append_only_mutation()',
      table_name,
      table_name
    );
  END LOOP;
END
$$;

CREATE FUNCTION rampspec.protect_finalized_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('finalized', 'signed') THEN
    IF TG_OP = 'UPDATE'
       AND OLD.status = 'finalized'
       AND NEW.status = 'signed'
       AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'finalized records are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER artifacts_finalized_immutable
BEFORE UPDATE OR DELETE ON rampspec.artifacts
FOR EACH ROW EXECUTE FUNCTION rampspec.protect_finalized_record();
CREATE TRIGGER reports_finalized_immutable
BEFORE UPDATE OR DELETE ON rampspec.reports
FOR EACH ROW EXECUTE FUNCTION rampspec.protect_finalized_record();

CREATE FUNCTION rampspec.protect_run_configuration()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id <> OLD.organization_id
     OR NEW.project_id <> OLD.project_id
     OR NEW.target_id <> OLD.target_id
     OR NEW.suite_id <> OLD.suite_id
     OR NEW.suite_version <> OLD.suite_version
     OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.effective_config_hash <> OLD.effective_config_hash
     OR NEW.effective_config <> OLD.effective_config THEN
    RAISE EXCEPTION 'effective run configuration is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER runs_configuration_immutable
BEFORE UPDATE ON rampspec.runs
FOR EACH ROW EXECUTE FUNCTION rampspec.protect_run_configuration();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'runs', 'run_events', 'run_attempts', 'run_steps', 'artifacts', 'findings',
    'finding_triage_events', 'protocol_exchanges', 'ledger_observations',
    'reports', 'report_signatures', 'commitments', 'schedules', 'integrations',
    'deliveries', 'audit_events'
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
