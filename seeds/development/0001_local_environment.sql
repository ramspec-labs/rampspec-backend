-- rampspec:transaction required
INSERT INTO rampspec.system_metadata (key, value)
VALUES ('environment', '{"kind":"development","synthetic":true}'::jsonb)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
