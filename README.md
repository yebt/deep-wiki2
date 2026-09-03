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
`env.example`; `bun run check` fails if the two drift apart.

## Commands

Run from the repository root:

| Command | What it does |
|---|---|
| `bun run typecheck` | Type-checks every workspace member and the root scripts |
| `bun run lint` | ESLint across the repository |
| `bun run test` | Runs the test suite for every package and app |
| `bun run check` | Structural checks: workspace shape, test coverage, core purity, env drift |

`bun run check` is the guard rail. It fails when a package has no real test, when
`packages/core` gains a framework import, when the second test runner spreads beyond
`apps/web`, or when `env.example` drifts from the schema.

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
