-- rampspec:transaction required
CREATE TABLE rampspec.webhook_circuit_breakers (
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('closed', 'half-open', 'open')),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  window_started_at timestamptz,
  opened_at timestamptz,
  last_failure_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, integration_id),
  FOREIGN KEY (organization_id, integration_id)
    REFERENCES rampspec.integrations(organization_id, id) ON DELETE CASCADE
);
