# Operator runbooks

Each incident has an owner, escalation path, dated staging exercise, and follow-up record.

- API/database/workflow outage
- Runner heartbeat loss and duplicate dispatch
- Signing, secret rotation, and redaction incident
- Evidence publication, RPC, callback, and network outage
- Dependency, GitHub integration, contract, and specification drift
- Restore and disaster-recovery exercise

## Dead-letter webhook replay

A webhook delivery that fails `MAX_DELIVERY_ATTEMPTS` (5) times is parked
in the `dead-letter` state with its exhaustion time recorded
(`deadLetterAt`). Dead-letter and delivered records are terminal: they are
never mutated, so the original delivery and its audit record stay intact.

- List dead-letter deliveries: `GET /v1/deliveries/dead-letter`.
  Requires the `delivery.read` action (owner, admin, maintainer, auditor,
  viewer).
- Inspect one delivery and its replay outcome:
  `GET /v1/deliveries/{deliveryId}`. A replay starts `pending` and moves to
  `delivered` or `failed`; a failed replay can be exhausted to dead-letter
  again and replayed under a new lineage.
- Replay a selected delivery: `POST /v1/deliveries/{deliveryId}/replay`
  (202, returns the new replay delivery). Requires the `delivery.replay`
  action (owner, admin, maintainer, or a service account holding the
  `delivery:replay` scope). Replaying a delivery that is not dead-letter
  is rejected with 409.
- Each replay starts a new attempt lineage (`attemptLineageId`) and carries
  the original `payloadHash`, so receivers deduplicate on the unchanged
  payload. The replay records `replayedFromId`; the original is untouched.
- Replays run through a bounded-concurrency queue (default 5 concurrent
  sends); further replays wait in FIFO order instead of overloading the
  receiver.
- Every replay appends a new `delivery.replay` audit event naming the
  original delivery and the new lineage. No audit event is ever edited.

Persistence: migration `0009_delivery_replay_lineage` adds
`replayed_from_id`, `attempt_lineage_id`, and `dead_letter_at` to
`rampspec.deliveries`, with indexes for dead-letter listing and replay
lookup. If a replay exhausts again, repeat the replay; if the receiver
keeps failing, treat it as a receiver outage, not a replay problem, and
do not raise the concurrency bound to compensate.
