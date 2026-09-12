# Disaster Recovery

1. Declare the incident and freeze new run creation.
2. Provision the approved production image by immutable digest.
3. Restore PostgreSQL from the latest verified backup and apply migrations with `pnpm db:migrate`.
4. Validate the backup manifest checksum before restoring object storage.
5. Restore evidence objects, then verify content hashes and retention metadata.
6. Restore Temporal namespace configuration and resume workers only after database readiness is green.
7. Run tenant-isolation, health, and contract checks against the restored environment.
8. Resume traffic gradually and monitor failed runs, webhook retries, and database error rates.

Rollback if checksum validation fails, readiness remains false, or any cross-tenant read is observed. Preserve the failed environment and audit records for investigation.
