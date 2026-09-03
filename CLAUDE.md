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
| `bun run test` | Test suite for every package and app, plus the check scripts' own tests |
| `bun run check` | The structural guard rail |

`bun run check` fails when:

- `pnpm-lock.yaml`, `pnpm-workspace.yaml` or `turbo.json` appears at the root, or Vitest spreads beyond the one workspace member allowed to use it (`workspace-shape.ts`);
- a workspace member has no executing test, or a test file declares a test without a single `expect(`/`assert(` — an assertion-free test counts as no coverage, not as green (`test-coverage.ts`);
- `packages/core` imports anything non-relative — a framework, a Bun API, or even a Node built-in — or declares a runtime dependency. Detection is AST-accurate via `Bun.Transpiler().scanImports()`; no ESLint disable comment can silence it (`core-purity.ts`);
- `env.example` drifts from the zod schema in `packages/contracts/src/env.ts` (`env-example.ts`).
</content>
