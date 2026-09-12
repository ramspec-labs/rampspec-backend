# Runtime Schemas

RampSpec backend contracts use independent JSON Schema Draft 2020-12 documents. TypeScript source definitions live in `packages/protocol/src/schemas.ts`; `pnpm generate` writes release artifacts to `generated/schemas/`.

Every document has its own stable HTTPS `$id` and `schemaVersion`. Breaking changes require a new major schema directory. Compatible additions use an explicitly namespaced `extensions` member; unknown top-level fields remain invalid. Generated JSON and declarations are published with backend releases and must never be edited manually.
