# Database Migrations

Migration files are named `NNNN_description.up.sql` and begin with either `-- rampspec:transaction required` or `-- rampspec:transaction forbidden`. Applied checksums are immutable; editing an applied file causes startup to fail.

Production is forward-only. A non-production rollback additionally requires an explicit matching `.down.sql` file and operator-selected target. Development seeds are opt-in, tracked separately, synthetic, and never run in production.

Run `pnpm db:migrate` with `DATABASE_URL` configured. After migration, development and test environments may explicitly run `pnpm db:seed`; the command refuses other environments. Database integration tests require a loopback PostgreSQL database whose name ends in `_test` through `TEST_DATABASE_URL`.
