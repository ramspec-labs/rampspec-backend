-- rampspec:transaction required
CREATE TABLE rampspec.cleanup_jobs (
  id text PRIMARY KEY CHECK (id ~ '^cleanup_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  organization_id text NOT NULL REFERENCES rampspec.organizations(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('reference_run_retention')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  retention_days integer NOT NULL CHECK (retention_days >= 1 AND retention_days <= 3650),
  deleted_count integer CHECK (deleted_count IS NULL OR deleted_count >= 0),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_message text,
  last_run_at timestamptz,
  next_run_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, job_type)
);

CREATE FUNCTION rampspec.protect_cleanup_job_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('completed', 'failed') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'finalized cleanup jobs are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER cleanup_jobs_finalized_immutable
BEFORE UPDATE OR DELETE ON rampspec.cleanup_jobs
FOR EACH ROW EXECUTE FUNCTION rampspec.protect_cleanup_job_mutation();

ALTER TABLE rampspec.cleanup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rampspec.cleanup_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY cleanup_jobs_tenant ON rampspec.cleanup_jobs
USING (organization_id = rampspec.current_organization_id())
WITH CHECK (organization_id = rampspec.current_organization_id());
