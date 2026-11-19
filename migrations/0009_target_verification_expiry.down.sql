-- rampspec:transaction required
ALTER TABLE rampspec.target_verifications
  DROP CONSTRAINT target_verifications_verified_before_expiry_check;

DROP INDEX rampspec.target_verifications_pending_expiry_idx;
DROP INDEX rampspec.target_verifications_one_pending_idx;
