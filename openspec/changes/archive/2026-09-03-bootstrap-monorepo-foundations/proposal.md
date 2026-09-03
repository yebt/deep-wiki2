# Proposal: Bootstrap Monorepo Foundations (Phase 0)

## Intent

Docs-only repo: no `package.json`, no test runner, no container stack. Every roadmap phase depends on infrastructure that does not exist, and `strict_tdd` is disabled only because no runner exists. Phase 0 builds it and **re-resolves `strict_tdd` to `true`**; all later phases run under Strict TDD.

## Scope

### In Scope

| Deliverable | Constraint |
|---|---|
| Bun 1.4 workspace root, `bun run -F` task graph | Not pnpm, not Turborepo (SPECS §14) |
| `apps/landing` Astro, `apps/web` Nuxt 4 + Nuxt UI, `apps/api` Hono | Build + smoke test, no features |
| `packages/{core,markdown,contracts,editor,db}` | Buildable placeholders, one smoke test each |
| `packages/core` purity check | Build fails on any framework import — a deliverable, not a convention |
| `compose.yaml`: postgres+pgvector, mailpit 1025/8025, minio, kroki | Compose spec only, `:z` labels, host ports ≥1024 |
| Workspace-wide `bun test` + Playwright e2e | Headline outcome |
| CI: lint, typecheck, `bun test`, purity check | Every push |
| `.env.example` + typed config loading | — |

### Out of Scope

Domain model and `nodes` tree; `permissions` and its resolver; markdown pipeline internals; the editor; the AI layer; MCP and `packages/ai-tools`; any UI beyond a smoke-test page proving the app boots.

## Capabilities

### New Capabilities

- `monorepo-workspace`: workspace topology, skeletons, task graph
- `core-purity-enforcement`: automated framework-import ban in `packages/core`
- `container-stack`: one Compose file for podman (dev) and docker (prod)
- `test-infrastructure`: workspace `bun test` plus Playwright e2e
- `ci-pipeline`: lint, typecheck, test, purity on push
- `environment-config`: `.env.example` and typed config loading

### Modified Capabilities

- None — `openspec/specs/` is empty.

## Approach

Scaffold bottom-up: root → packages → apps → compose → CI. Land the runner with the first package so every later unit is testable at creation, and make the hexagonal boundary machine-checked from the first commit rather than documented.

## Cross-cutting Gates

Phase 0 implements none of them; it owns the machinery they run on.

| Gate | Phase 0 obligation |
|---|---|
| GATE-1 permissions | `packages/core` framework-free, isolated, covered by `bun test` in CI |
| GATE-2 round-trip | Fixture-corpus location and CI wiring exist in `markdown`/`editor` |
| GATE-3 vector tenancy | `packages/db` scaffold + pgvector postgres so query-level tests can run |

Per `openspec/config.yaml`: `packages/core` MUST stay framework-free.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `package.json`, `tsconfig.base.json` | New | Workspace root |
| `apps/*`, `packages/*` | New | Skeletons with smoke tests |
| `compose.yaml` | New | Four dev services |
| `.github/workflows/`, `.env.example`, `README.md` | New | CI, config, bootstrap |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Nuxt 4 + Astro conflict on transitive resolution under Bun workspaces | Med | Install both in the same work unit, both builds in CI immediately — fail here, not in Phase 2 |
| `bun test` cannot run Vue SFC tests without a loader | Med | Keep `apps/web` smoke tests TS-only or add a scoped Vitest adapter; decide in design |
| `podman compose` delegates to external `podman-compose` (podman 5.8.4) | High | Compose-spec compliance is a hard requirement, not a preference |
| Docker absent locally; production path unverifiable here | High | CI runs the same file under docker compose as the production smoke test |
| Fedora SELinux / rootless port binding | Med | `:z` on every bind mount, all host ports ≥1024 |

## Rollback Plan

Additive greenfield. Revert the PR or reset to the pre-Phase-0 commit for a docs-only tree; `docs/` and `openspec/` are untouched. Runtime: `podman compose down -v`. On rollback `strict_tdd` returns to `false` and Phase 1 stays blocked.

## Dependencies

Bun 1.4+, podman 5.x with a compose provider, registry network access.

## Success Criteria

- [x] Clean clone: `bun install` then workspace build succeeds — verified with a genuine `git clone` into a scratch directory, `bun install --frozen-lockfile`, then `bun run build`; both exit 0. A real bug surfaced during this exact check (see `bunfig.toml`'s commit: Bun's default isolated linker left `apps/web`'s `happy-dom` optional peer dependency unresolvable on a fresh install) and was fixed at the root config level, not worked around
- [x] `bun test` passes across every app and package — verified in the same clean clone: `bun run test` exits 0, 20/20 `bun test` assertions plus `apps/web`'s 12/12 Vitest tests all pass
- [x] Playwright boots `apps/web` and passes one smoke test — verified in the same clean clone: `bun run -F @deep-wiki/web e2e` exits 0, 1 passed
- [x] A deliberate framework import in `packages/core` fails CI — `scripts/checks/core-purity.ts`, unit-tested against `scripts/checks/__fixtures__/violating-core/` and wired into `bun run check` and CI's `verify` job
- [x] `podman compose up` starts all four services without SELinux or port errors — starts **five** services (D8: the Kroki Mermaid sidecar is a required, acknowledged scope delta) cleanly; verified with a real `podman compose up -d --wait` bring-up (remapped host ports, since this development machine already runs other projects on the default ports), confirmed `pgvector` installed, ran the real Mailpit send/retrieve and Kroki+Mermaid render assertions successfully, then tore the stack down with no stray containers or volumes left
- [x] `README.md` documents clone → install → compose up → migrate → seed
- [x] `strict_tdd` re-resolves to `true` in `openspec/config.yaml`
