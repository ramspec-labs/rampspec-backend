# Reference environments

- Local simulation: deterministic fake anchors and local runners.
- Testnet: pinned contracts and controlled signing keys.
- Browser: isolated browser runner with sanitized fixtures.
- Partner staging: optional local-runner corridor with explicit labels.

Every output records which environment produced it; simulated results are never
represented as public-network submissions.
