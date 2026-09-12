# Contributing to RampSpec Backend

Backend changes must be narrowly scoped, testable, and traceable to the protocol source or architecture decision they implement.

## Before starting

1. Confirm this repository owns the requested behavior.
2. Read the relevant architecture decision and protocol source.
3. Use synthetic identities, assets, files, and transactions in tests.
4. Record whether validation is fixture-only, local, testnet, or pubnet.
5. Never commit credentials, private endpoints, customer data, identity documents, or signing material.

## Development rules

- Keep one independently reviewable outcome per pull request.
- Add focused tests for success, boundary, and failure behavior.
- Preserve tenant boundaries and fail closed on indeterminate policy decisions.
- Represent monetary values as exact decimal strings, never floating-point numbers.
- Keep control-plane services separate from isolated runner execution.
- Update generated files only through their owning generator and commit the source change with the generated diff.
- Record cross-repository dependencies and consume them from tagged releases.

## Pull requests

Complete the pull request template, list the commands that ran and their results, identify migrations and security impact, and link an issue with `Closes #<number>` when applicable. Required checks and reviews must pass before merge.

## License agreement

By contributing, you agree that your contribution is licensed under Apache-2.0 and that you have the right to submit it. RampSpec uses an inbound-equals-outbound contribution model and does not currently require a separate contributor license agreement.
