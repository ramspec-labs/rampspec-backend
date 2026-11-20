-- rampspec:transaction required
-- Enforce the target ownership challenge lifetime at the storage boundary:
-- at most one pending challenge per target and method, a lookup that lets an
-- expiry sweep find pending challenges, and a guarantee that a challenge can
-- only be verified while it is still current (verified_at < expires_at).
CREATE UNIQUE INDEX target_verifications_one_pending_idx
  ON rampspec.target_verifications (organization_id, target_id, method)
  WHERE status = 'pending';

CREATE INDEX target_verifications_pending_expiry_idx
  ON rampspec.target_verifications (organization_id, expires_at)
  WHERE status = 'pending';

ALTER TABLE rampspec.target_verifications
  ADD CONSTRAINT target_verifications_verified_before_expiry_check
  CHECK (verified_at IS NULL OR verified_at < expires_at);
