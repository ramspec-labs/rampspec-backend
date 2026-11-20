-- rampspec:transaction required
DROP POLICY cleanup_jobs_tenant ON rampspec.cleanup_jobs;
DROP TRIGGER cleanup_jobs_finalized_immutable ON rampspec.cleanup_jobs;
DROP FUNCTION rampspec.protect_cleanup_job_mutation();
DROP TABLE rampspec.cleanup_jobs;
