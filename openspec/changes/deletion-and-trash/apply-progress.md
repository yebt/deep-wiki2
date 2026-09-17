# Deletion and Trash — Apply Progress

**Change**: deletion-and-trash
**Scope executed**: Work unit 1 — Phase 1 tasks only (migration 0022_trash + core trash rules)
**Mode**: Strict TDD

## Completed Tasks (Phase 1 — all 10)

- [x] 1.1 RED: `packages/core/src/trash/rules.test.ts` — decideTrash table (node-trash spec)
- [x] 1.2 GREEN: `packages/core/src/trash/rules.ts` — decideTrash(), zero framework imports
- [x] 1.3 RED: extended rules.test.ts — decideRestore table (trash-restore spec)
- [x] 1.4 GREEN: decideRestore(), TRASH_RETENTION_DAYS=30, daysUntilPurge(); trash/index.ts barrel
- [x] 1.5 core-purity check ok (see Deviations — ran `bun run scripts/checks/core-purity.ts` from repo root)
- [x] 1.6 RED: migration.test.ts — assertions for trashed_at/trash_operation_id/trashed_by, nodes_parent_slug_live_idx, live_nodes/live_page_content views, node_deletions/trash_purge_runs tables, nodes_trash_guard() trigger behavior
- [x] 1.7 GREEN: `packages/db/drizzle/0022_trash.sql` + `packages/db/drizzle/down/0022_trash.down.sql`; `packages/db/src/schema.ts` additions
- [x] 1.8 RED: down-migration tests — refuses on trashed/live slug collision, reverses cleanly otherwise
- [x] 1.9 GREEN: refusal branch built into down/0022_trash.down.sql from the start
- [x] 1.10 create.test.ts/rename.test.ts — new describe blocks stating live-only slug uniqueness via raw SQL

## TDD Cycle Evidence

| Task | RED (observed failure) | GREEN |
|---|---|---|
| 1.1-1.2 decideTrash | `Cannot find module './rules'` | 6 decideTrash tests pass |
| 1.3-1.4 decideRestore/retention | `Export named 'daysUntilPurge' not found` (observed after 1.2 landed, confirming decideTrash alone was green first) | 8 more tests pass (14 total in rules.test.ts) |
| 1.6-1.7 migration | `column "trashed_at" of relation "nodes" does not exist` (9 tests failed for that exact reason) | 38/38 migration.test.ts tests pass |
| 1.8-1.9 down migration | same missing-column failure, folded into the above RED run | both down-migration tests pass (refusal + clean reverse) |
| 1.10 live-only slug | N/A — additive tests against already-green migration, not a new production-code RED/GREEN pair | 21/21 pass across create.test.ts + rename.test.ts |

## Files Changed

| File | Action | What Was Done |
|---|---|---|
| `packages/core/src/trash/rules.ts` | Created | decideTrash, decideRestore, TRASH_RETENTION_DAYS, daysUntilPurge |
| `packages/core/src/trash/rules.test.ts` | Created | 14 tests covering both spec tables + retention arithmetic |
| `packages/core/src/trash/index.ts` | Created | barrel |
| `packages/core/src/index.ts` | Modified | re-exports trash rules |
| `packages/db/drizzle/0022_trash.sql` | Created | Decision 1: columns, partial index, guard trigger, live views, node_deletions, trash_purge_runs |
| `packages/db/drizzle/down/0022_trash.down.sql` | Created | refusal-on-collision + clean reverse |
| `packages/db/drizzle/meta/_journal.json` | Modified | idx 22 entry |
| `packages/db/src/schema.ts` | Modified | 3 columns on nodes, liveNodes/livePageContent views, nodeDeletions, trashPurgeRuns, trashPurgeRunState enum |
| `packages/db/drizzle/migration.test.ts` | Modified | new assertions for 0022's objects, guard trigger behavior, down-migration refusal + clean reverse; also fixed pre-existing 0008 rollback-order test to run 0022's down first |
| `packages/db/src/nodes/create.test.ts` | Modified | live-only slug uniqueness stated via raw SQL |
| `packages/db/src/nodes/rename.test.ts` | Modified | same, for rename's sibling scope |

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command | `bun test packages/core/src/trash/rules.test.ts` → 14 pass; `bun test packages/db/drizzle/migration.test.ts` → 38 pass |
| Runtime harness | Provisioned test Postgres (`packages/db/testing/provision.ts`), real migrate() + real trigger/constraint behavior — not mocked |
| Rollback boundary | `packages/db/drizzle/down/0022_trash.down.sql` cleanly reverts 0022; core trash files are additive and unreferenced elsewhere yet |

## Full Verification (this work unit)

- `bun run check` — ok (11/11 structural checks pass; `trash-filter.ts` is Phase 2, not yet added)
- `bun run typecheck` — exit 0 (root + every workspace member, including apps/web/api)
- `bun run lint` — exit 0 (root + every workspace member)
- `bun run -F @deep-wiki/core test` — 158 pass, 0 fail
- `bun run -F @deep-wiki/db test` — 473 pass, 0 fail

## Deviations from Design

1. Task 1.5's literal command (`bun run -F @deep-wiki/core check`) does not exist as a script in `packages/core/package.json` (only `test`/`typecheck`). Ran `bun run scripts/checks/core-purity.ts` directly — the actual check root `bun run check` invokes for `packages/core`. No functional deviation; command-name mismatch in the task text only.
2. Task 1.10's tests exercise the migration's partial-index invariant via raw SQL inserts rather than through `createNode()`/`renameNode()`, because those app functions are not rewritten to query `live_nodes` until Phase 3 (design Decision 9). Using the app functions today would fail at the application-level `resolveSiblingSlug` check even though the DB constraint already permits the live/trashed pair. Documented in both test files' new `describe` blocks.
3. Fixed a pre-existing test-ordering coupling in `migration.test.ts`'s `0008_page_content down migration` test: adding `0022`'s `live_page_content` view (which selects from `page_content`) means that test's rollback chain must now also run `0022`'s down migration first. Added in the same rollback-order style the file's own doc comments already describe — not a design deviation, the next link in a chain the file already documents.

## Remaining Tasks (not in this work unit's scope)

- [ ] Phase 2 (trash-filter structural check) through Phase 12 (docs + final verification) — see tasks.md

## Status

10/10 Phase 1 tasks complete. Ready for `sdd-verify` on this work unit, then `sdd-apply` again for Phase 2.
