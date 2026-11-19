-- rampspec:transaction required
DROP INDEX IF EXISTS rampspec.deliveries_dead_letter_idx;
DROP INDEX IF EXISTS rampspec.deliveries_replayed_from_idx;

ALTER TABLE rampspec.deliveries
  DROP CONSTRAINT IF EXISTS deliveries_dead_letter_at_check,
  DROP COLUMN IF EXISTS replayed_from_id,
  DROP COLUMN IF EXISTS attempt_lineage_id,
  DROP COLUMN IF EXISTS dead_letter_at;
