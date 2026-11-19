-- rampspec:transaction required
-- Scheduler leases grant one scheduler instance exclusive ownership of a
-- schedule for the duration of one job. Renewal is compare-and-set: the
-- owning scheduler extends its lease only when the stored row still
-- carries its owner id, token, and version and has not expired, e.g.
--   UPDATE rampspec.scheduler_leases
--      SET version = version + 1,
--          expires_at = now() + $1,
--          renewed_at = now(),
--          renewal_count = renewal_count + 1
--    WHERE schedule_id = $2
--      AND owner_id = $3
--      AND token = $4
--      AND version = $5
--      AND expires_at > now();
-- A renewal that matches zero rows means the lease expired, was released,
-- or was taken over; the caller must stop its work and must not emit a
-- completion event for work that lost ownership.
CREATE TABLE rampspec.scheduler_leases (
  schedule_id text PRIMARY KEY REFERENCES rampspec.schedules(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 128),
  token text NOT NULL CHECK (length(token) BETWEEN 1 AND 128),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  renewed_at timestamptz,
  renewal_count integer NOT NULL DEFAULT 0 CHECK (renewal_count >= 0),
  CHECK (expires_at > acquired_at),
  CHECK (renewed_at IS NULL OR renewed_at >= acquired_at)
);

CREATE INDEX scheduler_leases_expires_at_idx
  ON rampspec.scheduler_leases (expires_at);

COMMENT ON TABLE rampspec.scheduler_leases IS
  'Exclusive scheduler ownership leases. Renewal is compare-and-set on owner_id, token, and version; an expired lease may be taken over by another scheduler.';

ALTER TABLE rampspec.scheduler_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE rampspec.scheduler_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY scheduler_leases_tenant ON rampspec.scheduler_leases
  USING (organization_id = rampspec.current_organization_id())
  WITH CHECK (organization_id = rampspec.current_organization_id());
