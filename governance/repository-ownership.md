# Repository Ownership

## Owned here

This repository owns the RampSpec backend control plane, API implementation, persistence, orchestration, schedulers, webhooks, runner protocol and implementations, protocol journeys, evidence pipeline, report generation, backend SDK, and CLI. It is the source of truth for OpenAPI and runtime JSON Schemas.

## Owned elsewhere

Contract source and deployments belong in `rampspec-contracts`. Application UI belongs in `rampspec-frontend`. Authored product and operator documentation belongs in `rampspec-docs`.

## Cross-repository changes

Publish versioned interfaces from the owning repository first. Consumers update through an explicit dependency change with compatibility checks. Generated files must carry their source release and content hash; hand-copied interfaces are not accepted.
