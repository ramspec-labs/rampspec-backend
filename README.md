# RampSpec Backend

RampSpec is a continuous SEP conformance and anchor interoperability lab for Stellar. This repository owns the control plane, workflow orchestration, runners, protocol adapters, evidence processing, reports, and backend SDK and CLI sources.

RampSpec produces conformance results, evidence reports, and verified runs. It is not an official Stellar Development Foundation certification service, a security audit, legal advice, or regulatory approval.

## Repository status

The backend is under active construction. Features and releases distinguish fixture validation, local execution, controlled testnet verification, and pubnet deployment. A passing local test is not evidence of a live network deployment.

## Repository boundary

- `rampspec-backend` owns OpenAPI, JSON Schemas, protocol rules, scenarios, reports, CLI behavior, workflow services, runners, and backend SDK sources.
- `rampspec-contracts` owns contract source, generated bindings, WASM hashes, and deployment manifests.
- `rampspec-frontend` owns application behavior and UI implementation.
- `rampspec-docs` owns authored guides, documentation navigation, and versioned documentation releases.

Cross-repository interfaces are consumed from tagged releases. Do not manually copy or redefine generated contracts.

## Local development

The pinned Node.js and pnpm workspace, application entry points, and quality commands are introduced in the next implementation unit. Until then, this commit contains governance and repository policy only.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing, [SECURITY.md](SECURITY.md) before reporting a vulnerability, and [governance/branch-and-release-policy.md](governance/branch-and-release-policy.md) before preparing a release.

## License

Licensed under the [Apache License 2.0](LICENSE).
