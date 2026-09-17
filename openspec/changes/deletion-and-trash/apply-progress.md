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

## Scope executed — Work unit 2 (Phase 2 only)

**Mode**: Strict TDD

### Completed Tasks (Phase 2 — all 4)

- [x] 2.1 RED: `scripts/checks/__tests__/trash-filter.test.ts` + fixtures under `scripts/checks/__fixtures__/trash-filter/{valid,violating-base-table,violating-page-keyed,stale-allow-list}/`
- [x] 2.2 GREEN: `scripts/checks/trash-filter.ts` — rule 1 (base table), rule 2 (page-keyed tables), `ALLOW_LIST`
- [x] 2.3 Wired `bun run scripts/checks/trash-filter.ts` into `package.json`'s `check` script, after `single-source.ts`
- [x] 2.4 Ran `bun run check` against the real tree and recorded the red list below (proof-of-red evidence)

### TDD Cycle Evidence

| Task | RED (observed failure) | GREEN |
|---|---|---|
| 2.1–2.2 rule 1 (base table) | Before `trash-filter.ts` existed, `bun test scripts/checks/__tests__/trash-filter.test.ts` failed to resolve the module (`Cannot find module '../trash-filter'`); once the module existed but before the rule was implemented, the `violating-base-table` fixture test failed because `result.ok` was `true` and no error mentioned `leaky.ts`/rule 1 | `violating-base-table` fixture: both the SQL-text (`leaky.ts`) and Drizzle-builder (`leaky-drizzle.ts`) spellings are flagged; `valid` fixture stays green |
| 2.1–2.2 rule 2 (page-keyed) | Same missing-module failure, then (module present, rule unimplemented) `violating-page-keyed` fixture's `changesets/history.ts` produced no rule-2 error | `violating-page-keyed` fixture flags `changesets/history.ts`; `valid` fixture's `changesets/history.ts` (joins `live_nodes`) stays green |
| 2.1–2.2 ALLOW_LIST validity (empty reason, missing file, stale entry) | Before `checkAllowListValidity` existed, an empty-reason entry, a nonexistent-path entry, and a no-longer-tripping entry all produced `result.ok === true` with no `ALLOW_LIST:`-prefixed error | All three now produce a distinct `ALLOW_LIST:`-prefixed error; a still-violating pending entry and a directory entry (present or absent) produce none |
| 2.3 wiring | Before the `package.json` edit, `checks-wiring.test.ts`'s `W1`/`W2` parametrised cases for `trash-filter.ts` were not part of the enumerated `checks` array yet (the file did not exist), so they could not have run at all — the first real signal was `bun run scripts/checks/trash-filter.ts` not being reachable from `check` | `checks-wiring.test.ts` (47 tests) passes with `trash-filter.ts` now enumerated and reachable from both `check` and (transitively) `verify` |
| 2.4 first real run | N/A — this task is the RED observation itself, not a RED/GREEN pair | `bun run check` initially failed with the 24-file red list below (plus one `ALLOW_LIST: packages/db/src/trash/ no longer exists` self-inflicted error, fixed by exempting directory entries from the existence check — see Deviations #2) |

### Files Changed

| File | Action | What Was Done |
|---|---|---|
| `scripts/checks/trash-filter.ts` | Created | `checkTrashFilter()`: rule 1 (base table, text + Drizzle-builder twin), rule 2 (8 page-keyed tables, text only per design), `ALLOW_LIST` (`Record<path, reason>`) with existence + staleness validation for file entries, existence-and-staleness exemption for directory entries |
| `scripts/checks/__tests__/trash-filter.test.ts` | Created | 10 tests: valid fixture, both rule-1 spellings, rule 2, ALLOW_LIST silencing, empty-reason error, missing-file error, stale-entry error, directory-entry exemption, real-`ALLOW_LIST`-has-reasons sanity test |
| `scripts/checks/__fixtures__/trash-filter/valid/**` | Created | Compliant `read-live.ts` (rule 1) and `changesets/history.ts` (rule 2, joins `live_nodes`) |
| `scripts/checks/__fixtures__/trash-filter/violating-base-table/**` | Created | `leaky.ts` (SQL text) and `leaky-drizzle.ts` (Drizzle builder) |
| `scripts/checks/__fixtures__/trash-filter/violating-page-keyed/**` | Created | `changesets/history.ts` reading `changeset` with no live view named |
| `scripts/checks/__fixtures__/trash-filter/stale-allow-list/**` | Created | `fixed.ts` (already compliant — proves the entry naming it is stale) and `still-leaky.ts` (still violating — proves the entry naming it is not stale) |
| `package.json` | Modified | `check` script gained `&& bun run scripts/checks/trash-filter.ts` after `single-source.ts` (12th check) |
| `CLAUDE.md` | Modified | Check count "eleven" → "twelve"; added item 12 describing `trash-filter.ts` in the same voice as items 1–11; refreshed the "as of" date |
| `openspec/changes/deletion-and-trash/tasks.md` | Modified | Marked 2.1–2.4 `[x]`; annotated 2.4 pointing to this file's red list and the `ALLOW_LIST` workaround |

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command | `bun test scripts/checks/__tests__/trash-filter.test.ts` → 10 pass, 0 fail. `bun test scripts/checks` (full suite) → 316 pass, 2 skip, 1 todo, 0 fail across 50 files |
| Runtime harness | N/A — pure source-text/AST-adjacent regex check, no service boundary, exactly as tasks.md's Suggested Work Units table states for unit 2 |
| Rollback boundary | Remove `scripts/checks/trash-filter.ts`, its test, its fixtures, and the one `package.json` line; `checks-wiring.test.ts` and `bun run check` both stay green on the remaining eleven checks. The temporary `ALLOW_LIST` pending entries (see below) revert independently, one line per site, as each is fixed in Phase 3/4 |

## The Red List (task 2.4's proof-of-red evidence)

Running `bun run scripts/checks/trash-filter.ts .` against the real tree, with **no** pending entries in `ALLOW_LIST` (i.e., only Decision 2's initial entries present), flags **24 distinct files**. This is the exact Phase 3/4 checklist — every file below must gain a live-view read before its `ALLOW_LIST` line (added below) can be deleted:

### Named by an existing tasks.md task (16 files)

| File | Rule(s) | Task |
|---|---|---|
| `packages/db/src/nodes/create.ts` | 1 | 3.3 |
| `packages/db/src/nodes/rename.ts` | 1 | 3.5 |
| `packages/db/src/nodes/move.ts` | 1 | 3.7 |
| `packages/db/src/nodes/reorder.ts` | 1 | 3.9 |
| `packages/db/src/revisions/queries.ts` | 1, 2 | 3.15 |
| `packages/db/src/changesets/history.ts` | 2 | 3.17 |
| `packages/db/src/comments/queries.ts` | 1, 2 | 3.19 |
| `apps/api/src/routes/tree.ts` | 1 | 4.2 |
| `apps/api/src/routes/pages.ts` | 1 | 4.4 |
| `apps/api/src/routes/links.ts` | 1, 2 | 4.6 |
| `apps/api/src/routes/mentions.ts` | 1 | 4.8 |
| `apps/api/src/routes/tags.ts` | 1, 2 | 4.10 |
| `apps/api/src/routes/revisions.ts` | 1 | 4.14 |
| `apps/api/src/routes/diff.ts` | 1 | 4.14 |
| `apps/api/src/routes/presence.ts` | 1 | 4.16 |
| `apps/api/src/routes/workspaces.ts` | 1 | 4.18 |
| `apps/api/src/routes/invitations.ts` | 1 | 4.18 |
| `apps/api/src/routes/ai-credentials.ts` | 1 | 4.18 |

### Not named by any existing tasks.md task (8 files — a Finding for Phase 3/4)

| File | Rule(s) | Why it exists |
|---|---|---|
| `packages/db/src/changesets/resolve-changeset.ts` | 1 | Reads the base `nodes` table; not in tasks.md's Phase 3 list |
| `packages/db/src/changesets/book-diff.ts` | 2 | Reads `page_revision` with no live view named |
| `packages/db/src/comments/reconcile-comments.ts` | 2 | Reads `comments` with no live view named |
| `packages/db/src/locks/page-lock.ts` | 2 | Reads `page_locks` with no live view named |
| `packages/db/src/presence/queries.ts` | 2 | Reads `presence` with no live view named — Phase 3/4 has no task for this module (4.16 covers only the route) |
| `apps/api/src/routes/comments.ts` | 1, 2 | Reads the base `nodes` table and `comments` with no live view named — not in tasks.md's Phase 4 list |

`apps/api/src/routes/activity.ts` (tasks 4.11–4.12) is correctly **absent** from this list: it never queries `nodes`/`page_content`/a page-keyed table itself — it calls `listWorkspaceRevisions()` (`revisions/queries.ts`) and `listOpenThreadsForUser()` (`comments/queries.ts`), both already on the list above under their own tasks. Whether 4.11/4.12 still need a RED/GREEN pair of their own, or fold into 3.15/3.19 landing, is a decision for whoever picks up Phase 3/4.

## Deviations from Design

1. **The `ALLOW_LIST` shape.** Design Decision 2 says `ALLOW_LIST` is "a `Record<path, reason>` as in `test-coverage.ts`", but `test-coverage.ts`'s own `ALLOW_LIST` is actually `readonly Exemption[]` (an array of `{file, reason}`). Followed the design text literally (`Record<string, string>`) since it is simpler and the design explicitly names the shape, not just "the same file". No functional gap either way — both let an entry carry a reason and both support the same staleness check.
2. **Directory `ALLOW_LIST` entries are exempt from the existence check, not just the staleness check.** The first real run against the tree self-flagged `ALLOW_LIST: packages/db/src/trash/ no longer exists`, because design Decision 2 lists `packages/db/src/trash/` as an initial entry even though that directory is Phase 5's deliverable, not Phase 2's. Rather than drop the entry (which design explicitly wants present now) or hand-wave the check, directory entries (trailing `/`) are exempt from both the existence and the staleness check — their justification is structural ("the resolver must walk trashed rows"), not a property of any one file inside them, so neither check can say anything meaningful about them anyway.
3. **Pre-commit-forced `ALLOW_LIST` workaround, chosen deliberately.** `.githooks/pre-commit` runs `bun run check` under `set -e`, so the 24-file red list above would refuse this commit outright. Per this work unit's explicit instruction, I chose the **allow-list workaround**, not leaving `check` red: all 24 sites are temporarily in `ALLOW_LIST` (see `scripts/checks/trash-filter.ts`'s "Phase 3/4 pending" block), each carrying its own reason line naming either the exact task that will remove it or, for the 8 undocumented sites, stating plainly that no task names it yet. The stale-entry rule (task 2.2/Deviation above) means each line becomes a build error — not silence — the instant the corresponding file is rewritten to use the live view, which is what forces Phase 3/4 to delete them one at a time rather than forgetting one.
4. **8 real read sites tasks.md does not name.** `packages/db/src/changesets/{resolve-changeset,book-diff}.ts`, `packages/db/src/comments/reconcile-comments.ts`, `packages/db/src/locks/page-lock.ts`, `packages/db/src/presence/queries.ts`, and `apps/api/src/routes/comments.ts` all trip the check but have no task in tasks.md's Phase 3/4 file lists. This is a genuine tasks.md gap surfaced by running the check for real, not a false positive: each one is listed in the Red List table above with the exact rule it trips, so whoever runs Phase 3/4 has the full, mechanically-verified set rather than tasks.md's narrower hand-written one.

## Issues Found

None beyond the tasks.md gap recorded as Deviation #4 above.

## Remaining Tasks (not in this work unit's scope)

- [ ] Phase 3 (green: db layer) through Phase 12 (docs + final verification) — see tasks.md. Phase 3/4 must also close the 8-file gap in Deviation #4, in addition to tasks.md's own list, before the `ALLOW_LIST` "Phase 3/4 pending" block in `scripts/checks/trash-filter.ts` can be deleted.

## Full Verification (this work unit)

- `bun run check` — ok (12/12 structural checks pass, `trash-filter` included)
- `bun run typecheck` — exit 0 (root `tsc --noEmit` + every workspace member, including `apps/web`/`apps/api`/`apps/landing`)
- `bun run lint` — exit 0 (root `eslint .` + every workspace member)
- `bun test scripts/checks` — 316 pass, 2 skip, 1 todo, 0 fail (50 files, includes `trash-filter.test.ts` and `checks-wiring.test.ts`)

## Status

Phase 1: 10/10 complete. Phase 2: 4/4 complete. Ready for `sdd-verify` on this work unit, then `sdd-apply` again for Phase 3.
