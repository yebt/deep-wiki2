# Proposal: Tenancy and Permissions (Phase 1)

## Intent

Phase 0 left `packages/db/src/schema.ts` empty: the product has no tenants, no content tree, and no authorisation. Every later phase reads and writes through a permission decision that does not exist yet. This phase builds the multi-tenant skeleton and the single authorisation path, front-loaded because an inheritance bug here silently exposes one tenant's documents to another.

**Headline sequencing requirement — GATE-1**: the permission truth-table suite is written and passing **before any permission-aware UI exists**. This is an ordering constraint on the work, not an aspiration; UI work in this change is blocked until it is green.

## Scope

### In Scope

| Deliverable | Constraint |
|---|---|
| `nodes` tree: workspace/shelf/book/chapter/page, `parent_id`, `position`, `ltree` path + GiST index | Pages may sit directly under a book (SPECS §3.1) |
| `workspaces`, `users`, `cells`, `cell_members` | Cells are groups, not people |
| Super Root identity; `plans` + per-workspace limits | Bounds workspaces per owner |
| `permissions` — one table, `(subject_type, subject_id, resource_type, resource_id, action, effect)` | Single table, no per-level variants |
| Recursive-CTE resolver + `can(subject, action, resource)` in `packages/core` | The only decision path: HTTP, MCP, jobs |
| **GATE-1 truth table (~30 cases)** | Precedes UI |
| `registration_mode` `closed`/`invitation_only`/`open`, default `invitation_only` | `open` refuses without a verified SMTP test send; optional domain allowlist |
| `MailSender` SMTP adapter (Mailpit in dev); invitation flow | Port defined Phase 0; adapter here |
| `BlobStore` adapters (S3-compatible + local filesystem); profile photos | Self-hosters will not run MinIO |
| Sessions and password reset over `MailSender` | — |

### Out of Scope

Markdown pipeline internals and the editor (Phase 2); revisions, changesets, diffs, comments, presence (Phase 3); diagrams (Phase 4); AI layer, embeddings, retrieval (Phase 5); team rule packs (Phase 6); MCP and `packages/ai-tools` (Phase 7); all UI beyond what GATE-1 permits. `links`, `tags`, `page_tags` stay with Phase 2 that derives them.

> Known doc discrepancy, deliberately unresolved here: SPECS §13 lists `packages/ai-tools` in the layout while the roadmap defers it to Phase 7. Do not let it pull scope.

## GATE-1 truth table

| Category | Cases |
|---|---|
| Inheritance down each level (workspace → shelf → book → chapter → page) | 6 |
| `deny` beats `allow` at the same specificity | 4 |
| A more specific `allow` beats an inherited `deny` | 5 |
| Cell/team-derived grants, incl. overlap with a direct user grant | 5 |
| `agent` subject scoped to exactly one book | 4 |
| Cross-workspace isolation — no grant resolves across `workspace_id` | 4 |
| No matching grant resolves to deny | 2 |
| **Total** | **30** |

## Capabilities

### New Capabilities

- `tenancy-model`: workspaces, the `nodes` tree, cells, Super Root, plan limits
- `permission-resolver`: the `permissions` table, the recursive CTE, `can()`, GATE-1
- `registration-policy`: `registration_mode`, SMTP-verified `open`, domain allowlist
- `invitations`: create, send, accept, join with a starting permission set
- `authentication`: sessions and password reset
- `mail-delivery`: the SMTP `MailSender` adapter
- `blob-storage`: S3-compatible and filesystem `BlobStore` adapters, profile photos

### Modified Capabilities

- `container-stack`: the "Five Services Start Cleanly" requirement asserts only `vector` is installed; it must also assert `ltree`

## Approach

Schema first, resolver second, adapters third, UI last and only behind GATE-1.

Split the resolver across the hexagonal boundary, as `openspec/config.yaml` requires: **`packages/core` stays framework-free** and owns the precedence decision as a pure function of `(grant rows, ancestor path)`, unit-tested with no database. **`packages/db`** owns the recursive CTE that produces those rows. The pure half makes the 30 cases cheap; the SQL half makes them real.

Every read and write path goes through the single `can()` entry point. A second, more permissive path for machines is the failure mode this design exists to prevent (SPECS §2).

## Cross-cutting gates

| Gate | Assessment |
|---|---|
| **GATE-1 — permissions** | **Owned by this change.** Truth table green before any permission-aware screen. |
| **GATE-2 — markdown round-trip** | Untouched. No markdown parsing or serialisation in scope. |
| **GATE-3 — vector tenant isolation** | Not implemented here, but this change defines the `workspace_id` GATE-3 will filter on. Phase 1 must make it **non-nullable on every tenant-scoped table, never derivable from the request body, and resolved from the authenticated subject** — otherwise Phase 5 has nothing trustworthy to put in the `WHERE` clause. |

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `packages/db/src/schema.ts`, `packages/db/migrations/` | New | First real schema; enums, tables, indexes |
| `packages/core/src/permissions/`, `.../ports/` | New | Pure resolver, `can()`; ports unchanged |
| `packages/core/src/adapters/` → `apps/api` | New | Adapters live outside `core` (purity check) |
| `packages/contracts/src/env.ts`, `env.example` | Modified | SMTP, blob-store, session vars — drift is CI-enforced |
| `infra/postgres/init/01-extensions.sql` | Modified | Add `ltree` |
| `apps/api` | Modified | Auth, invitation, upload routes |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Recursive CTE subtly wrong — a silent cross-tenant read | High | Correctness: the 30-case suite runs against real Postgres, not a mock, plus the pure decision function tested in isolation in `core`. Written first, per `strict_tdd`. |
| Recursive CTE expensive without indexes | Med | Cost: an `EXPLAIN (ANALYZE, BUFFERS)` assertion that fails on a sequential scan over `nodes` or `permissions`; GiST on `nodes.path`, composite index on `(workspace_id, resource_id, subject_id)`. Measured, not assumed. |
| `ltree` unavailable in `pgvector/pgvector:pg17` | Med | **Verified**: `infra/postgres/init/01-extensions.sql` creates only `vector`, so `ltree` is definitely **not enabled today**. It is a contrib extension expected in the official `postgres:17` base the image derives from, but that is **unconfirmed on this machine** — the first migration task must prove it with a real `CREATE EXTENSION IF NOT EXISTS ltree` against the running container before any dependent work. Fallback if absent: materialised `text` path with a `text_pattern_ops` index. |
| Init script does not re-run on existing dev volumes | High | `CREATE EXTENSION IF NOT EXISTS ltree` belongs in the **migration**, not only in the init script — that script runs once against a fresh data directory. |
| Credential handling in sessions and reset | High | Never log, serialise to any response, or render: password hashes, session tokens, reset tokens, SMTP credentials. Store session and reset tokens hashed, single-use, expiring; constant-time compare; reset responses must not disclose whether an account exists. |
| Open Question unresolved: SQLite appliance distribution (`docs/TODO.md`) | Med | It explicitly asks to be answered "before Phase 1 hardens the persistence layer". `ltree` and recursive CTEs are Postgres-specific. **Surfaced for the owner; not decided here.** |

## Rollback Plan

This change introduces the first real database schema, so rollback is migrations, not just reverting code.

1. **Code**: revert the PR. `packages/db` returns to an empty schema and no consumer references it.
2. **Schema**: every migration ships a tested `down`, applied in reverse order. Work units are ordered so each down is independently applicable (`permissions` → `cells`/`plans` → `nodes` → `workspaces`/`users`).
3. **Extensions**: `ltree` is left installed on rollback. Dropping a shared extension is destructive and it is inert if unused.
4. **Dev reset**: `podman compose down -v` then re-bootstrap — the init script re-runs only on a fresh volume.
5. No production deployment exists, so no tenant data is at risk; the practical path is roll-forward with a corrective migration.

## Dependencies

- Phase 0 complete (workspace, compose stack, CI, `strict_tdd: true`).
- `MailSender` and `BlobStore` port interfaces in `packages/core`.
- Running Postgres with `ltree` — verify before dependent work.
- **Blocking-adjacent**: the SQLite appliance Open Question. Escalated, not assumed.

## Success Criteria

- [ ] All 30 GATE-1 truth-table cases pass, and no permission-aware UI was written before they did
- [ ] `can()` is the single decision point; no query path bypasses it
- [ ] `EXPLAIN` assertion proves index usage for the resolver at both extremes of the tree
- [ ] `packages/core` purity check still passes with the resolver inside it
- [ ] `registration_mode` refuses `open` without a successful SMTP test send
- [ ] Invitation and password-reset mail lands in Mailpit end to end
- [ ] `BlobStore` profile-photo upload passes against both MinIO and the filesystem adapter
- [ ] `workspace_id` is non-nullable on every tenant-scoped table and never taken from the request body
- [ ] `bun run check`, `bun run test`, `bun run typecheck`, `bun run lint` all green
