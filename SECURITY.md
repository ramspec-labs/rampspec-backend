# Security Policy

## Supported versions

RampSpec is pre-release. Only the current default branch is maintained until the first stable backend release. Supported versions and backport windows will be added when stable releases exist.

## Report a vulnerability privately

Do not open a public issue for suspected vulnerabilities, leaked secrets, exposed personal data, unauthorized target access, transaction-signing weaknesses, tenant isolation failures, or bypasses of runner network controls.

Use GitHub private vulnerability reporting for `rampspec-labs/rampspec-backend`. If that feature is unavailable, contact an organization owner through the private contact channel listed on the RampSpec Labs GitHub organization. Include affected versions, impact, reproduction steps using synthetic data, and known mitigations. Never include active credentials or test systems you do not own.

The team will acknowledge a report within three business days, determine severity and repository ownership, coordinate affected repositories, and publish an advisory when disclosure is safe. Acknowledgement is not a promise of a particular remediation date or bounty.

## Backend security scope

Security-sensitive areas include authentication and tenant isolation, runner isolation and egress, secret references, evidence redaction, callback validation, workflow integrity, transaction construction and signing, network selection, and generated interface integrity.
