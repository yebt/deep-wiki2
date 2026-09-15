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
`kroki` alone cannot render Mermaid; see `compose.yaml`). `bun run db:migrate` applies every
migration in `packages/db/drizzle/` — tenancy and permissions (nodes, workspaces, users,
cells, permissions, sessions, password resets, registration, invitations), content
(`page_content`, `page_blocks`, `links`, `page_tags`, `page_locks`) and versioning and
collaboration (`page_revision`, `changeset`, `comments`, the `presence` view). `bun run
db:seed` (`packages/db/seed.ts`) is idempotent and gives you something to look at: one plan,
one Super Root account (`owner@deep-wiki.local` / `deep-wiki-dev`, overridable with
`SEED_EMAIL`/`SEED_PASSWORD`), one workspace with a `manage` grant at its root, and a content
tree of **2 shelves, 4 books, 4 chapters and 7 pages** saved through the real `savePage`
transaction so they carry block ids, links and tags like any page a person saves. It prints
the workspace and page ids it created as URLs. Re-running it never resets a password you
changed or a page you edited.

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
| `bun run check` | Eleven structural checks — workspace shape, per-file test coverage, core purity, env-template drift and secrets, compose portability, query boundaries, single markdown parser, diff-input purity, bundle isolation, routes mounted, single-source hierarchy. What each enforces is listed in `CLAUDE.md` |
| `bun run verify` | Every gate in one run: `check`, `env:check`, `lint`, `typecheck`, `test`, `gate-2-round-trip`, `check:bundle`, `e2e`. Run before tagging; not in the commit hook |
| `bun run env:check` | Verifies your local `.env`'s ports agree with what compose publishes |
| `bun run db:migrate` | Runs Drizzle migrations against `DATABASE_URL` |
| `bun run db:seed` | Runs the seed script against `DATABASE_URL` |
| `bun run compose:smoke` | Against a running compose stack: sends a real message over Mailpit's SMTP port and retrieves it via its API, and renders a real Mermaid diagram through Kroki — proves those two services actually work, not merely that they started |

`bun run check` is the guard rail, and it is what `.githooks/pre-commit` runs (`bun run
setup:hooks` once per clone). It fails when a source file has no test that names it, when a
package has no executing test, when `packages/core` gains a framework import or an ambient
runtime global, when the second test runner spreads beyond `apps/web`, when `env.example`
drifts from the schema or carries something that is not an agreed placeholder under a
secret-shaped key, when a compose file uses a Docker-specific extension, an unlabelled bind
mount or a port below 1024, when something outside `packages/db/src/permissions` reads the
`permissions` table, when a second markdown parser or a second `unified()` pipeline appears,
when a diff caller reads the stored `block_index`, when read mode can reach the editor
bundle, when a route module is never mounted, or when the node hierarchy is written down
twice. The full list, with what each check actually measures, is in `CLAUDE.md`.

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

### Running two worktrees at once

Nothing to configure. Every value the test harness needs to keep to itself — both compose
project names, the five container host ports, the two e2e server ports and the MinIO test
bucket — is derived from the worktree's own absolute path by
`packages/db/testing/worktree.ts`. The main checkout keeps the values it always had (Postgres
`55432`, Mailpit `11025`/`18025`, MinIO `19000`/`19001`, e2e `4000`/`4173`); every linked
worktree gets its own block of eight consecutive ports in **13008–14990**, a range chosen to sit
clear of the dev stack, of the main checkout's test stack, and of this kernel's ephemeral range.
The derivation is a pure function of the path, so a worktree gets the same values on every run
and reuses its own containers rather than orphaning them.

The compose **project name** matters more than the port. Compose keys a stack by project name
alone: with a fixed `name:`, `up` from a second worktree does not collide on the port — it
*replaces* the first worktree's container, and that worktree's database disappears mid-run.

To see what this worktree derives:

```bash
bun run packages/db/testing/worktree.ts
```

That prints the environment as `export` lines; `eval "$(...)"` it before driving either
`compose.yaml` under `packages/db/testing/` or `apps/api/testing/` by hand, or the defaults in
those files will start the *main checkout's* stack. Every derived value can be overridden
explicitly — `DEEPWIKI_TEST_SLOT` moves a whole block, `DEEPWIKI_TEST_PG_PORT` and friends move
one port each.

The test Postgres stamps itself with a `dw_owner_<tag>` database naming the worktree that
started it. If two worktrees ever land on the same slot, provisioning stops and says so, rather
than quietly running one worktree's suites against the other's schema.

### The container stack

```bash
podman compose up -d --wait     # postgres+pgvector, mailpit, minio, kroki, mermaid
bun run db:migrate
bun run db:seed                 # prints the sign-in credentials it creates
podman compose down -v          # tear down, including volumes
```

The published host ports default to the conventional ones (5432, 1025, 8025, 9000, 9001, 8000).
**`podman compose up` fails on a port collision before any service starts**, so if your machine
already runs another project on one of them, move the published port in `.env` — the variables
are at the top of `env.example`. The container-side ports never change, so nothing else needs
adjusting.

**If you move `POSTGRES_HOST_PORT`, move the port inside `DATABASE_URL` to match**, and likewise
`MAILPIT_SMTP_HOST_PORT` with `SMTP_PORT`. Each pair is the same fact written twice: one tells
compose where to publish, the other tells the app where to connect. Change only one and the app
connects to whatever else owns the old port — the error then comes back from *that* server,
naming a database and a role you never configured. `bun run env:check` catches it in a second and
names both values. It runs in `bun run verify` but deliberately not in the pre-commit hook, since
`.env` is your local state rather than the repository's.

Note that `bun run test` provisions its own throwaway containers on separate ports and leaves
them running for reuse. Run `podman ps` if a port you expected to be free is not.

### Enforcement

This repository has **no git remote**, so `.github/workflows/ci.yml` never executes — it is
kept for the day the project gains a GitHub remote, and it is inert until then. Enforcement
today is local:

| When | What runs | Cost |
|---|---|---|
| Every commit | `bun run check` via the `.githooks/pre-commit` hook | under a second |
| Before tagging a milestone | `bun run verify` — check, env:check, lint, typecheck, test, gate-2-round-trip, check:bundle, e2e | minutes: it builds `apps/web` and runs the Playwright suite against a real backend |

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
| `packages/editor` | The editor, built directly on ProseMirror (no Milkdown): schema, markdown round trip, mount entry |
| `packages/db` | Drizzle schema, migrations and the query layer |

`packages/core` is the keystone: it holds the business rules and imports no framework, so
the surrounding adapters stay replaceable.
