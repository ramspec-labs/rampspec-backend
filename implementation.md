# RampSpec Backend Implementation Plan

## Purpose

This plan delivers the complete RampSpec control plane, protocol engine, workers, CLI, local runner, persistence, reporting, integrations, infrastructure, and operations described in `RAMPSPEC_FULL_PROJECT_DOCUMENTATION.md`. It is a production plan, not an MVP plan.

The backend owns authoritative schemas, policies, workflow state, protocol execution, scoring, evidence preparation, and hosted operations. It must not own the product UI, Soroban source code, or the long-form documentation site.

## Execution Rules

- Complete one independently reviewable outcome per phase and include focused automated tests.
- Publish OpenAPI and JSON Schemas from tagged releases; downstream repositories consume them without manual edits.
- Pin every SEP rule to an upstream version, commit, section, and content hash.
- Keep workflow code deterministic; all network, storage, time, and random behavior belongs in activities.
- Use synthetic data only. Treat real identity documents, bank credentials, and customer records as prohibited input.
- Testnet is the default for mutations. Pubnet submission remains globally disabled until every activation control is satisfied.
- Keep local/mock, testnet, pubnet observation, and pubnet submission evidence explicitly distinct.
- A phase is complete only after migrations, contracts, error behavior, authorization, audit events, and relevant failure paths are tested.

## Phase 01 - Repository and Governance Foundation

**Outcome:** An independent backend repository is ready for public development.

**Parts:** Initialize the repository, Apache-2.0 license, README, security/contribution/conduct/maintainer files, issue templates, ADR location, and protected-branch/release policy.

**Depends on:** RampSpec name and organization confirmation.

**Exit check:** Governance, ownership boundary, security reporting, and local setup entry points are discoverable.

## Phase 02 - Workspace and Toolchain

**Outcome:** The TypeScript workspace builds reproducibly.

**Parts:** Pin Node active LTS and `pnpm`; create strict workspace configuration; scaffold API, scheduler, workflow, browser, report, evidence, webhook, gateway, and CLI applications plus shared packages.

**Depends on:** Phase 01.

**Exit check:** Clean install, lint, typecheck, unit test, and build pass from the lock file.

## Phase 03 - CI and Supply-Chain Gates

**Outcome:** Pull requests and releases receive complete baseline checks.

**Parts:** Add quality jobs, dependency and license review, secret scanning, SAST, container scanning, SBOM, provenance, signed artifacts, and generated-file drift checks.

**Depends on:** Phase 02.

**Exit check:** A sample release candidate produces traceable packages and images.

## Phase 04 - Configuration Contract

**Outcome:** Every application fails closed on invalid configuration.

**Parts:** Define and validate `APP_*`, database, Temporal, Redis, object storage, OIDC, KMS, runner, Stellar, evidence, GitHub, and telemetry groups; reject unknown network passphrases and committed secrets.

**Depends on:** Phase 02.

**Exit check:** Valid, missing, conflicting, and wrong-network configurations are tested per application.

## Phase 05 - Domain Primitives

**Outcome:** Stable identifiers, timestamps, money, Stellar assets, networks, origins, and error types are shared safely.

**Parts:** Implement opaque IDs, UTC serialization, decimal amounts without floats, StrKey/network validation, normalized origins, RFC 9457 problems, and domain error mapping.

**Depends on:** Phase 02.

**Exit check:** Boundary, serialization, Unicode, precision, and invalid-value tests pass.

## Phase 06 - OpenAPI Foundation

**Outcome:** `/v1` has a generated, testable public contract.

**Parts:** Configure OpenAPI 3.1, request IDs, organization authorization, opaque cursor pagination, standard problem details, UTC timestamps, and idempotency headers.

**Depends on:** Phase 05.

**Exit check:** The generated document validates and request/response contract tests pass.

## Phase 07 - JSON Schema Foundation

**Outcome:** Rule, scenario, suite lock, event, and report formats have independent versioned schemas.

**Parts:** Create JSON Schema 2020-12 packages, stable schema IDs, compatibility rules, fixtures, code generation, and release exports.

**Depends on:** Phase 05.

**Exit check:** Valid and invalid corpora produce deterministic cross-runtime results.

## Phase 08 - Database Migration Framework

**Outcome:** PostgreSQL schema evolution is repeatable and reversible by policy.

**Parts:** Add migration tooling, checksums, transaction rules, seed strategy, migration locks, test databases, and upgrade tests from every supported release.

**Depends on:** Phase 04.

**Exit check:** Empty install, forward migration, restart, rollback/forward-fix procedure, and drift detection pass.

## Phase 09 - Tenant and Identity Tables

**Outcome:** Users, organizations, memberships, service accounts, and API keys persist with tenant context.

**Parts:** Add constraints, direct or enforced organization ownership, statuses, timestamps, hashed key material, expiry, and row-level-security defense in depth.

**Depends on:** Phase 08.

**Exit check:** Database constraints prevent orphaned, duplicate, or cross-tenant records.

## Phase 10 - Project and Target Tables

**Outcome:** Projects, targets, verifications, assets, corridors, and secret references persist safely.

**Parts:** Add normalized-origin uniqueness, network configuration, archive states, verification expiry, asset identifiers, corridor metadata, and secret metadata without values.

**Depends on:** Phase 09.

**Exit check:** Constraints and tenant-scoped repository tests pass.

## Phase 11 - Spec and Suite Tables

**Outcome:** Immutable protocol snapshots and executable definitions have durable storage.

**Parts:** Add spec snapshots, rule packs, rules, suites, suite versions, scenarios, upstream pointers, content/manifest/lock hashes, and lifecycle states.

**Depends on:** Phase 08.

**Exit check:** Published versions are immutable and hashes are uniqueness-protected.

## Phase 12 - Run and Evidence Tables

**Outcome:** Durable execution and immutable evidence have a complete relational model.

**Parts:** Add runs, attempts, steps, findings, triage, exchanges, ledger observations, artifacts, reports, signatures, commitments, schedules, integrations, deliveries, and audit events.

**Depends on:** Phases 09-11.

**Exit check:** Append-only and finalized-report mutation constraints are tested.

## Phase 13 - Web Identity and Sessions

**Outcome:** Users authenticate through an established identity provider.

**Parts:** Implement auth exchange, secure sessions, renewal, logout, optional SSO/MFA claims, revocation, CSRF protection, and privacy-safe audit events.

**Depends on:** Phases 06 and 09.

**Exit check:** Success, expiry, replay, revoked identity, CSRF, and provider-failure tests pass.

## Phase 14 - Roles and Authorization

**Outcome:** Owner, Admin, Maintainer, Runner, Auditor, and Viewer permissions are enforced centrally.

**Parts:** Implement organization context, resource ownership checks, raw-artifact permission, destructive-action rules, emergency access, and reusable authorization policies.

**Depends on:** Phase 13.

**Exit check:** Full action-by-role and cross-tenant denial matrices pass.

## Phase 15 - Service Accounts and API Keys

**Outcome:** Automation uses scoped, expiring credentials.

**Parts:** Implement service accounts, one-time key creation, prefix and secret hash, scopes, expiry, last-use, rotation, disablement, and rate limits.

**Depends on:** Phase 14.

**Exit check:** Plaintext keys are never persisted or returned after creation.

## Phase 16 - Audit Service

**Outcome:** Security-relevant user and system actions are append-only and queryable.

**Parts:** Record actor, tenant, action, target, request/trace IDs, and metadata hash; add retention and auditor access; forbid secrets and prohibited data.

**Depends on:** Phases 12 and 14.

**Exit check:** Tamper, omission, cross-tenant read, and sensitive-field tests pass.

## Phase 17 - Organization APIs

**Outcome:** Organization, membership, invitation, policy, and audit endpoints implement the public contract.

**Parts:** Add list/create/get/update, invitations, role changes, member removal, last-owner protection, retention/signing/pubnet policy, and pagination.

**Depends on:** Phases 14-16.

**Exit check:** OpenAPI and authorization tests cover every endpoint and failure.

## Phase 18 - Project APIs

**Outcome:** Project lifecycle endpoints are production-ready.

**Parts:** Implement list/create/get/update/delete/archive semantics, policy binding, cursor pagination, conflict handling, and audit events.

**Depends on:** Phases 10 and 14-16.

**Exit check:** Persistence, idempotency, authorization, pagination, and archive tests pass.

## Phase 19 - Target and Corridor APIs

**Outcome:** Targets, assets, networks, rails, and corridors can be configured without unsafe ambiguity.

**Parts:** Implement CRUD/read models, normalized origin rules, custom-network validation, expected SEP/assets/methods, runner policy, and archive behavior.

**Depends on:** Phase 18.

**Exit check:** Duplicate, wrong-network, invalid asset, forbidden origin, and cross-tenant tests pass.

## Phase 20 - Target Ownership Challenges

**Outcome:** Active testing is gated by current target control.

**Parts:** Implement high-entropy DNS TXT and well-known file challenges, hash storage, expiry, replay prevention, verification, renewal, and ownership audit history.

**Depends on:** Phase 19.

**Exit check:** Both methods pass success, timeout, replay, content mismatch, DNS change, and expiry tests.

## Phase 21 - Secret Reference Service

**Outcome:** Secret values enter only a dedicated encrypted write path.

**Parts:** Implement KMS/Vault envelope adapters, metadata-only reads, provider scopes, rotation, deletion, last-use, local-provider handles, and access audit.

**Depends on:** Phases 14 and 19.

**Exit check:** API, database, logs, traces, and errors contain no submitted plaintext value.

## Phase 22 - Upstream SEP Snapshot Importer

**Outcome:** The engine can pin and reproduce exact upstream specifications.

**Parts:** Fetch allowed upstream repositories, record SEP metadata/commit/content SHA-256/status/version, normalize content, detect changes, and retain immutable snapshots.

**Depends on:** Phases 07 and 11.

**Exit check:** Re-import is idempotent and altered upstream content produces a reviewable diff.

## Phase 23 - Specification Diff and Advisory Workflow

**Outcome:** Rule-impacting SEP changes cannot enter silently.

**Parts:** Classify added/changed/deprecated/removed requirements, generate migration notes, flag draft/FCP status, expose diffs, and require protocol-maintainer approval.

**Depends on:** Phase 22.

**Exit check:** Known snapshot pairs produce stable, reviewed impact output.

## Phase 24 - Rule-Pack Registry

**Outcome:** Executable rules have stable identity and provenance.

**Parts:** Implement signed manifests, classifications, severity rationale, upstream pointers, implementation hashes, compatibility, deprecation, and semantic versions.

**Depends on:** Phase 23.

**Exit check:** Duplicate IDs, missing citations, invalid signatures, and incompatible packs fail closed.

## Phase 25 - Assertion Engine

**Outcome:** Rules return normalized findings without conflating classifications.

**Parts:** Implement passed/failed/warning/skipped/not-applicable statuses, severities, evidence references, remediation references, and exact upstream metadata.

**Depends on:** Phase 24.

**Exit check:** Each rule requires passing and failing fixtures plus branch coverage before acceptance.

## Phase 26 - Scenario Schema

**Outcome:** Declarative YAML scenarios accept only bounded behavior.

**Parts:** Define metadata, networks, SEP/capability requirements, typed parameters, fixtures, steps, dependencies, conditionals, matrices, retries, cleanup, secret references, and policy.

**Depends on:** Phase 07.

**Exit check:** Arbitrary code, shell commands, cycles, unbounded retries, and unrestricted destinations are rejected.

## Phase 27 - Scenario Compiler

**Outcome:** Valid scenarios compile into deterministic workflow graphs.

**Parts:** Parse safely, resolve step adapters, validate dependencies/capabilities, expand bounded matrices, attach cleanup, and produce a canonical definition hash.

**Depends on:** Phases 25-26.

**Exit check:** Repeated compilation is byte-identical and malicious corpus tests fail closed.

## Phase 28 - Suite Registry and Locks

**Outcome:** Suites and release policies become immutable executable versions.

**Parts:** Implement suite/scenario APIs, new versions, locks, parameter defaults, rule selection, baseline binding, lifecycle, and semantic compatibility.

**Depends on:** Phase 27.

**Exit check:** A locked suite cannot change and reproduces the same lock hash.

## Phase 29 - Policy Engine

**Outcome:** Safety and release rules are evaluated consistently.

**Parts:** Implement target ownership, mode/network, runner capabilities, asset/destination/amount limits, severity gates, draft-rule opt-in, coverage, exceptions, quotas, and kill switches.

**Depends on:** Phases 20, 24, and 28.

**Exit check:** Request-time and pre-signing evaluations share vectors and fail closed on indeterminate input.

## Phase 30 - Temporal Foundation

**Outcome:** Durable workflows can be started, replayed, and observed.

**Parts:** Configure namespaces, task queues, deterministic codecs, workflow/activity boundaries, retry policies, timeouts, search attributes, and signed tenant context.

**Depends on:** Phases 04 and 12.

**Exit check:** Worker restart and history replay preserve identical decisions.

## Phase 31 - Run Creation and Effective Configuration

**Outcome:** `POST /v1/runs` validates and freezes the complete run input.

**Parts:** Resolve project, target, suite, runner, parameters, credentials, baseline, policy, and idempotency key; store one immutable effective configuration hash.

**Depends on:** Phases 21, 28-30.

**Exit check:** Parallel duplicate requests create one logical run and changed suites cannot affect it.

## Phase 32 - Run State Machine

**Outcome:** Requested through terminal states have exact semantics.

**Parts:** Implement policy_check, queued, provisioning, running, waiting_external, finalizing, completed, failed, blocked, cancelled, and expired transitions plus attempts.

**Depends on:** Phase 31.

**Exit check:** Invalid transitions fail and completed runs may correctly contain conformance failures.

## Phase 33 - Cancellation, Retry, and Teardown

**Outcome:** Interrupted work remains safe and auditable.

**Parts:** Add cooperative cancellation, bounded forced cancellation, new retry attempts, compensation/cleanup, fixture deletion evidence, and terminal-reason classification.

**Depends on:** Phase 32.

**Exit check:** Cancellation and retry never rewrite prior events or evidence.

## Phase 34 - Runner Registration Protocol

**Outcome:** Public and local runners establish rotatable workload identities.

**Parts:** Implement one-time registration tokens, mTLS enrollment, organization/project binding, capability/version negotiation, heartbeat, health, rotation, revocation, leases, and upgrades.

**Depends on:** Phases 15 and 30.

**Exit check:** Expired token, stolen token, replay, revoked identity, stale heartbeat, and incompatible version tests pass.

## Phase 35 - Public Runner Job Isolation

**Outcome:** Each hosted job runs in a constrained disposable environment.

**Parts:** Create non-root read-only images, dropped capabilities, resource/time/process/disk quotas, short-lived credentials, isolated browser profiles, scoped upload, teardown evidence, and signed images.

**Depends on:** Phase 34.

**Exit check:** Sandbox and cleanup tests prove jobs cannot persist or access another run.

## Phase 36 - SSRF and Egress Enforcement

**Outcome:** User-controlled destinations cannot reach forbidden networks.

**Parts:** Canonicalize origins; reject credentials/schemes/ports/ambiguous encoding; resolve A/AAAA; classify addresses; pin DNS; revalidate redirects/refreshes; enforce host-port egress; block metadata/private ranges.

**Depends on:** Phase 35.

**Exit check:** IPv4, IPv6, redirect, DNS-rebinding, CGNAT, link-local, documentation, and cloud-metadata corpora pass.

## Phase 37 - Local Runner Core

**Outcome:** Private targets can be tested without inbound connectivity.

**Parts:** Implement outbound-only mTLS control channel, allowlisted jobs/targets, ephemeral workspaces, heartbeat, health, version, revocation, and encrypted result upload.

**Depends on:** Phase 34.

**Exit check:** No inbound port is required and revoke stops new leases immediately.

## Phase 38 - Local Secrets and Offline Export

**Outcome:** Customer credentials and traffic can remain inside their environment.

**Parts:** Add local secret-provider interface, Vault adapter, local signing, pre-upload redaction, encrypted bundles, air-gapped execution, offline report export, and import verification.

**Depends on:** Phases 21 and 37.

**Exit check:** Control-plane captures prove secret values and raw private traffic never leave the runner.

## Phase 39 - Redaction and Data Classification

**Outcome:** All evidence is classified before logging or storage.

**Parts:** Implement field/media allowlists, SEP-9 classes, URL/header/body/multipart/XDR rules, versioned redaction, prohibited-data detection, quarantine, and incident signals.

**Depends on:** Phase 07.

**Exit check:** Redaction and bypass corpora pass with no PII or secret escape.

## Phase 40 - Synthetic Fixture Generator

**Outcome:** Repeatable natural-person, organization, file, classic, muxed, memo, and contract-account fixtures are available.

**Parts:** Use controlled/reserved destinations, obvious test markers, bounded lifetimes, deterministic seeds where safe, prohibited-data scans, and teardown metadata.

**Depends on:** Phase 39.

**Exit check:** Fixtures satisfy released schemas and never reuse production records or real identifiers.

## Phase 41 - Stellar Transaction Safety Pipeline

**Outcome:** Build, simulate, verify, sign, and submit are separate audited operations.

**Parts:** Validate passphrase, destination, asset, amount, memo, time bounds, fee, operation count, auth entries, policy, limits, and signer location immediately before signing.

**Depends on:** Phases 29, 34, and Stellar SDK package.

**Exit check:** Wrong network, changed transaction, excess amount, unknown asset, and disabled-pubnet attempts fail before signing.

## Phase 42 - Horizon and RPC Observation

**Outcome:** Ledger effects are correlated accurately without assuming success.

**Parts:** Query Horizon/RPC; correlate hash, destination, asset, amount, memo, operation, ledger, finality, and network; classify not-found, lag, reorg, timeout, and outage.

**Depends on:** Phase 41.

**Exit check:** Controlled local/testnet and outage fixtures pass with explicit evidence labels.

## Phase 43 - SEP-1 Discovery Adapter

**Outcome:** Discovery validates the complete pinned SEP-1 surface.

**Parts:** Normalize domain; enforce HTTPS/redirect policy; fetch only the well-known TOML; validate status, CORS, media type, size, syntax, duplicates, URLs, addresses, assets, organization/account relationships, endpoint reachability, and coherence.

**Depends on:** Phases 22-25 and 36.

**Exit check:** Minimal/complete valid, malformed, boundary, deprecated, Anchor Platform, redaction, and report fixtures pass.

## Phase 44 - SEP-10 Challenge Validation

**Outcome:** Classic authentication challenges are rejected unless independently safe.

**Parts:** Support G/M accounts, memos, client domains, signer thresholds, funded/unfunded fixtures; verify source, sequence zero, time bounds, order, nonce, domains, and server signature before signing.

**Depends on:** Phases 40-41 and SEP-10 rule pack.

**Exit check:** Malformed, expired, replayed, over-signed, under-threshold, memo, muxed, and domain cases pass.

## Phase 45 - SEP-10 Token Validation

**Outcome:** Returned authentication tokens are fully verified.

**Parts:** Validate signature plus issuer, subject, audience, issued-at, expiry, memo/muxed identity, client domain, scopes, and replay policy; destroy fixture signing material on expiry.

**Depends on:** Phase 44.

**Exit check:** Valid and every invalid JWT claim/signature vector pass.

## Phase 46 - SEP-45 Authorization Inspection

**Outcome:** Contract-account challenges permit only the pinned expected invocation.

**Parts:** Discover endpoint/contract ID; inspect authorization entries; require `web_auth_verify`; validate arguments/domains/server/client account; reject hidden sub-invocations; validate simulation footprint.

**Depends on:** Phases 40-42 and tagged fixture contracts.

**Exit check:** Valid, malformed, wrong-contract, extra-invocation, expired, and footprint vectors pass.

## Phase 47 - SEP-45 Signature and Token Journey

**Outcome:** Draft contract authentication is tested end to end with explicit labels.

**Parts:** Exercise successful, rejected, replayed, nonce, policy-wallet, and malformed signatures; compare classic and contract auth; validate returned token claims; bind results to the pinned draft version.

**Depends on:** Phase 46.

**Exit check:** Local and testnet fixture journeys produce decoded authorization evidence without overstating draft coverage.

## Phase 48 - SEP-9 Synthetic Field Module

**Outcome:** KYC field values are schema-valid and classified before transport.

**Parts:** Implement natural-person/organization formats, encodings, locale variants, binary test documents, field metadata, prohibited patterns, and redaction classes.

**Depends on:** Phases 39-40.

**Exit check:** Valid, invalid, boundary, and prohibited-data corpora pass.

## Phase 49 - SEP-12 Customer Query and Update

**Outcome:** Customer field discovery and lifecycle updates conform to pinned SEP-12.

**Parts:** Implement required-field query, JSON/form/multipart updates, customer ID/account/memo/type/transaction/language semantics, and idempotent changes.

**Depends on:** Phases 45 and 48.

**Exit check:** Natural-person, organization, shared-account memo, encoding, and documented error fixtures pass.

## Phase 50 - SEP-12 Files, Status, Callbacks, and Deletion

**Outcome:** Sensitive lifecycle edges are reproducible and cleaned up.

**Parts:** Implement generated file upload, NEEDS_INFO/PROCESSING/ACCEPTED/REJECTED states, callback behavior, deletion, deprecated endpoint checks, teardown proof, and retained-hash-only policy.

**Depends on:** Phase 49 and callback service.

**Exit check:** Files and payloads are deleted or expired and never remain in long-term logs.

## Phase 51 - Callback Receiver

**Outcome:** Run-scoped callbacks signal workflows durably and safely.

**Parts:** Add high-entropy expiring URLs, media types, optional signature verification, canonical redacted body/hash, size/deadline limits, duplicate detection, workflow signals, and audited replay.

**Depends on:** Phases 30, 32, and 39.

**Exit check:** Expired, duplicate, oversized, unexpected, invalid-signature, replay, and retry tests pass.

## Phase 52 - SEP-6 Information and Deposit

**Outcome:** Same-asset and cross-asset deposit journeys are covered.

**Parts:** Validate info by asset/method, auth modes, initiation, KYC, quote references, non-equivalent assets, amounts, fees, accounts, memos, statuses, boundaries, duplicates, and expired quotes.

**Depends on:** Phases 42, 45, 49, and SEP-38 where cross-asset.

**Exit check:** Golden and Anchor Platform fixtures plus controlled testnet deposit paths pass.

## Phase 53 - SEP-6 Withdrawal, History, and Refunds

**Outcome:** Withdrawal and transaction-history behavior is fully correlated.

**Parts:** Implement initiation, payment instructions, history/transaction schemas, ledger correlation, refunds, status progression, invalid assets/methods, late/duplicate behavior, and deprecated interactive labeling.

**Depends on:** Phase 52.

**Exit check:** Same/cross-asset success and all documented negative states pass.

## Phase 54 - Isolated Browser Worker

**Outcome:** SEP-24 browser automation runs in a disposable constrained context.

**Parts:** Build pinned Playwright image, per-run profile, navigation origin allowlist, download/upload policy, synthetic input adapter, screenshot suppression, trace limits, mobile/desktop/locale profiles, and teardown.

**Depends on:** Phases 35-36 and 39-40.

**Exit check:** Origin escape, popup, timeout, sensitive step, quota, and cleanup tests pass.

## Phase 55 - SEP-24 Deposit Browser Journey

**Outcome:** Hosted deposit behavior correlates browser, API, callback, and ledger states.

**Parts:** Validate info/initiation, open interactive URL, fill approved fields, handle popup/return URL/cancel/timeout, protect tokens, poll transaction/history, and correlate ledger completion.

**Depends on:** Phases 42, 51, and 54.

**Exit check:** Controlled Anchor Platform testnet deposit generates complete redacted evidence.

## Phase 56 - SEP-24 Withdrawal Browser Journey

**Outcome:** Hosted withdrawal behavior is covered independently.

**Parts:** Implement withdrawal initiation and interactive flow, payment instructions, mobile/desktop behavior, return control, cancellation, callback/status/history, and ledger correlation.

**Depends on:** Phase 55.

**Exit check:** Success, cancellation, timeout, popup, invalid token, and terminal-state fixtures pass.

## Phase 57 - SEP-38 Discovery and Prices

**Outcome:** Quote capability and indicative pricing are validated.

**Parts:** Validate asset identifiers, pairs, info/prices/price endpoints, buy/sell semantics, decimals, rounding, fees, total price, countries, and delivery method combinations.

**Depends on:** Phases 24-25 and 45.

**Exit check:** Valid, unsupported, zero, negative, precision, and boundary fixtures pass against the pinned draft.

## Phase 58 - SEP-38 Firm Quotes

**Outcome:** Firm quote creation, retrieval, expiry, and transaction linkage are reproducible.

**Parts:** Implement POST/GET quote, firm terms, expiration clocks, fee/total consistency, delivery methods, transaction link, impossible values, and reuse behavior.

**Depends on:** Phase 57.

**Exit check:** Valid, expired, altered, duplicate, and unsupported quote tests pass.

## Phase 59 - SEP-31 Customer and Transaction Creation

**Outcome:** Receive-side transactions preserve sending and receiving customer separation.

**Parts:** Authenticate sending-anchor fixture; discover fields/assets; register customer pair; attach indicative/firm quote; create transaction; validate callback configuration and response.

**Depends on:** Phases 49-51 and 58.

**Exit check:** Customer roles cannot be swapped or cross-linked and valid creation fixtures pass.

## Phase 60 - SEP-31 Settlement and Status Lifecycle

**Outcome:** A testnet payment is correlated through a valid terminal state.

**Parts:** Build/simulate/submit approved payment; match transaction/destination/asset/amount/memo; process callbacks; validate each exercised transition, finality, completed/refunded outcomes, and timeouts.

**Depends on:** Phases 42 and 59.

**Exit check:** A complete controlled testnet SEP-31 plus SEP-38 journey is reproducible.

## Phase 61 - SEP-31 Negative and Corridor Scenarios

**Outcome:** Bilateral and failure behavior is tested explicitly.

**Parts:** Add duplicate callbacks, invalid auth/customer, quote expiry, under/over/late payment, refunds, retry/idempotency, and paired local-runner corridor workflows.

**Depends on:** Phases 38 and 60.

**Exit check:** Negative corpus and one controlled two-party corridor simulation pass.

## Phase 62 - Optional SEP-34 Rule Pack

**Outcome:** Wallet attribution tests exist as opt-in experimental coverage.

**Parts:** Generate and verify JWS fixtures; validate issuer, subject, audience, key ID, transaction ID, issue time, and expiry; label upstream status and keep release blocking off by default.

**Depends on:** Phases 24-25.

**Exit check:** Valid and invalid vectors pass and disabled suites execute no SEP-34 work.

## Phase 63 - Cross-SEP Invariant Engine

**Outcome:** Complete journeys detect inconsistencies across endpoint boundaries.

**Parts:** Compare discovery, auth subject, customer identity, quote, transaction, callback, status, asset, amount, memo, and ledger data under stable invariant IDs.

**Depends on:** Phases 43-61.

**Exit check:** Seeded boundary defects produce precise findings and remediation references.

## Phase 64 - Artifact Object Storage

**Outcome:** Redacted exchanges, screenshots, traces, XDR, and reports are encrypted and bounded.

**Parts:** Implement content hash, media type, encryption reference, redaction version, tenant/run ownership, size limits, retention, legal hold, scoped pre-signed download, and audit.

**Depends on:** Phases 12, 21, and 39.

**Exit check:** Access, tamper, oversize, expiry, deletion, and cross-tenant tests pass.

## Phase 65 - Run Events and SSE

**Outcome:** Live updates are ordered, replayable, and subordinate to durable state.

**Parts:** Persist monotonic event IDs; expose SSE, heartbeats, `Last-Event-ID`, bounded retention, cursor gaps, authorization, backpressure, and terminal reconciliation.

**Depends on:** Phases 32 and 64.

**Exit check:** Fan-out, reconnect, duplicate, expiration, slow-client, and cross-tenant tests pass.

## Phase 66 - Findings, Triage, and Exceptions

**Outcome:** Rule outcomes have stable fingerprints and governed disposition.

**Parts:** Implement finding APIs, evidence references, remediation, baseline identity, triage history, owners, time-bound target/rule exceptions, expiry, and audit.

**Depends on:** Phases 25 and 63.

**Exit check:** Exceptions cannot conceal findings, cross targets, outlive expiry, or change immutable reports.

## Phase 67 - Canonical Report Builder

**Outcome:** A finalized run produces one immutable schema-valid report.

**Parts:** Assemble effective scope, target/network, suite lock, spec commits, exact counts, findings, artifacts, coverage, exceptions, runner identity, and explicit evidence labels.

**Depends on:** Phases 63-66.

**Exit check:** Infrastructure failure is indeterminate, skipped required rules fail coverage, and scores never override rule gates.

## Phase 68 - RFC 8785 Hashing and Offline Verifier

**Outcome:** Reports canonicalize and verify independently across runtimes.

**Parts:** Exclude signature fields, apply RFC 8785, hash with SHA-256, publish vectors and CLI/library verifier, and reject unsupported schema/key algorithms.

**Depends on:** Phase 67.

**Exit check:** Node and at least one independent implementation match all valid/tampered vectors.

## Phase 69 - Report Signing and Key Rotation

**Outcome:** Final reports use KMS-backed Ed25519 signatures with public history.

**Parts:** Integrate KMS/Vault, bind key ID/algorithm/time, publish verification keys, rotate and retire keys, support emergency compromise response, and audit signing.

**Depends on:** Phases 21 and 68.

**Exit check:** Valid, altered, unknown, rotated, disabled, and compromised-key scenarios pass.

## Phase 70 - Report Exports and Comparisons

**Outcome:** Derived formats and baselines remain faithful to canonical JSON.

**Parts:** Generate HTML/PDF-ready HTML, JUnit, SARIF, redacted HAR, decoded XDR summaries, coverage, and semantic report diffs; never make exports authoritative.

**Depends on:** Phase 69.

**Exit check:** Snapshot, escaping, source annotation, compatibility, and round-trip integrity tests pass.

## Phase 71 - CLI Foundation and Authentication

**Outcome:** The `rampspec` CLI has stable configuration, auth, output, and exit codes.

**Parts:** Implement login, profiles, service-account auth, human/JSON output, request IDs, update notices, and distinct success/conformance/policy/config/infrastructure/auth/cancel exit codes.

**Depends on:** Phases 06 and 15.

**Exit check:** Windows, Linux, and macOS packaging and exit-code contract tests pass.

## Phase 72 - CLI Commands and Offline Workflows

**Outcome:** Discovery, validation, runs, gates, verification, and runner startup are automatable.

**Parts:** Add target discover, scenario validate, run start/wait/cancel, report verify, CI gate, evidence lookup, runner start, offline export, and non-interactive secret handling.

**Depends on:** Phases 28, 31-33, 37-38, 68, and 70-71.

**Exit check:** Documented PowerShell and POSIX examples run in CI.

## Phase 73 - GitHub App

**Outcome:** Repositories and deployment environments map to RampSpec targets with minimal permissions.

**Parts:** Implement installation flow, signed webhook verification, repository/environment mapping, deployment triggers, check runs, report links, and optional configuration-file access only.

**Depends on:** Phases 15, 31, and 69.

**Exit check:** Forged, replayed, revoked, wrong-installation, and permission-reduction tests pass.

## Phase 74 - GitHub Checks and CI Gate Delivery

**Outcome:** A suite can block a merge with reproducible evidence.

**Parts:** Create one check per suite, baseline by branch/environment, critical/high annotations with source locations, JUnit/SARIF upload, indeterminate state, retries, and immutable report link.

**Depends on:** Phases 70 and 73.

**Exit check:** A seeded regression blocks a reference repository while platform failure never reports pass.

## Phase 75 - Scheduling Service

**Outcome:** Recurring checks start on time without duplicate runs.

**Parts:** Implement recurrence/timezone, next execution, pause/resume/delete, manual trigger, missed-run policy, idempotent dispatch, quotas, and audit.

**Depends on:** Phases 29-32.

**Exit check:** DST, clock skew, restart, duplicate scheduler, backlog, and paused schedule tests pass.

## Phase 76 - Webhooks and Notifications

**Outcome:** External consumers receive signed, bounded, retryable events.

**Parts:** Implement endpoint allowlists, signing secret rotation, delivery records, exponential backoff, idempotency, dead-letter state, test delivery, and payload redaction.

**Depends on:** Phases 16 and 36.

**Exit check:** SSRF, signature, timeout, duplicate, rotation, retry, and dead-letter tests pass.

## Phase 77 - Evidence Publication Preparation

**Outcome:** Only a verified finalized report can become a contract transaction.

**Parts:** Derive report/target/suite/spec/artifact hashes, privacy mode, protocol bitmap, counts, score, network, supersession; validate consent, attestor policy, manifest, and contract code hash.

**Depends on:** Phase 69 and tagged contracts release.

**Exit check:** Unknown code hash, unsigned report, count mismatch, private-policy denial, and wrong network block publication.

## Phase 78 - Evidence Submission and Indexing

**Outcome:** Evidence publish, supersede, revoke, lookup, and recovery are reliable.

**Parts:** Simulate, sign, submit, track ledger/finality, index contract events/records, handle duplicate/retry/reorg/outage, reconcile caches, and expose verification APIs.

**Depends on:** Phases 42 and 77.

**Exit check:** Local and testnet publication verifies independently against the canonical report.

## Phase 79 - Observability

**Outcome:** Requests and workflows are diagnosable without sensitive payloads.

**Parts:** Add OpenTelemetry traces, metrics, structured logs, request/tenant/project/target/run/workflow/runner/release/spec/suite IDs, privacy filtering, dashboards, and alerts.

**Depends on:** All runnable applications.

**Exit check:** Sensitive corpus produces no JWT, key, KYC field, body, seed, signature entry, or secret in telemetry.

## Phase 80 - Deployment Images and Helm

**Outcome:** API and worker pools deploy independently with least privilege.

**Parts:** Build hardened images and Helm releases for API, scheduler, workflow, browser, report, evidence, webhook, gateway, Redis/PostgreSQL/Temporal/object/KMS integrations, network policies, health, and scaling.

**Depends on:** Phases 03-04, 35, and 79.

**Exit check:** Development and staging deployments pass smoke, isolation, upgrade, and rollback tests.

## Phase 81 - Infrastructure as Code and Environment Separation

**Outcome:** Local, CI, development, staging, and production environments are reproducible and isolated.

**Parts:** Add Terraform/modules for CDN/API edge dependencies, private data services, object lifecycle/replication, KMS, DNS, runner namespaces, telemetry, secrets, and distinct credentials/buckets/pools.

**Depends on:** Phase 80.

**Exit check:** Plan/apply policy tests and an environment-boundary audit pass.

## Phase 82 - Backup, Restore, and Disaster Recovery

**Outcome:** Control data and immutable reports can be recovered within stated targets.

**Parts:** Add PostgreSQL PITR/daily snapshots, object replication, Temporal history plan, KMS recovery/rotation, infrastructure reconstruction, quarterly restore automation, and communication templates.

**Depends on:** Phase 81.

**Exit check:** Staging exercise measures 15-minute RPO and four-hour control-plane RTO targets without claiming unmeasured guarantees.

## Phase 83 - Security and Resilience Test Suites

**Outcome:** Cross-cutting failure modes are continuously enforced.

**Parts:** Complete tenant authz, parallel idempotency, workflow replay, cancellation, callback dedupe, SSRF, rate limit, parser fuzz, redaction, malicious artifact, RPC outage, database failover, duplicate step, and partial teardown suites.

**Depends on:** Phases 20-82.

**Exit check:** Every documented trust boundary has authentication, authorization, encryption, limits, audit, and failure tests.

## Phase 84 - Performance and Service Objectives

**Outcome:** Capacity and latency are measured against initial objectives.

**Parts:** Test API read/run-create latency, SSE delivery/fan-out, schedule punctuality, discovery duration, queue throughput, horizontal workers, reports, uploads, and bounded ingestion; separate platform/target/network failures.

**Depends on:** Phase 83.

**Exit check:** Results and capacity limits are published from staging measurements.

## Phase 85 - Operator Runbooks and Exercises

**Outcome:** Every required incident has an owner and exercised response.

**Parts:** Exercise API/database/workflow/runner/duplicate/pubnet/signing/secret/redaction/tenant/abuse/callback/RPC/network/contract/spec/dependency/GitHub/restore incidents and record communication/escalation paths.

**Depends on:** Phases 79 and 82-84.

**Exit check:** Each runbook has dated staging evidence, follow-up actions, and assigned ownership.

## Phase 86 - Self-Hosting Package

**Outcome:** Organizations can operate the control plane and runners from reviewed artifacts.

**Parts:** Package Compose for evaluation, Helm for production, configuration/schema validation, secret providers, storage/backup choices, upgrades, observability, air-gapped limitations, and compatibility checks.

**Depends on:** Phases 80-85.

**Exit check:** A clean isolated environment reaches a verified SEP-1 report using released artifacts.

## Phase 87 - Reference Environments

**Outcome:** Tests distinguish deterministic, Anchor Platform, testnet, browser, contract, and partner contexts.

**Parts:** Operate a fake anchor, pinned Anchor Platform with controlled business server, testnet deployment, local/testnet contracts, isolated browser, and optional partner staging through local runners.

**Depends on:** Protocol, runner, and infrastructure phases.

**Exit check:** Every output labels local simulation, testnet submission, pubnet observation, or pubnet submission accurately.

## Phase 88 - External Security Review Remediation

**Outcome:** Web/API, runner isolation, secrets, deletion, and operational findings are resolved.

**Parts:** Complete threat-model review, penetration test, sandbox review, secret tabletop, deletion exercise, dependency policy, disclosure process, and prioritized remediation with retests.

**Depends on:** Phases 83-87.

**Exit check:** No unresolved critical security or data-handling issue remains.

## Phase 89 - Backend Release and Compatibility Manifest

**Outcome:** The backend ships an independently versioned production release.

**Parts:** Publish OpenAPI, schemas, client package, CLI, runner images, migrations, release notes, SBOM, provenance, signed tags, compatibility/migration notes, and cross-repository manifest entries.

**Depends on:** Phases 03 and 88 plus compatible contracts/frontend/docs candidates.

**Exit check:** Staging release and oldest/newest supported-client compatibility checks pass.

## Phase 90 - Production Launch and Post-Launch Operations

**Outcome:** The production control plane supports pilots and sustained maintenance.

**Parts:** Deploy production/status page, enforce kill switches and retention, onboard two pilots, measure defects/time saved/service objectives, maintain SEP sync/dependencies/capacity/costs, rotate on-call, and schedule reviews.

**Depends on:** Phase 89 and full product readiness gate.

**Exit check:** Independently verifiable reports exist, support ownership is assigned, and no claim exceeds deployed evidence.

## Backend Completion Gate

The backend repository is complete for production only when all 90 phases are checked; all authoritative schemas and release artifacts are tagged; every supported SEP has golden valid, invalid, boundary, redaction, and normalized-report fixtures; hosted and local runner controls pass; complete SEP-6 or SEP-24 and SEP-31 plus SEP-38 testnet journeys reproduce; reports verify independently; tenant isolation, deletion, backup, restore, security, performance, and incident exercises pass; and pubnet submission remains fail-closed unless every activation condition is met.
