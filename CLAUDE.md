# CLAUDE.md

Routing document for Claude and its subagents working in this repository. It tells you where authority lives; it does not duplicate it.

## What deep-wiki is

A self-hosted, multi-tenant wiki for software teams **and** AI agents. A team brings a raw idea, the system interrogates it with AI until it becomes a well-declared design document with diagrams, and the resulting corpus becomes the team's single source of truth — and a RAG surface agents query over MCP. Markdown is the content the user owns. Read [`docs/SPECS.md`](docs/SPECS.md) before making any design decision; it is the reference for what this product is and why each structural choice was made.

## Mandatory — before any UI work

**Before writing or modifying ANY user interface code, read [`docs/UI-CHECKLIST.md`](docs/UI-CHECKLIST.md) AND [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) in full.**

Not skim. Not grep. In full, both files, before the first line of markup.

- `docs/UI-CHECKLIST.md` is the pass/fail gate: required states, accessibility floor, responsive behaviour, e2e coverage.
- `docs/DESIGN-SYSTEM.md` is the aesthetic system: colour roles, type scale, shape, elevation, state layers, motion, spacing, density.

UI work is reviewed by the project owner against those two files. **Work that fails them is rejected**, and rejected work does not get built on top of. The checklist wins on conflict, on correctness and accessibility matters.

## Non-negotiables

- **Bun workspaces.** Run per-package scripts with `bun run -F <package> <script>`. Never pnpm. Never npm. Never Turborepo, Nx, or any other task runner.
- **`packages/core` has zero framework imports.** It holds domain entities, use cases and ports, and nothing else. **This is machine-enforced** by `scripts/checks/core-purity.ts` — do not attempt to work around it.
- **`packages/markdown` is the single shared markdown parser.** One unified/remark pipeline for the whole repository. A second parser is a permanent bug class; do not add one.
- **Markdown is the source of truth.** The ProseMirror document is an in-memory view, never a persisted format. Round-tripping through it must not alter the canonical markdown.
- **The environment template is `env.example`** — copied to `.env`. **Not `.env.example`**; a permission rule blocks that path. Every variable in `packages/contracts/src/env.ts` must appear in `env.example`, and `env.example` must never contain a secret.
- **Conventional Commits.** No AI attribution of any kind — no `Co-Authored-By` trailers, no "Generated with" lines, no tool names in commit messages.

## Where things are written down

| Path | What it holds |
| --- | --- |
| [`docs/SPECS.md`](docs/SPECS.md) | The specification: vision, domain model, permissions, AI layer, MCP surface, infrastructure |
| [`docs/TODO.md`](docs/TODO.md) | The roadmap, plus the running log of Findings, Fixes and Open Questions. Append findings here; never delete entries |
| [`docs/UI-CHECKLIST.md`](docs/UI-CHECKLIST.md) | The UI review gate and its Review Log |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | The visual design system |
| [`openspec/`](openspec/) | SDD artifacts — proposals, specs, designs, tasks, and the archive |

## Commands

Run from the repository root.

| Command | What it does |
| --- | --- |
| `bun run typecheck` | Type-checks every workspace member and the root scripts |
| `bun run lint` | ESLint across the repository |
| `bun run test` | Test suite for every package and app, plus the check scripts' own tests. `packages/db`'s suites auto-provision a disposable test Postgres (`packages/db/testing/provision.ts`); set `DEEPWIKI_TEST_NO_AUTOSTART=1` to opt out and fail fast instead |
| `bun run check` | The structural guard rail. This is what the `.githooks/pre-commit` hook runs |
| `bun run verify` | Every gate — `check`, the local `.env` port consistency, `lint`, `typecheck`, `test`, `gate-2-round-trip`, and finally the Playwright `e2e` suite. Run it before tagging a milestone; it is not in the commit hook. The e2e step needs a browser binary once: `bun run e2e:install` |
| `bun run env:check` | Compares your local `.env`'s ports against what `compose.yaml` publishes. Deliberately outside the commit hook: `.env` is your machine's state, not the repository's |

`bun run check` fails when:

- `pnpm-lock.yaml`, `pnpm-workspace.yaml` or `turbo.json` appears at the root, or Vitest spreads beyond the one workspace member allowed to use it (`workspace-shape.ts`);
- any source file under `apps/*` or `packages/*` has no test that names it — coverage is measured **per file**, not per workspace member. A file counts as covered when a test **value-**imports it directly, imports one of its exported **value** bindings by name through a pure re-export barrel or a workspace entry point, or has a named sibling test (`<stem>.test.ts`). A wildcard `import * as x` credits the barrel and nothing behind it, and a type-only import (`import type { X }`, `import { type X }`) credits nothing at all — it erases at compile time, so it exercises nothing. Exemptions are mechanical, not by name: a file is exempt when it erases to nothing at runtime (measured with `Bun.Transpiler().transformSync()`), when it is a pure re-export barrel, generated, or named `<tool>.config.<ext>` **and imported by no module** (a `*.config.ts` something imports is a module, not tool configuration) — plus an explicit `ALLOW_LIST` where each entry carries a reason and becomes an error once the file is covered or gone. A test file with zero assertions is an error in its own right and credits nothing — and assertions are counted in code only, never in a comment or a string literal (`test-coverage.ts`);
- `packages/core` imports anything non-relative — a framework, a Bun API, or even a Node built-in — or declares a runtime dependency. Detection is AST-accurate via `Bun.Transpiler().scanImports()`; no ESLint disable comment can silence it (`core-purity.ts`);
- `env.example` drifts from the zod schema in `packages/contracts/src/env.ts` (`env-example.ts`).
</content>
