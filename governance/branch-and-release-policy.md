# Branch and Release Policy

## Protected default branch

The `main` branch is the release source. Organization administrators should require pull requests, current required checks, resolved review conversations, CODEOWNER approval for sensitive paths, and linear history. Direct pushes and force pushes should be disabled except for a documented emergency performed by an organization owner.

## Pull request requirements

Every change must be independently reviewable and include focused tests, exact validation results, migration and security impact, and cross-repository compatibility notes. Changes to authentication, tenant isolation, secrets, runners, signing, policy, migrations, public contracts, or evidence retention require an explicit specialist review.

## Releases

Backend releases use semantic version tags. A release candidate must be built from a clean protected-branch commit and include checksums, an SBOM, provenance, migration notes, public interface artifacts, and an evidence statement distinguishing local, testnet, and pubnet verification. Stable tags are immutable.

## Emergencies

An emergency change must be the smallest viable fix, record who authorized it and why normal controls could not be used, pass all available checks, and receive retrospective review. Emergency access must not be used to suppress a failed security control.
