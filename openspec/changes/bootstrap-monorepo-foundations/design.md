# Design: Bootstrap Monorepo Foundations (Phase 0)

## Technical Approach

Phase 0 builds machinery, not features. The design principle throughout is **structural checks over conventions**: every constraint the proposal states as a rule (`packages/core` purity, compose portability, workspace test coverage, env template drift) becomes a small TypeScript check under `scripts/checks/`, unit-tested against fixtures, runnable individually and wired into CI as a named step. One mechanism, four constraints, no new tooling.

Internal packages are consumed as **TypeScript source** (`exports: { ".": "./src/index.ts" }`), so `packages/*` have no build step at all in Phase 0 — only `lint`, `typecheck`, `test`. Bun, Vite (Nuxt), and Astro all transpile TS on the fly, so build ordering across the workspace becomes a non-problem instead of something `bun run -F` has to guarantee. Only `apps/landing` and `apps/web` have a `build` script — `apps/api` runs Hono directly under Bun with no bundling step, so it has none (see task 7.4/7.5).

`packages/core` imports nothing — not even a workspace sibling. The dependency direction is strictly inward: `apps/* → contracts, markdown, editor, db → core → ∅`. Config parsing lives in `apps/*` composition roots, never in `core`.

## The Deferred Decision: Vue SFC Tests

### Decision: Vitest + `@nuxt/test-utils` scoped to `apps/web`; `bun test` everywhere else

| Option | Cost | What it buys | Verdict |
|---|---|---|---|
| A. `apps/web` tests TS-only, all component confidence via Playwright | One runner, one assertion API | Loses component-level red-green entirely | Rejected |
| B. Scoped Vitest + `@nuxt/test-utils` in `apps/web` only | Two runners, Node as a dev prerequisite | Real component TDD from Phase 0 | **Chosen** |
| C. Bun SFC loader plugin via `bunfig.toml` preload | One runner, unofficial plugin | Compiles SFCs but cannot resolve `#app`, `#imports`, auto-imports | Rejected |

**Rationale.** The blocker is not SFC compilation, it is the **Nuxt runtime environment**. A Nuxt component resolves virtual modules (`#app`, `#imports`, `#components`) that only exist inside a Nuxt-built environment. `@nuxt/test-utils` provides exactly that, and it targets Vitest only — there is no `bun test` runner for it. Option C solves the smaller half of the problem and leaves the larger half broken, which is worse than option A because it looks like it works.

Option A is the real alternative, and it fails the point of Phase 0. Under A, the red-green loop for any component is a Playwright run against a booted Nuxt server — too slow to drive design, so Phase 8 (the UI phase) would be structurally TDD-exempt. Phase 0 exists to make Strict TDD genuinely true; buying that with one extra dev dependency in one workspace is a good trade.

**What is genuinely lost under B:** nothing in coverage — the cost is real but different. Two assertion APIs (`bun:test` vs `vitest`, Jest-like but not identical) mean a contributor must know which file they are in. Node 22 becomes a **development** prerequisite (Vitest's supported runtime); it is not a production or self-hoster requirement — `nuxt build` still runs under Bun.

**Containment.** `scripts/checks/workspace-shape.ts` asserts Vitest appears in exactly one workspace member. The rule is checkable: *Vitest is permitted only where a Vue SFC or a Nuxt runtime alias is required — today `apps/web` alone.* Reinforced architecturally by container/presentational discipline: logic lives in `packages/*` (bun test), components stay dumb, so the Vitest surface stays small.

**One entry point.** Root `"test": "bun run --filter '*' test"`. Each member owns its `test` script — `vitest run` in `apps/web`, `bun test` everywhere else. Bun propagates any non-zero child exit, so the workspace command yields one exit code. CI runs it as **one step named `test`**: one pass/fail line, regardless of how many runners sit underneath.

**Reverses if:** `@nuxt/test-utils` ships a `bun test` runner, or Bun ships a first-party Nuxt-aware environment. Then collapse to one runner and delete the Vitest config.

**Verification before commit:** WU-0 (spike, below) confirms this assumption cheaply rather than trusting it.

## Architecture Decisions

| # | Decision | Rationale | Reverses if |
|---|---|---|---|
| D1 | Packages ship TS source, no build step; only apps build | Removes cross-package build ordering as a class of problem; `bun run -F` never has to be a build orchestrator | A package must be published to a registry, or a consumer cannot process TS source |
| D2 | Resolution via Bun workspace symlinks only — no `tsconfig` `paths` | Two resolution mechanisms drift silently; one cannot | A tool proves unable to follow workspace symlinks |
| D3 | Purity enforced by `scripts/checks/core-purity.ts` using `Bun.Transpiler().scanImports()`, asserting every specifier in `packages/core/src` is relative, plus empty `dependencies` in its manifest | Deny-by-default beats a framework denylist that ages. AST-accurate (covers `import()` and `require`), no ESLint plugin, cannot be silenced by an inline `eslint-disable`. Zero new tooling | The rule needs per-file exceptions, which would mean the hexagon has leaked |
| D4 | `packages/core` also declares `MailSender` and `BlobStore` port interfaces (types only, no adapters) | SPECS §12.3 calls them mandatory; without one interface, core has no shape for the purity check to protect. Two type files, no behaviour | — |
| D5 | Compose portability checked statically by `scripts/checks/compose.ts` (bind mounts carry `:z`/`:Z`, host ports ≥1024, no non-spec keys) | Satisfies the container-stack spec's "validation rejects it" scenarios in the unit CI job, with no container runtime and no Docker on the dev machine | Compose gains a first-party spec linter covering the same rules |
| D6 | Compose env uses `${VAR:?message}` interpolation | Fail-fast at the container layer mirrors fail-fast at the app layer | Podman's provider proves not to support `:?` (verified on first `podman compose config`) |
| D7 | Named volumes for data, bind mount only for the postgres init script | `:z` applies to bind mounts; labelling named volumes is noise that obscures the one mount that needs it | — |
| D8 | Add a `kroki-mermaid` sidecar alongside `kroki` | The base Kroki image cannot render Mermaid; SPECS §6 makes Mermaid primary. Discovering this in Phase 4 is the late failure Phase 0 exists to prevent. **Exceeds the proposal's literal four services** — see Open Questions | Kroki absorbs Mermaid into the base image |
| D9 | Env schema (zod) in `packages/contracts`; `process.env` read only in each app's `src/config.ts` | Keeps `core` framework-free *and* environment-free; core receives plain typed values as arguments | — |
| D10 | One CI `verify` job with named steps, plus `e2e` and `compose-smoke` | One install, one cache, one pass/fail; step names still identify the failing gate as the ci-pipeline spec requires | Step runtime grows enough that parallel jobs beat a single install |

## Nuxt 4 + Astro Coexistence

**Risk:** both depend on Vite; Bun hoists a single copy to the root `node_modules` and a major-version disagreement breaks one of them.

**Detection, in Phase 0 not Phase 2:**
1. **WU-0 spike (first action, before any commit):** `bun install` both frameworks in a throwaway tree and run both builds. Under an hour, and it de-risks the topology before the topology is written.
2. **WU-8 installs both apps in a single work unit** and both `build` scripts must pass in that unit.
3. **CI runs `bun install --frozen-lockfile` from a clean checkout, then both builds, on every push** — a hoisting regression from any later dependency bump surfaces at that commit.

**Fallback ladder, in order:**

| Step | Action | Cost |
|---|---|---|
| 1 | Pin the shared transitive with root `overrides` in `package.json` | Low |
| 2 | Exclude `apps/landing` from `workspaces`; give it its own nested install and lockfile | Low — landing consumes nothing from `packages/*` (TODO Phase 0 explicitly: "no app dependencies"); root scripts call it by path |
| 3 | Replace Astro with a statically-generated Nuxt route | High — requires a proposal amendment |

Step 2 is cheap precisely because the landing site is dependency-isolated by design, which is why the topology should not fight to keep it in the workspace.

## Data Flow

```
    apps/landing (Astro)     apps/web (Nuxt 4)     apps/api (Hono)
           │                        │                     │
           │                        ├── contracts ────────┤
           │                        ├── editor ── markdown ┤
           │                        │                     ├── db
           └────────────────────────┴─────────┬───────────┘
                                              ▼
                                       packages/core
                                      (imports nothing)

    config:  process.env ──► zod schema (contracts) ──► typed object
                                    │                        │
                            apps/*/src/config.ts        passed as args
                            (fail-fast at boot)          ──► core
```

Task graph: `bun run --filter '*' <script>` — root scripts `build`, `test`, `lint`, `typecheck`, `check`; `bun run -F @deep-wiki/core test` targets one member.

## File Changes

| Path | Action | Purpose |
|---|---|---|
| `package.json` | Create | Workspaces `apps/*`, `packages/*`; root task graph; `overrides` escape hatch |
| `tsconfig.base.json` | Create | `strict`, `moduleResolution: bundler`, `verbatimModuleSyntax` |
| `eslint.config.js` | Create | Flat config, shared by all members |
| `scripts/checks/{core-purity,workspace-shape,compose,env-example}.ts` | Create | The four structural checks; each exits non-zero with an identifying message |
| `scripts/checks/__fixtures__/` | Create | Violating fixtures that make each check testable without breaking the repo |
| `packages/core/src/{result.ts,ports/mail-sender.ts,ports/blob-store.ts}` | Create | Framework-free primitives + the two mandatory ports |
| `packages/contracts/src/env.ts` | Create | zod server-env schema, single source for `.env.example` |
| `packages/markdown/src/index.ts`, `fixtures/` | Create | `parse()` over unified/remark; GATE-2 corpus location |
| `packages/editor/src/round-trip.ts` | Create | md → mdast → md byte-identity harness over the corpus (ProseMirror slots in later) |
| `packages/db/src/{client.ts,schema.ts}`, `migrate.ts`, `seed.ts`, `drizzle.config.ts` | Create | Drizzle client factory taking a URL argument; migrate/seed entry points |
| `apps/api/src/{index.ts,config.ts}` | Create | Hono `GET /health`; fail-fast config load |
| `apps/web/*`, `apps/landing/*` | Create | Nuxt 4 + Nuxt UI shell with one smoke page; Astro shell |
| `apps/web/vitest.config.ts` | Create | `defineVitestConfig({ test: { environment: 'nuxt' } })` |
| `e2e/` + `playwright.config.ts` | Create | Playwright `webServer` boots `apps/web` |
| `compose.yaml`, `infra/postgres/init/01-extensions.sql` | Create | Four services + Mermaid sidecar; `CREATE EXTENSION IF NOT EXISTS vector` |
| `.env.example`, `README.md`, `.github/workflows/ci.yml` | Create | Config template, bootstrap path, pipeline |
| `openspec/config.yaml` | Modify | `strict_tdd: false → true`; fill `testing.projects` and `rules.apply.test_command` |

## Compose Topology

| Service | Image | Ports (host:container) | Volume | Healthcheck |
|---|---|---|---|---|
| `postgres` | `pgvector/pgvector:pg17` | `5432:5432` | named `pgdata`; bind `./infra/postgres/init:/docker-entrypoint-initdb.d:z` | `pg_isready -U $POSTGRES_USER` |
| `mailpit` | `axllent/mailpit` | `1025:1025`, `8025:8025` | none | `/mailpit readyz` |
| `minio` | `minio/minio` | `9000:9000`, `9001:9001` | named `miniodata` | `curl -f localhost:9000/minio/health/live` |
| `kroki` | `yuzutech/kroki` | `8000:8000` | none | none — CI asserts HTTP 200 from the host |
| `kroki-mermaid` | `yuzutech/kroki-mermaid` | not published | none | none |

All host ports ≥1024. Exactly one bind mount, carrying `:z`. No `container_name`, no `develop.watch`, no profiles — Compose spec only. README documents: `cp env.example .env` → `podman compose up -d` → `bun run db:migrate` → `bun run db:seed`. Both delegate to `packages/db`; in Phase 0 they run for real against an empty migration journal and a no-op seed, so the entry points are stable before there is schema to move.

## Package Skeletons at End of Phase 0

| Member | Contents | Real executing test |
|---|---|---|
| `core` | `Result<T,E>` + `ok`/`err`; `MailSender`, `BlobStore` interfaces | Result behaviour; purity self-check |
| `markdown` | `parse(md): Root` over unified/remark; one fixture | Parses a heading into the expected mdast |
| `contracts` | zod env schema + inferred types | Valid parse; missing var rejected with the variable named |
| `editor` | `roundTrip(md): string` via markdown's pipeline | Corpus round-trip is byte-identical (GATE-2 harness, ProseMirror-free) |
| `db` | `createDb(url)` Drizzle factory; migrate/seed CLIs | Factory returns a client without connecting (no live DB in the unit job) |
| `api` | Hono app, `GET /health`, fail-fast config | `app.request('/health')` returns 200 — no server needed |
| `web` | Nuxt 4 + Nuxt UI, one smoke page, one composable | Composable unit test + component test via `@nuxt/test-utils` |
| `landing` | Astro page + `src/lib/site.ts` metadata | Metadata unit test under `bun test` |

## CI Pipeline

| Job | Needs | Steps |
|---|---|---|
| `verify` | — | setup-bun + setup-node 22 → `bun install --frozen-lockfile` → `lint` → `typecheck` → `check` (all four structural checks) → `test` (workspace-wide, one exit code) → `build` (both apps — the coexistence gate) |
| `e2e` | `verify` | `bunx playwright install --with-deps chromium` → `bun run -F @deep-wiki/web e2e` |
| `compose-smoke` | — | `docker compose config -q` → `docker compose up -d --wait` → assert `vector` extension present, mailpit and kroki respond → `bun run db:migrate` → `docker compose down -v` |

`compose-smoke` is the **only** place the production runtime is exercised, since Docker is absent from the development machine — stated plainly rather than assumed away. It runs independently of `verify` so a compose regression is not masked by an unrelated lint failure, and `docker compose config -q` fails fast even when the images cannot start. `concurrency` cancels superseded runs.

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit (bun test) | Core, markdown, contracts, editor, db, api, landing; all four check scripts against violating fixtures | `bun test` per member |
| Unit (vitest) | `apps/web` composables and the smoke page component | `vitest run` + `@nuxt/test-utils`, `environment: 'nuxt'` |
| Integration | Compose stack: pgvector present, mailpit SMTP + UI, kroki renders | `compose-smoke` CI job |
| E2E | `apps/web` boots and the smoke page renders | Playwright `webServer` |

The check scripts are TDD-friendly by construction: the "deliberate framework import fails" scenario is a RED test against `scripts/checks/__fixtures__/violating-core/`, not a deliberately broken repository.

## Threat Matrix

Not applicable — recorded row by row rather than expanded.

| Boundary | Applicability |
|---|---|
| Documentation-like paths | N/A — checks read `.ts`/`.yaml` under fixed roots and never execute scanned content |
| Git repository selection | N/A — no VCS automation in this change |
| Commit state | N/A |
| Push state | N/A |
| PR commands | N/A |

The check scripts spawn no subprocess and evaluate no scanned input; CI steps take no untrusted argument.

## Work Units

Each unit keeps its tests with its code, leaves the repository coherent on its own, and is a candidate chained PR. Delivery is `single-pr` with `size:exception` accepted, so these are commits within one PR.

| # | Commit | Rollback boundary |
|---|---|---|
| 0 | *(spike, no commit)* Install Nuxt 4 + Astro together, run both builds, confirm `@nuxt/test-utils` is Vitest-only | Discard the tree |
| 1 | `chore(repo): bun workspace root, shared tsconfig, eslint, workspace-shape check` | Root config files + `scripts/checks/workspace-shape.ts` |
| 2 | `feat(core): framework-free core package with machine-enforced purity check` | `packages/core` + `core-purity.ts` |
| 3 | `feat(contracts): typed env schema, .env.example, and template drift check` | `packages/contracts` + `.env.example` |
| 4 | `feat(markdown): shared unified/remark parse entry point and fixture corpus` | `packages/markdown` |
| 5 | `feat(editor): markdown round-trip harness over the fixture corpus` | `packages/editor` |
| 6 | `feat(db): drizzle client factory with migrate and seed entry points` | `packages/db` |
| 7 | `feat(api): hono health route with fail-fast configuration loading` | `apps/api` |
| 8 | `feat(apps): astro landing and nuxt 4 web shells installed together` — **human gate: introduces a UI surface** | `apps/web` + `apps/landing` |
| 9 | `test(web): scoped vitest and @nuxt/test-utils adapter with component smoke test` | `apps/web/vitest.config.ts` + web tests |
| 10 | `test(e2e): playwright configuration and web smoke journey` | `e2e/` + `playwright.config.ts` |
| 11 | `feat(compose): four-service stack with compose portability check` | `compose.yaml`, `infra/`, `compose.ts` check |
| 12 | `ci: verify, e2e, and docker compose smoke jobs on every push` | `.github/workflows/ci.yml` |
| 13 | `docs(readme): local bootstrap path; re-resolve strict_tdd to true` | `README.md` + `openspec/config.yaml` |

Unit 8 is the coexistence gate and carries the standing human review gate (the smoke page is a UI surface, minimal as it is). Units 1–7 are runner-first: the test infrastructure lands in unit 1, so every later unit is testable at creation.

## Migration / Rollout

No data migration — additive greenfield. Rollback is `git revert` of the PR or reset to the pre-Phase-0 commit; `docs/` and `openspec/` are untouched. Runtime teardown: `podman compose down -v`. On rollback `strict_tdd` returns to `false` and Phase 1 stays blocked, as the proposal states.

## Open Questions

- [ ] **D8 adds a fifth container** (`kroki-mermaid`) beyond the proposal's literal four services. Recommended, because Mermaid is the primary diagram format and the base Kroki image cannot render it — but it is a scope delta the owner should acknowledge, or defer to Phase 4 with the risk recorded.
- [ ] Whether `podman compose` (podman 5.8.4, delegating to an external provider) supports `${VAR:?message}` interpolation and `depends_on: { condition: service_healthy }`. Verified on the first `podman compose config` in unit 11; the fallback is plain `${VAR}` defaults plus a documented startup order.
- [ ] Node 22 becomes a **development-only** prerequisite because of Vitest. Confirmed acceptable for contributors; it is explicitly not a requirement for self-hosters building or running the product.
