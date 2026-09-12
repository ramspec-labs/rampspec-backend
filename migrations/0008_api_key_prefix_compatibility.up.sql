-- rampspec:transaction required
ALTER TABLE rampspec.api_keys
  DROP CONSTRAINT api_keys_key_prefix_check;

ALTER TABLE rampspec.api_keys
  ADD CONSTRAINT api_keys_key_prefix_check
  CHECK (key_prefix ~ '^rsk_[A-Za-z0-9_-]{12}$');
