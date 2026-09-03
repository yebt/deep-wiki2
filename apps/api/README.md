# @deep-wiki/api

Hono on Bun. Adapters only, no domain logic (docs/SPECS.md §13).

## No `build` script

This package has no `build` script and never runs through a bundler.
Bun runs TypeScript directly — `bun run src/index.ts` — so there is no
compilation step to exercise in CI or locally in Phase 0. `bun run typecheck`
(`tsc --noEmit`) is the type-safety gate for this package; `bun run start`
runs the server as-is.

Only `apps/web` and `apps/landing` have a `build` script (see design.md).
