# deep-wiki

A self-hosted, multi-tenant wiki for software teams **and** AI agents.

Teams arrive with a raw idea, the system interrogates it with AI until it becomes a
well-declared design document with diagrams, and the resulting corpus then serves as the
team's single source of truth — and as a RAG surface agents can query.

See [`docs/SPECS.md`](docs/SPECS.md) for the full specification and
[`docs/TODO.md`](docs/TODO.md) for the roadmap and running log.

## Prerequisites

- **Bun 1.4+** — the package manager and primary test runner.
- **podman 5.x** with a compose provider (local development), or Docker (production).
- **Node 22+** — development only, required by Vitest for `apps/web` component tests.
  Production builds and the runtime do not need it.

## Bootstrap

```bash
git clone <repository-url>
cd deep-wiki
bun install
```

### Configure the environment

Copy the committed template to your local `.env` and edit the values:

```bash
cp env.example .env
```

`env.example` is committed and must never contain a secret. `.env` is gitignored and holds
your real values. Every variable in `packages/contracts/src/env.ts` must appear in
`env.example`; `bun run check` fails if the two drift apart. `env.example` also carries the
compose stack's own credentials (`POSTGRES_*`, `MINIO_*`) — those are read by
`compose.yaml`, not by the app's own configuration schema, but they still belong in `.env`
because `podman compose`/`docker compose` load that same file automatically.

### Start the local services

```bash
podman compose up -d --wait
bun run db:migrate
bun run db:seed
```

This starts five containers: `postgres` (with the `pgvector` extension enabled),
`mailpit` (dev SMTP capture — SMTP on `1025`, web UI on `8025`), `minio` (S3-compatible
object storage), and `kroki` with its `mermaid` sidecar (server-side diagram rendering —
`kroki` alone cannot render Mermaid; see `compose.yaml`). `bun run db:migrate` runs the
(currently empty) Drizzle migration journal, and `bun run db:seed` runs the (currently
no-op) seed script — both are stable entry points, ready for real schema and data once
Phase 1 lands it.

Tear the stack down with `podman compose down -v` (the `-v` also removes the named
volumes, so the next `up` starts from a clean database).

In production, the same `compose.yaml` runs unmodified under `docker compose` — see
`docs/SPECS.md` §12.1.

## Commands

Run from the repository root:

| Command | What it does |
|---|---|
| `bun run typecheck` | Type-checks every workspace member and the root scripts |
| `bun run lint` | ESLint across the repository |
| `bun run test` | Runs the test suite for every package and app. Database-backed suites in `packages/db` auto-provision a disposable test Postgres — see below |
| `bun run check` | Structural checks: workspace shape, test coverage, core purity, env drift, compose portability |
| `bun run db:migrate` | Runs Drizzle migrations against `DATABASE_URL` |
| `bun run db:seed` | Runs the seed script against `DATABASE_URL` |
| `bun run compose:smoke` | Against a running compose stack: sends a real message over Mailpit's SMTP port and retrieves it via its API, and renders a real Mermaid diagram through Kroki — proves those two services actually work, not merely that they started |

`bun run check` is the guard rail. It fails when a package has no real test, when
`packages/core` gains a framework import, when the second test runner spreads beyond
`apps/web`, when `env.example` drifts from the schema, or when `compose.yaml` uses a
Docker/Podman-specific extension, an unlabelled bind mount, or a published port below
1024.

### Database-backed tests

`packages/db`'s suites need a real Postgres. `bun run test` provisions one automatically
via `packages/db/testing/provision.ts`:

1. `TEST_DATABASE_URL` set → used directly (the CI path).
2. Otherwise it probes a dedicated local test Postgres and, if unreachable, brings one up
   with `podman compose up -d --wait postgres` (or `docker`) against
   `packages/db/testing/compose.yaml` — a file separate from the repository root's, on its
   own port, so it never contends with your dev stack or with unrelated containers on the
   same host.
3. A shared `deepwiki_test_template` database is migrated once; each suite gets its own
   `dw_test_<n>` database created `TEMPLATE deepwiki_test_template` and dropped in
   `afterAll`.

Set `DEEPWIKI_TEST_NO_AUTOSTART=1` to opt out of step 2 and fail fast with an actionable
message instead — useful when you want to manage the test container yourself. This harness
never silently skips a database-backed test: a total provisioning failure throws with the
exact command to run. `bun run check` and the pre-commit hook stay database-free.

### Enforcement

This repository has **no git remote**, so `.github/workflows/ci.yml` never executes — it is
kept for the day the project gains a GitHub remote, and it is inert until then. Enforcement
today is local:

| When | What runs | Cost |
|---|---|---|
| Every commit | `bun run check` via the `.githooks/pre-commit` hook | under a second |
| Before tagging a milestone | `bun run verify` — check, lint, typecheck, test | about 76 seconds |

Enable the hook once per clone:

```bash
bun run setup:hooks
```

The slow gates are deliberately kept out of the commit hook. A pre-commit hook that costs
over a minute gets bypassed with `--no-verify`, and a bypassed gate is worse than an honest
manual one.

## Layout

| Path | Purpose |
|---|---|
| `apps/api` | Hono on Bun — adapters only, no domain logic |
| `apps/web` | Nuxt 4 application shell |
| `apps/landing` | Astro marketing site |
| `packages/core` | Domain entities, use cases and ports. **Zero framework imports** |
| `packages/markdown` | The single shared unified/remark pipeline |
| `packages/contracts` | Shared zod schemas, including the environment schema |
| `packages/editor` | Milkdown/ProseMirror integration and round-trip guarantees |
| `packages/db` | Drizzle schema, migrations and the query layer |

`packages/core` is the keystone: it holds the business rules and imports no framework, so
the surrounding adapters stay replaceable.
