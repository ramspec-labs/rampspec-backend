-- rampspec:transaction required
ALTER TABLE rampspec.deliveries
  ADD COLUMN replayed_from_id text REFERENCES rampspec.deliveries(id) ON DELETE RESTRICT,
  ADD COLUMN attempt_lineage_id text,
  ADD COLUMN dead_letter_at timestamptz;

UPDATE rampspec.deliveries SET attempt_lineage_id = id;

ALTER TABLE rampspec.deliveries
  ALTER COLUMN attempt_lineage_id SET NOT NULL,
  ADD CONSTRAINT deliveries_dead_letter_at_check
    CHECK ((status = 'dead_letter') = (dead_letter_at IS NOT NULL));

CREATE INDEX deliveries_replayed_from_idx
  ON rampspec.deliveries (replayed_from_id);

CREATE INDEX deliveries_dead_letter_idx
  ON rampspec.deliveries (organization_id, created_at)
  WHERE status = 'dead_letter';
