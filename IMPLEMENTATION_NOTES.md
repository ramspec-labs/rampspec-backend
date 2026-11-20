# Schedule Reference-Run Retention Cleanup - Implementation Notes

## Overview

This implementation delivers deterministic, bounded reference-run retention enforcement through scheduled cleanup operations. The solution is production-ready with comprehensive test coverage and proper observability.

## Changes Summary

### 1. Database Schema (`migrations/0009_reference_run_cleanup.up.sql`)

Added `cleanup_jobs` table to track retention cleanup operations:

- **Purpose**: Record cleanup metrics without logging evidence content
- **Key Fields**:
  - `id`: Unique cleanup job identifier
  - `organization_id`: Tenant isolation with foreign key constraint
  - `job_type`: Currently supports `reference_run_retention`
  - `status`: Pipeline state (pending → running → completed/failed)
  - `retention_days`: Snapshot of organization's retention policy
  - `deleted_count`: Count of successfully deleted runs
  - `duration_ms`: Execution time for performance monitoring
  - `error_message`: Failure summary (count-based, not content-based)
  - `next_run_at`: Determines scheduling cadence

**Immutability**:
- Finalized jobs (status='completed' or 'failed') are immutable via trigger
- Row-level security enforces organization isolation
- Supports audit trail for compliance

**Down Migration**: Properly reverses all changes including policies, triggers, and table.

### 2. Retention Planning Logic (`packages/platform/src/operations/retention.ts`)

**New Function: `planReferenceRunCleanup`**

```typescript
export function planReferenceRunCleanup(
  runs: readonly ReferenceRun[],
  retentionDays: number,
  now: Date = new Date()
): readonly string[]
```

**Behavior**:
- Accepts run collection with `state` and `createdAt`
- Filters for completed/failed runs older than retention threshold
- Validates retention days (must be positive integer, 1-3650 days)
- Returns array of expired run IDs for deletion
- Deterministic: same inputs always produce same output

**Boundary Handling**:
- Uses `<=` comparison for expiration time (inclusive boundary)
- Correctly handles millisecond precision
- Fails-safe on invalid input (throws descriptive error)

**Test Coverage**:
- Positive: selects only expired completed/failed runs
- Negative: rejects non-positive integers, floats
- Boundary: exact expiration threshold, runs created just after threshold
- Regression: existing artifact purge tests unchanged

### 3. Scheduler Service (`packages/platform/src/scheduler/service.ts`)

**New Type: `CleanupJob`**

Added interface representing scheduled cleanup work:
- Tracks organization-scoped retention parameters
- Includes execution metrics (duration, count, errors)
- Supports future job scheduling via `nextRunAt`

**Service remains deterministic**:
- `ScheduleService.create()` deterministically calculates `nextRunAt`
- Clock injection enables reproducible testing
- No behavior changes to existing schedule validation

**Test Coverage**:
- Added validation tests for schedule ID format
- Existing tests remain green
- New tests ensure restrictive validation (uppercase rejected, too-short IDs rejected)

### 4. Cleanup Service (`packages/platform/src/operations/reference-run-cleanup.ts`)

**Core Class: `ReferenceRunCleanupService`**

Orchestrates cleanup with bounded execution and safe failure handling:

```typescript
async executeCleanup(
  organization: Organization,
  maxDeletionsPerRun: number = 1000
): Promise<{
  readonly deletedCount: number;
  readonly durationMs: number;
  readonly failures: readonly CleanupFailure[];
}>
```

**Key Guarantees**:

1. **Bounded**: Respects `maxDeletionsPerRun` limit (prevents runaway deletions)
2. **Deterministic**: Same retention policy always produces same deletion plan
3. **Failure-Safe**: Individual deletion failures don't stop the job
4. **Observability**: Records counts, duration, and failure reasons (not content)
5. **Idempotent**: Deleting already-deleted runs is safe (callers should deduplicate)
6. **Tenant-Isolated**: Only operates on one organization per invocation

**Workflow**:
1. Calculate deletion deadline from organization policy
2. Query repository for expired run IDs
3. Slice to respect max deletions limit
4. Attempt deletion of each run, catching failures
5. Record job with metrics to database (no evidence content logged)
6. Return results to caller

**Failure Handling**:
- Individual deletion errors don't halt processing
- Failures recorded in result and job record
- Job status set to 'failed' if any deletions failed
- Error message summarizes: "N deletion(s) failed; M succeeded"

**Disposal Strategy**: 
- No content evidence is logged in metrics
- Only counts, durations, and error types are recorded
- Evidence deletion delegated to repository implementation

### 5. Cleanup Service Tests (`packages/platform/src/operations/reference-run-cleanup.test.ts`)

**Comprehensive Test Suite**:

- **Positive**: Deletes expired runs, records metrics correctly
- **Negative**: Handles deletion failures gracefully, tracks failures
- **Boundary**: Respects max deletions limit, calculates correct deadline
- **Integration**: Records job with organization policy, 24-hour scheduling
- **Isolation**: Uses mock repository, deterministic clock

**Test Categories**:
1. Happy path with successful deletions
2. Respecting per-run deletion limit
3. Partial failures (some runs fail, others succeed)
4. Organization policy integration (retention days)
5. Deadline calculation (now - retentionDays)
6. Next run scheduling (24 hours forward)

### 6. Retention Tests (`packages/platform/src/operations/retention.test.ts`)

**Extended Test Coverage**:

- **Existing**: Artifact purge tests unchanged
- **New**: Reference run cleanup tests with positive/negative/boundary cases
- **Focused**: Tests are deterministic and don't require external state

### 7. Scheduler Tests (`packages/platform/src/scheduler/service.test.ts`)

**Enhanced Validation**:

- Added tests for invalid schedule ID formats
- Uppercase characters correctly rejected
- IDs starting with underscore correctly rejected
- Minimum length requirement enforced
- Existing schedule functionality unchanged

### 8. Module Exports (`packages/platform/src/index.ts`)

**New Export**:
```typescript
export * from "./operations/reference-run-cleanup.js";
```

Enables imports from `@rampspec/platform` package for:
- `ReferenceRunCleanupService`
- `ReferenceRunRepository` interface
- `CleanupJobRecord` interface
- `ReferenceRunCleanupOptions` interface

## Design Decisions

### 1. Separation of Concerns

- **retention.ts**: Pure planning function (no side effects)
- **reference-run-cleanup.ts**: Service orchestration with repository pattern
- **scheduler/service.ts**: Scheduling abstraction (unchanged responsibility)

### 2. Repository Pattern

`ReferenceRunRepository` interface allows flexible implementation:
- Database-backed (production)
- In-memory (testing)
- Cloud storage backed (future)

Isolates cleanup logic from storage implementation details.

### 3. Observability Without Evidence Logging

- Records: deleted count, duration, failure count
- Does NOT record: run IDs, configurations, evidence content
- Failure messages: Generic error types, not specific content
- Audit trail: Created via database triggers/policies

### 4. Bounded Execution

- `maxDeletionsPerRun` parameter prevents resource exhaustion
- Default 1000 deletions per invocation reasonable for most deployments
- Allows incremental cleanup during off-peak hours if needed

### 5. Tenant Isolation

- All operations scoped to single organization
- Database policies enforce isolation
- No cross-tenant data leakage possible

## API Compatibility

### Preserved

- Existing `planPurge()` function unchanged
- `ScheduleService` public interface unchanged
- All existing APIs backward compatible

### Added (No Breaking Changes)

- New `planReferenceRunCleanup()` function
- New `CleanupJob` interface
- New `ReferenceRunCleanupService` class
- New export in package index

## Testing Requirements

### Unit Tests (Jest/Vitest)

```bash
npm test
```

Covers:
- Retention planning logic (boundaries, validation)
- Cleanup service (success, failures, limits)
- Scheduler service (ID validation)
- All test categories above

### Integration Tests

Database tests can be run with:
```bash
npm run test:database
```

Verifies:
- Migration applies cleanly
- Row-level security policies work
- Immutability triggers function correctly
- Cleanup job recording persists

### Build Verification

```bash
npm run build
```

Ensures:
- TypeScript compilation succeeds
- No type errors in cleanup code
- All exports available
- Tree-shaking compatible

### Linting

```bash
npm run lint
```

Verifies:
- Code style compliance
- No security issues flagged
- Documentation standards met

## Migration Strategy

1. **Deploy migration**: `npm run db:migrate`
   - Creates cleanup_jobs table
   - Enables RLS and policies
   - Creates immutability trigger

2. **Deploy service code**: Updated platform package
   - No breaking changes
   - Cleanup service available for scheduling

3. **Configure scheduler**: Operator must set up cleanup job
   - Schedule cleanup via ScheduleService
   - Configure retention days per organization
   - Set initial nextRunAt time

4. **Rollback (if needed)**:
   ```bash
   npm run db:migrate -- --target=0008
   ```
   - Uses down migration to drop cleanup_jobs table
   - No data loss (cleanup_jobs is operational, not evidence)

## Operational Considerations

### Performance

- Cleanup runs bounded to 1000 deletions per invocation
- Duration recorded for monitoring
- Can be run hourly without overload

### Monitoring

- Track `cleanup_jobs.duration_ms` for performance baseline
- Alert on `status='failed'` or `deleted_count=0` unexpected patterns
- Compare `deleted_count` with `listExpiredRuns()` to detect halting

### Deployment

- Can be deployed without service downtime
- Migration runs before service startup
- Safe to deploy multiple times (idempotent)

### Security

- Evidence content never logged
- Organization isolation enforced at database level
- Finalized jobs immutable (audit trail safe)
- No secrets handling in retention logic

## Future Work

1. **Cron Integration**: Scheduler could integrate with cron for deterministic scheduling
2. **Configurable Limits**: Organization-specific max deletion counts
3. **Metrics Export**: Prometheus/CloudWatch integration for deleted_count, duration_ms
4. **Retention Policy Versioning**: Support policy changes over time
5. **Dry-Run Mode**: Preview what would be deleted without actually deleting

## Files Modified

1. `migrations/0009_reference_run_cleanup.up.sql` - NEW
2. `migrations/0009_reference_run_cleanup.down.sql` - NEW
3. `packages/platform/src/operations/retention.ts` - MODIFIED
4. `packages/platform/src/operations/retention.test.ts` - MODIFIED
5. `packages/platform/src/operations/reference-run-cleanup.ts` - NEW
6. `packages/platform/src/operations/reference-run-cleanup.test.ts` - NEW
7. `packages/platform/src/scheduler/service.ts` - MODIFIED
8. `packages/platform/src/scheduler/service.test.ts` - MODIFIED
9. `packages/platform/src/index.ts` - MODIFIED

## Code Quality

- ✅ All public interfaces documented
- ✅ No external dependencies added
- ✅ Comprehensive test coverage (positive, negative, boundary)
- ✅ Type-safe throughout (strict TypeScript)
- ✅ Deterministic behavior verified in tests
- ✅ Authorization/tenant isolation verified
- ✅ Security: No content logging, evidence immutable
- ✅ API compatibility: No breaking changes
