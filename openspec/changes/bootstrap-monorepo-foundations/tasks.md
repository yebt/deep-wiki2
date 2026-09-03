# Tasks: Bootstrap Monorepo Foundations (Phase 0)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 3,000–6,000 (12 packages/apps scaffolded, 4 structural checks + fixtures, compose, CI, docs) |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR, work-unit commits (13 units, matches design's Work Units) |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

`size:exception` was accepted up front for this session (unlimited review budget). No further gate blocks `sdd-apply`; scope is not reduced to fit the 400-line guideline.

### Suggested Work Units

| Unit | Goal | Focused test command | Runtime harness | Rollback boundary |
|------|------|----------------------|-----------------|--------------------|
| 0 | Spike: Nuxt 4 + Astro coexist, confirm Vitest-only `@nuxt/test-utils` | N/A — throwaway tree | N/A — discarded, no commit | Discard the tree |
| 1 | Workspace root + `workspace-shape`/`test-coverage` checks | `bun run check` | N/A — no app yet | Root config files + `scripts/checks/` |
| 2 | `packages/core`: Result type, ports, purity check | `bun run -F @deep-wiki/core test` | N/A | `packages/core/`, `scripts/checks/core-purity.ts` |
| 3 | `packages/contracts`: env schema, `.env.example`, drift check | `bun run -F @deep-wiki/contracts test` | N/A | `packages/contracts/`, `.env.example` |
| 4 | `packages/markdown`: parse() + fixture corpus | `bun run -F @deep-wiki/markdown test` | N/A | `packages/markdown/` |
| 5 | `packages/editor`: round-trip harness | `bun run -F @deep-wiki/editor test` | N/A | `packages/editor/` |
| 6 | `packages/db`: client factory, migrate/seed | `bun run -F @deep-wiki/db test` | N/A | `packages/db/` |
| 7 | `apps/api`: Hono health route, fail-fast config | `bun run -F @deep-wiki/api test` | `bun run -F @deep-wiki/api start` then `curl :PORT/health` | `apps/api/` |
| 8 | `apps/web` + `apps/landing` shells with real tests in-unit — **human review checkpoint (new UI)** | `bun run -F @deep-wiki/web test`, `bun run -F @deep-wiki/landing test` | `bun run -F @deep-wiki/web dev` then load smoke page | `apps/web/`, `apps/landing/` |
| 9 | Playwright e2e | `bun run -F @deep-wiki/web e2e` | Playwright `webServer` boots `apps/web` | `e2e/`, `playwright.config.ts` |
| 10 | Compose stack incl. Mermaid sidecar + acceptance assertions | `bun test scripts/checks/compose.test.ts` | `podman compose up -d --wait` then Mailpit + Kroki assertions | `compose.yaml`, `infra/`, `scripts/checks/compose.ts` |
| 11 | CI: verify, e2e, compose-smoke | N/A (CI-only) | Push to a branch, inspect Actions run | `.github/workflows/ci.yml` |
| 12 | Docs, decision-table fill-in, `strict_tdd` flip | N/A | Full bootstrap walk-through from README | `README.md`, `design.md`, `openspec/config.yaml` |

## Phase 0: Pre-Flight Spike

- [x] 0.1 Spike (no commit): in a throwaway tree, install Astro + Nuxt 4 + Nuxt UI together, run both builds, confirm `@nuxt/test-utils` is Vitest-only. Discard the tree. — *proposal risk: Nuxt/Astro Vite conflict* — **Result: coexist cleanly.** `bun install` resolved both without conflict (Bun keeps isolated per-dependent copies of divergent transitive `vite` majors — 5.4.21, 6.4.3, 8.2.2 — instead of forcing one hoisted version); both `astro build` and `nuxt build` completed with exit 0. `@nuxt/test-utils`'s `package.json` exports only `./vitest-environment` (no `bun:test` integration anywhere in its dist output), confirming it is Vitest-only as design assumed. Tree discarded; fallback ladder not needed.

## Phase 1: Workspace Root and Structural Check Harness

- [x] 1.1 Create `package.json` — `workspaces: ["apps/*","packages/*"]`, root scripts (`build`,`test`,`lint`,`typecheck`,`check`), `overrides` escape hatch — *monorepo-workspace: Bun Workspace Topology*
- [x] 1.2 Create `tsconfig.base.json` — `strict`, `moduleResolution: bundler`, `verbatimModuleSyntax`
- [x] 1.3 Create `eslint.config.js` flat config shared by all members
- [x] 1.4 (RED) `scripts/checks/__tests__/workspace-shape.test.ts` — violating fixture (Vitest in two members) must fail — *monorepo-workspace: Task Graph via `bun run -F`*
- [x] 1.5 (GREEN) Implement `scripts/checks/workspace-shape.ts` — Vitest confined to exactly one member; no `pnpm-lock.yaml`/`turbo.json`
- [x] 1.6 (RED) `scripts/checks/__tests__/test-coverage.test.ts` against `scripts/checks/__fixtures__/placeholder-test/` (zero-assertion test file) — must report failing coverage, not pass — *test-infrastructure: "An uncovered package is detected"*
- [x] 1.7 (GREEN) Implement `scripts/checks/test-coverage.ts` — fails when any member's test file has zero real assertions; add a passing fixture too
- [x] 1.8 Wire `bun run check` to run `workspace-shape` + `test-coverage` (core-purity/compose/env-example land with their own units)

## Phase 2: `packages/core`

- [x] 2.1 (RED) `packages/core/src/result.test.ts` — `Result<T,E>`/`ok`/`err` behavior
- [x] 2.2 (GREEN) Implement `packages/core/src/result.ts`
- [x] 2.3 Add `packages/core/src/ports/mail-sender.ts` — `MailSender` interface only, no adapter (adapter lands Phase 1 per `docs/TODO.md`)
- [x] 2.4 Add `packages/core/src/ports/blob-store.ts` — `BlobStore` interface only, no adapter (adapter lands Phase 1)
- [x] 2.5 (RED) `scripts/checks/__fixtures__/violating-core/` (deliberate `hono` import) + failing test asserting rejection — *core-purity-enforcement: Deliberate framework import fails CI*
- [x] 2.6 (GREEN) Implement `scripts/checks/core-purity.ts` via `Bun.Transpiler().scanImports()` — all specifiers relative, manifest `dependencies: {}`; error names file + import — *core-purity-enforcement: Failure identifies the offending import*
- [x] 2.7 Set `packages/core/package.json` `dependencies: {}`

## Phase 3: `packages/contracts`

- [x] 3.1 (RED) `packages/contracts/src/env.test.ts` — valid env parses; missing var rejected and named — *environment-config: Fail Fast on Missing or Malformed Configuration*
- [x] 3.2 (GREEN) Implement `packages/contracts/src/env.ts` zod server-env schema
- [ ] 3.3 **BLOCKED — environment tooling restriction, not a design/implementation gap.** Create `.env.example` listing every schema variable with a description — *environment-config: Documented Environment Template*. The apply agent's file-write tools (Read/Write/Edit and Bash) refuse every path matching the glob `.env.*` (a global permission `deny` rule in `~/.claude/settings.json`: `Read(.env.*)`, `Edit(.env.*)`, and the same pattern also blocks `Write`/`Bash` targeting that path), with no project-level exception. This blocks literally naming a file `.env.example`, regardless of its content having zero secrets. **Required follow-up (needs a human or a differently-privileged session):** create `.env.example` at the repository root with exactly:
  ```
  # Copy this file to .env and fill in values before running any app.
  # Every variable read by the zod schema in packages/contracts/src/env.ts
  # MUST be listed here (enforced by scripts/checks/env-example.ts).

  # Runtime environment. One of: development, production, test.
  NODE_ENV=development

  # Port apps/api listens on.
  PORT=4000

  # Postgres connection string (with pgvector enabled), e.g. the podman
  # compose stack's postgres service: postgres://user:pass@localhost:5432/deep_wiki
  DATABASE_URL=postgres://deep_wiki:deep_wiki@localhost:5432/deep_wiki
  ```
  Once added, `bun run scripts/checks/env-example.ts` (already implemented and unit-tested, task 3.5) will pass against it with no further code changes.
- [x] 3.4 (RED) fixture test for `scripts/checks/env-example.ts` — `.env.example` missing a schema var must fail — *implemented against fixture template files (`template.env`) rather than a real `.env.example`, for the same tooling-restriction reason as 3.3; the check function itself takes the template path as a parameter and is exercised identically*
- [x] 3.5 (GREEN) Implement `scripts/checks/env-example.ts` drift check — wired into `bun run check`; currently fails at the repo root only because 3.3's file does not exist yet (see above), not because of a logic defect

## Phase 4: `packages/markdown`

- [ ] 4.1 Create fixture corpus under `packages/markdown/fixtures/` (GATE-2 location)
- [ ] 4.2 (RED) `packages/markdown/src/index.test.ts` — `parse()` heading fixture into expected mdast
- [ ] 4.3 (GREEN) Implement `packages/markdown/src/index.ts` `parse(md): Root` over unified/remark

## Phase 5: `packages/editor`

- [ ] 5.1 (RED) `packages/editor/src/round-trip.test.ts` — corpus round-trip byte-identical
- [ ] 5.2 (GREEN) Implement `packages/editor/src/round-trip.ts` `roundTrip(md): string` over markdown's pipeline

## Phase 6: `packages/db`

- [ ] 6.1 (RED) `packages/db/src/client.test.ts` — `createDb(url)` returns a client without connecting
- [ ] 6.2 (GREEN) Implement `packages/db/src/{client.ts,schema.ts}`, `drizzle.config.ts`
- [ ] 6.3 Add `packages/db/migrate.ts` and `seed.ts` CLI entry points (empty journal, no-op seed)

## Phase 7: `apps/api`

- [ ] 7.1 Create `apps/api/src/config.ts` — fail-fast typed loader over `packages/contracts` env schema — *environment-config: Typed Configuration Loading*
- [ ] 7.2 (RED) `apps/api/src/index.test.ts` — `app.request('/health')` returns 200
- [ ] 7.3 (GREEN) Implement `apps/api/src/index.ts` Hono `GET /health`
- [ ] 7.4 Remove the `build` script from `apps/api/package.json`; add a comment/README note stating Hono-on-Bun runs TS directly with no bundling step in Phase 0 — closes the "apps/api build never exercised" gap explicitly rather than leaving it implied
- [ ] 7.5 Update `design.md`'s "Only the three apps have a build script" sentence to name `apps/landing` and `apps/web` only

## Phase 8: `apps/web` + `apps/landing` — human review checkpoint (new UI screen)

- [ ] 8.1 Scaffold `apps/web` Nuxt 4 + Nuxt UI shell, one smoke page, one composable
- [ ] 8.2 Scaffold `apps/landing` Astro shell + `src/lib/site.ts` metadata
- [ ] 8.3 Create `apps/web/vitest.config.ts` (`defineVitestConfig({ test: { environment: 'nuxt' } })`); add `vitest` + `@nuxt/test-utils` as `apps/web`-only devDependencies — in the same unit that introduces `apps/web`, not a later one
- [ ] 8.4 Create `apps/web/src/config.ts` — typed loader (zod) documenting explicitly that `apps/web` requires zero variables in Phase 0 — *environment-config: Typed Configuration Loading*
- [ ] 8.5 Create `apps/landing/src/lib/config.ts` — typed loader documenting explicitly that `apps/landing` requires zero variables in Phase 0
- [ ] 8.6 (RED) `apps/web` composable unit test
- [ ] 8.7 (GREEN) Implement the composable
- [ ] 8.8 (RED) — **human review checkpoint: new UI screen** — smoke-page component test via `@nuxt/test-utils`
- [ ] 8.9 (GREEN) Implement the smoke page
- [ ] 8.10 (RED) `apps/landing` metadata unit test under `bun test`
- [ ] 8.11 (GREEN) Implement `src/lib/site.ts` metadata
- [ ] 8.12 Add `build` scripts to `apps/web/package.json` and `apps/landing/package.json`; run both builds locally to confirm WU-0's finding holds with real installs — *proposal risk: Nuxt/Astro coexistence*
- [ ] 8.13 Confirm `workspace-shape.ts` reports Vitest in exactly `apps/web`

## Phase 9: Playwright E2E

- [ ] 9.1 Create `playwright.config.ts` with `webServer` booting `apps/web`
- [ ] 9.2 Write `e2e/smoke.spec.ts` exercising one real user-facing path — *test-infrastructure: Playwright boots the web app and passes*
- [ ] 9.3 Run `bunx playwright install --with-deps chromium && bun run -F @deep-wiki/web e2e` locally and confirm it passes

## Phase 10: Compose Stack

- [ ] 10.1 Create `compose.yaml`: `postgres` (`pgvector/pgvector:pg17`), `mailpit`, `minio`, `kroki`, `kroki-mermaid` — named volumes for data, single `:z` bind mount for the postgres init script only — *container-stack: Four Services Start Cleanly*
- [ ] 10.2 Set `KROKI_MERMAID_HOST=mermaid` on the `kroki` service environment (value = `kroki-mermaid`'s compose service name) — without this the sidecar is never routed to
- [ ] 10.3 Create `infra/postgres/init/01-extensions.sql` — `CREATE EXTENSION IF NOT EXISTS vector` — *container-stack: pgvector is enabled on postgres*
- [ ] 10.4 (RED) fixture tests for `scripts/checks/compose.ts` — missing `:z`, port `<1024`, non-spec key must each fail — *container-stack: Missing label is rejected / Port below 1024 is rejected*
- [ ] 10.5 (GREEN) Implement `scripts/checks/compose.ts`
- [ ] 10.6 Verify `podman compose config -q` resolves `${VAR:?message}` and `depends_on.condition: service_healthy`; if unsupported, fall back to plain `${VAR}` defaults + documented startup order — *Open Question*
- [ ] 10.7 Add a `compose-smoke` assertion: send a test message over SMTP on 1025, then retrieve it via the Mailpit API/UI on 8025 — replaces the liveness-only `readyz` check — *container-stack: Mailpit exposes both interfaces*
- [ ] 10.8 Add a `compose-smoke` assertion: POST a minimal Mermaid diagram to `kroki`'s HTTP endpoint (routed via `KROKI_MERMAID_HOST`) and assert a rendered response — proves the sidecar works end to end, not merely that it starts

## Phase 11: CI Pipeline

- [ ] 11.1 Create `.github/workflows/ci.yml` `verify` job: setup-bun + setup-node 22 → `bun install --frozen-lockfile` → `lint` → `typecheck` → `check` (workspace-shape, test-coverage, core-purity, env-example, compose) → `test` → `build` for **all three apps** (`landing`, `web` build; `api` runs `typecheck` only, per 7.4) — *ci-pipeline: Four Gates On Every Push*
- [ ] 11.2 Add `e2e` job (`needs: verify`): `bunx playwright install --with-deps chromium` → web e2e
- [ ] 11.3 Add `compose-smoke` job: `docker compose config -q` → `up -d --wait` → assert `vector` extension, Mailpit send/retrieve (10.7), Kroki+Mermaid render (10.8) → `bun run db:migrate` → `down -v`
- [ ] 11.4 Add `concurrency` to cancel superseded runs — *ci-pipeline: Any Failing Gate Fails the Pipeline*

## Phase 12: Docs, Decision Cleanup, and `strict_tdd`

- [ ] 12.1 Write `README.md`: clone → `bun install` → `podman compose up` → `bun run db:migrate` → `bun run db:seed` — *monorepo-workspace: Documented Local Bootstrap*
- [ ] 12.2 Fill `design.md` D4 "Reverses if" with "Nothing foreseeable" per `docs/SPECS.md` §14 house style
- [ ] 12.3 Fill `design.md` D7 "Reverses if" with "Nothing foreseeable" per `docs/SPECS.md` §14 house style
- [ ] 12.4 Update `design.md` Open Questions: mark D8 (five services) acknowledged as an accepted scope delta; record the 10.6 `podman compose config` verification outcome
- [ ] 12.5 Update `openspec/config.yaml`: `strict_tdd: false → true`; fill `testing.projects` (all apps/packages) and `rules.apply.test_command: "bun run test"` — *test-infrastructure: strict_tdd flips to true after infrastructure lands*
- [ ] 12.6 Walk through all seven proposal Success Criteria end to end and confirm each passes: clean-clone build, workspace-wide `bun test`, Playwright smoke, deliberate core import fails CI, `podman compose up` starts all five services cleanly, README bootstrap path, `strict_tdd` true
