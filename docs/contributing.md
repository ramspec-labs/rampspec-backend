# Contributing

Install the pinned toolchain, run `pnpm install --frozen-lockfile`, and use `pnpm check` before every commit. Generated OpenAPI and schema artifacts must be refreshed with `pnpm generate` and committed with their source changes.

Keep changes scoped to one implementation item, add focused tests, run `git diff --check`, and use commit subjects that describe the change without workflow labels. Never commit credentials; use secret references and local environment templates.
