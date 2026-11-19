-- rampspec:transaction required
CREATE TABLE rampspec.schedule_misfires (
  id text PRIMARY KEY CHECK (id ~ '^misfire_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  schedule_id text NOT NULL CHECK (schedule_id ~ '^[a-z][a-z0-9_-]{2,63}$'),
  misfire_policy text NOT NULL CHECK (misfire_policy IN ('skip', 'run-once', 'catch-up')),
  missed_occurrences integer NOT NULL CHECK (missed_occurrences >= 0),
  executions_due integer NOT NULL CHECK (executions_due >= 0),
  capped boolean NOT NULL DEFAULT false,
  recovered_at timestamptz NOT NULL DEFAULT now(),
  CHECK (executions_due <= missed_occurrences),
  CHECK (misfire_policy <> 'skip' OR executions_due = 0),
  CHECK (misfire_policy <> 'run-once' OR executions_due <= 1),
  CHECK (misfire_policy <> 'catch-up' OR executions_due <= 10)
);

CREATE INDEX schedule_misfires_organization_schedule_idx
  ON rampspec.schedule_misfires(organization_id, schedule_id, recovered_at);

ALTER TABLE rampspec.schedule_misfires ENABLE ROW LEVEL SECURITY;
ALTER TABLE rampspec.schedule_misfires FORCE ROW LEVEL SECURITY;
CREATE POLICY schedule_misfires_tenant ON rampspec.schedule_misfires
  USING (organization_id = rampspec.current_organization_id())
  WITH CHECK (organization_id = rampspec.current_organization_id());
