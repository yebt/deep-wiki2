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

## Scope executed — Work unit 3 (Phase 3 db layer green, plus the gap files)

**Mode**: Strict TDD

### Completed Tasks (Phase 3 db layer — 3.1–3.9, 3.14–3.20, plus new 3.21–3.31 for the gap files)

- [x] 3.1 GREEN: `packages/db/src/nodes/subtree.ts` — `liveOnly` on `queryDescendantIds`; new `trashLiveDescendants()`.
- [x] 3.2–3.3 `packages/db/src/nodes/create.ts` — parent lookup and `resolveSiblingSlug` over `live_nodes`.
- [x] 3.4–3.5 `packages/db/src/nodes/rename.ts` — node lookup over `live_nodes`.
- [x] 3.6–3.7 `packages/db/src/nodes/move.ts` — both node lookups over `live_nodes`.
- [x] 3.8–3.9 `packages/db/src/nodes/reorder.ts` — both node lookups and the sibling-position query over `live_nodes`.
- [x] 3.14–3.15 `packages/db/src/revisions/queries.ts` — `listPageRevisions` joins `live_nodes`; `listWorkspaceRevisions`' existing `nodes` join changed to `live_nodes`.
- [x] 3.16–3.17 `packages/db/src/changesets/history.ts` — per-revision `live_nodes` join; a trashed page's revisions drop out of a changeset, other pages in it stay.
- [x] 3.18–3.19 `packages/db/src/comments/queries.ts` — `listCommentIndicators`, `listCommentThreads` gain a `live_nodes` join; `listOpenThreadsForUser`'s existing `nodes` join changed to `live_nodes`.
- [x] 3.20 `bun run scripts/checks/trash-filter.ts` confirmed green after 3.1–3.19 (route files still correctly red).
- [x] 3.21–3.22 `packages/db/src/changesets/resolve-changeset.ts` (gap file, added to tasks.md as 3.21–3.22) — the `resolveBookId` ancestor-walk CTE now reads `live_nodes`; a trashed id resolves to `null` identically to an unknown one.
- [x] 3.23–3.24 `packages/db/src/changesets/book-diff.ts` (gap file, added as 3.23–3.24) — `listChangedPagesSince`'s touched-pages query joins `live_nodes`; a trashed page drops out of the book-level diff, other pages in the book stay.
- [x] 3.25–3.26 `packages/db/src/comments/reconcile-comments.ts` (gap file, added as 3.25–3.26) — the anchored-roots query joins `live_nodes`; reconciliation is a no-op for a trashed page.
- [x] 3.27–3.28 `packages/db/src/locks/page-lock.ts` (gap file, added as 3.27–3.28) — `readLockStatus` joins `live_nodes`; a trashed page reports `held: false`.
- [x] 3.29–3.30 `packages/db/src/presence/queries.ts` (gap file, added as 3.29–3.30) — `listActivePresence` joins `live_nodes`; a trashed page's presence row is excluded.
- [x] 3.31 `bun run scripts/checks/trash-filter.ts` — all five gap-file `ALLOW_LIST` entries removed; check green with zero `Phase 3/4 pending` entries left in the db layer.

### TDD Cycle Evidence

| Task | RED (observed failure) | GREEN |
|---|---|---|
| 3.1 subtree.ts | `SyntaxError: Export named 'trashLiveDescendants' not found` (production file temporarily reverted to the committed version to observe this, then restored) | 8/8 `subtree.test.ts` tests pass, including the two new `liveOnly` cases and the two new `trashLiveDescendants` cases |
| 3.2–3.3 create.ts | `ParentNodeNotFoundError` expected, got a raw `PostgresError` (`nodes_trash_guard` check-violation, code 23514); second case threw `DuplicateSiblingSlugError` instead of succeeding | 14/14 `create.test.ts` pass |
| 3.4–3.5 rename.ts | `NodeNotFoundError` expected, got the renamed row back (rename silently succeeded on a trashed node) | 11/11 `rename.test.ts` pass |
| 3.6–3.7 move.ts | Exact message `` `node ${bookB.id} does not exist` `` expected; got the raw `nodes_trash_guard` PostgresError message, which would have disclosed the trashed node's existence | 6/6 `move.test.ts` pass |
| 3.8–3.9 reorder.ts | Trashed sibling's position expected unchanged at `1`; got `2` (the write-back loop touched it). Second case: same raw-PostgresError disclosure as move.ts | 5/5 `reorder.test.ts` pass |
| 3.14–3.15 revisions/queries.ts | `listPageRevisions` on a trashed page returned 1 row, expected 0; `listWorkspaceRevisions` included the trashed page's row in the feed | 19/19 tests pass across the `revisions/` directory |
| 3.16–3.17 changesets/history.ts | Trashed-page revision still present in the changeset; a changeset entirely about a trashed page still appeared (expected absent) | 8/8 `history.test.ts` pass |
| 3.18–3.19 comments/queries.ts | `listCommentIndicators`/`listCommentThreads` still returned the trashed page's comment data; `listOpenThreadsForUser` still included a thread on a trashed page | 30/30 tests pass across the `comments/` directory |
| 3.21–3.22 resolve-changeset.ts | `resolveBookId` on a trashed node returned the book id instead of `null` | 13/13 `resolve-changeset.test.ts` pass |
| 3.23–3.24 book-diff.ts | Trashed page's id still present in `listChangedPagesSince`'s result | 4/4 `book-diff.test.ts` pass |
| 3.25–3.26 reconcile-comments.ts | Comment orphaned (`status: 'orphaned'`) on a trashed page instead of staying untouched (`'anchored'`) | 9/9 `reconcile-comments.test.ts` pass |
| 3.27–3.28 page-lock.ts | `readLockStatus` reported `held: true` for a trashed page's still-physically-present lock row | 15/15 `page-lock.test.ts` pass |
| 3.29–3.30 presence/queries.ts | `listActivePresence` still returned the trashed page's presence row | 4/4 `presence/queries.test.ts` pass |

### Files Changed

| File | Action | What Was Done |
|---|---|---|
| `packages/db/src/nodes/subtree.ts` | Modified | `liveOnly` option on `queryDescendantIds`; new `trashLiveDescendants()` |
| `packages/db/src/nodes/subtree.test.ts` | Modified | RED/GREEN tests for both additions |
| `packages/db/src/nodes/create.ts` | Modified | parent lookup, `resolveSiblingSlug`, and the position-calc query over `live_nodes`; doc comment corrected to name `nodes_parent_slug_live_idx` |
| `packages/db/src/nodes/create.test.ts` | Modified | two new tests (trashed parent refused; trashed sibling's slug reusable) |
| `packages/db/src/nodes/rename.ts` | Modified | node lookup over `live_nodes` |
| `packages/db/src/nodes/rename.test.ts` | Modified | two new tests (trashed node refused; trashed sibling's slug reusable) |
| `packages/db/src/nodes/move.ts` | Modified | both node lookups and the position-calc query over `live_nodes` |
| `packages/db/src/nodes/move.test.ts` | Modified | one new test (trashed target refused, byte-identical message to a missing target) |
| `packages/db/src/nodes/reorder.ts` | Modified | both node lookups and the sibling-position query over `live_nodes` |
| `packages/db/src/nodes/reorder.test.ts` | Modified | two new tests (trashed sibling excluded from the position sequence; trashed target refused) |
| `packages/db/src/revisions/queries.ts` | Modified | `listPageRevisions` joins `live_nodes`; `listWorkspaceRevisions`'s `nodes` join changed to `live_nodes` |
| `packages/db/src/revisions/queries.test.ts` | Modified | two new tests |
| `packages/db/src/changesets/history.ts` | Modified | per-revision `live_nodes` join |
| `packages/db/src/changesets/history.test.ts` | Modified | two new tests (partial exclusion within a changeset; whole-changeset exclusion) |
| `packages/db/src/comments/queries.ts` | Modified | `live_nodes` joins in `listCommentIndicators`, `listCommentThreads`; `listOpenThreadsForUser`'s `nodes` join changed to `live_nodes` |
| `packages/db/src/comments/queries.test.ts` | Modified | three new tests |
| `packages/db/src/changesets/resolve-changeset.ts` | Modified | ancestor-walk CTE reads `live_nodes` (gap file) |
| `packages/db/src/changesets/resolve-changeset.test.ts` | Modified | one new test |
| `packages/db/src/changesets/book-diff.ts` | Modified | touched-pages query joins `live_nodes` (gap file) |
| `packages/db/src/changesets/book-diff.test.ts` | Modified | one new test |
| `packages/db/src/comments/reconcile-comments.ts` | Modified | anchored-roots query joins `live_nodes` (gap file) |
| `packages/db/src/comments/reconcile-comments.test.ts` | Modified | one new test |
| `packages/db/src/locks/page-lock.ts` | Modified | `readLockStatus` joins `live_nodes` (gap file) |
| `packages/db/src/locks/page-lock.test.ts` | Modified | one new test |
| `packages/db/src/presence/queries.ts` | Modified | `listActivePresence` joins `live_nodes` (gap file) |
| `packages/db/src/presence/queries.test.ts` | Modified | one new test |
| `scripts/checks/trash-filter.ts` | Modified | removed the 11 `ALLOW_LIST` entries this work unit closed (4 `nodes/*.ts`, `revisions/queries.ts`, `changesets/history.ts`, `comments/queries.ts`, and the 5 gap files) |
| `openspec/changes/deletion-and-trash/tasks.md` | Modified | marked 3.1–3.9, 3.14–3.20 `[x]`; added and marked 3.21–3.31 for the five gap files; left 3.10–3.13 (`content/read-page.ts`/`save-page.ts`) unchecked with a note that they are out of this work unit's assigned scope |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command | `bun run -F @deep-wiki/db test` → 496 pass, 0 fail (52 files) |
| Runtime harness | Provisioned test Postgres (`packages/db/testing/provision.ts`) for every touched module; `bun run -F @deep-wiki/api test` → 442 pass, 0 fail (58 files) against a real Hono app, confirming the route layer still compiles and passes against the changed db-layer queries |
| Rollback boundary | Each file's `live_nodes`/`live_page_content` swap is independently revertible by reverting that one file plus its test and restoring its `ALLOW_LIST` line; `scripts/checks/trash-filter.ts` stays green throughout since it only shrinks |

### Full Verification (this work unit)

- `bun run check` — ok (12/12 structural checks pass; `trash-filter` has zero `Phase 3/4 pending` entries left for the db layer)
- `bun run typecheck` — exit 0 (root + every workspace member, including `apps/web`/`apps/api`/`apps/landing`)
- `bun run lint` — exit 0 (root `eslint .` + every workspace member)
- `bun run -F @deep-wiki/db test` — 496 pass, 0 fail
- `bun run -F @deep-wiki/api test` — 442 pass, 0 fail

### Deviations from Design

1. **Tasks 3.10–3.13 (`content/read-page.ts`/`save-page.ts`) were not implemented.** The orchestrator's assigned scope for this work unit explicitly lists the files to touch, and these two are not on that list even though they carry Phase 3 task numbers in `tasks.md`. They remain `[ ]`, annotated in `tasks.md` as out of scope for this unit. `scripts/checks/trash-filter.ts` does not flag them either way — both are Decision-2 *initial* `ALLOW_LIST` entries (not the "Phase 3/4 pending" block), since they already read the base `page_content` table for a legitimate write-transaction reason. Functionally, though, the `page-content` spec's "denied identically to absence" scenario is not yet true for these two, because the route that is supposed to gate them via `live_nodes` first (`apps/api/src/routes/pages.ts`) is itself still Phase 4 work. Recorded here rather than silently done or silently skipped.
2. **Five additional gap-file tasks (3.21–3.31) added to `tasks.md` before implementing them**, per this work unit's instructions — `changesets/resolve-changeset.ts`, `changesets/book-diff.ts`, `comments/reconcile-comments.ts`, `locks/page-lock.ts`, `presence/queries.ts`. All five were found by task 2.4's red list without a task naming them (apply-progress.md's Deviation #4 from work unit 2). `apps/api/src/routes/comments.ts`, the sixth undocumented site from that same red list, is an `apps/api` route file and correctly stays out of this db-layer work unit — it remains in `ALLOW_LIST` for Phase 4.
3. **`page-lock.ts`'s write functions (`acquireLock`, `heartbeatLock`, `takeOverLock`) were left unchanged.** Only `readLockStatus` — the pure read `trash-non-disclosure` names as a surface — was given a `live_nodes` join. The three write functions are reachable only through `apps/api/src/routes/pages.ts`, which is itself Phase 4 work and does not yet gate entry through `live_nodes`; changing their SQL now would not be enforceable end-to-end and risks masking the real Phase 4 gate. Recorded as a Finding, not solved here, per this work unit's instruction to record rather than solve sites needing more than the live view alone.
4. **Position-calculation queries in `create.ts`/`move.ts` were also switched to `live_nodes`**, beyond the literal "lookups and `resolveSiblingSlug`" wording of tasks 3.3/3.7. This was necessary for the file-level `trash-filter` check to pass at all (any remaining `FROM nodes` anywhere in the file trips rule 1) and is also the semantically correct behaviour — a new node's position should never be computed against a trashed sibling's stale position.
5. **`reorder.ts`'s sibling-position query was changed to `live_nodes`, not filtered with an added predicate.** This means a trashed sibling's own position is never rewritten by the write-back loop at all (kept exactly as it was), rather than being included in the sequence and then excluded from the result — matching the task wording ("excludes trashed siblings from the live position sequence") literally: the trashed row was never part of that sequence to begin with.

### Issues Found

None beyond the recorded deviations above.

### Remaining Tasks (not in this work unit's scope)

- [ ] 3.10–3.13 `content/read-page.ts`/`save-page.ts` — Phase 3's own list, not assigned to this work unit (Deviation #1).
- [ ] Phase 4 (green: api routes) through Phase 12 (docs + final verification) — see `tasks.md`.

## Status (superseded by work unit 4 below)

Phase 1: 10/10 complete. Phase 2: 4/4 complete. Phase 3: 20/24 complete (3.1–3.9, 3.14–3.31 done; 3.10–3.13 pending, out of this work unit's scope). Ready for `sdd-verify` on this work unit, then `sdd-apply` again for the remainder of Phase 3 (3.10–3.13) and Phase 4.

## Scope executed — Work unit 4 (Phase 3 remainder + Phase 4, plus gap files)

**Mode**: Strict TDD

### Completed Tasks

- [x] 3.10–3.13 `packages/db/src/content/{read-page,save-page}.ts` (Phase 3's remaining tasks).
- [x] 4.1–4.23 every `apps/api/src/routes/*.ts` read site named in Phase 4, plus two gap files found and added as tasks: `apps/api/src/routes/comments.ts` (4.20–4.21) and the `page-lock.ts` write-action Finding closed via `pages.ts` (4.22).

### TDD Cycle Evidence

| Task | RED (observed failure) | GREEN |
|---|---|---|
| 3.10–3.11 read-page.ts | `readPageHtml`/`readPageMarkdown` on a trashed page returned the stored content instead of `undefined` | both join `live_page_content`; 8/8 `read-page.test.ts` pass; `ALLOW_LIST` entry for this file removed (no longer trips rule 1) |
| 3.12–3.13 save-page.ts | Saving to a trashed page succeeded and overwrote `page_content` instead of throwing | new `PageNotFoundError`, thrown by a `live_nodes` pre-check before the transaction opens; 31/31 `save-page.test.ts` pass |
| 4.1–4.2 tree.ts | Trashed book stayed in the tree body; renaming a trashed node threw an uncaught `NodeNotFoundError` (500) instead of 404 | `live_nodes` in `/workspaces/:id/tree`, `/nodes/:id/location`, and `authorizeWrite`; 26/26 `tree.test.ts` pass |
| 4.3–4.4, 4.22 pages.ts | `PUT` on a trashed page threw an uncaught `PageNotFoundError` (500); `PATCH /pages/:id/lock` on a trashed page answered `200 {status:'lost'}` instead of 404 | `locateNode()` and both inline `NodeRow` queries join `live_nodes`; `PageNotFoundError` caught and mapped to 404; 27/27 `pages.test.ts` pass (GET/edit-session/take-over already passed as a side effect of 3.10–3.11) |
| 4.5–4.6 links.ts | A trashed source page's backlink survived filtering; a trashed target answered 200 instead of 404 | target lookup, candidate-source query (now joined to `live_nodes`), and title lookup all read `live_nodes`; 5/5 `links.test.ts` pass |
| 4.7–4.8 mentions.ts | Trashed page autocompleted; `/mentions/subjects` and the mention-check route on a trashed page answered 200 instead of 404 | all three lookups join `live_nodes`; 12/12 `mentions.test.ts` pass |
| 4.9–4.10 tags.ts | A trashed page tagged with the searched name still appeared | candidate join and title lookup read `live_nodes`; 3/3 `tags.test.ts` pass |
| 4.11–4.12 activity.ts | N/A — test passed immediately; `activity.ts` delegates entirely to Phase-3-fixed `listWorkspaceRevisions`/`listOpenThreadsForUser` | no code change; 9/9 `activity.test.ts` pass |
| 4.13–4.14 revisions.ts/diff.ts | Trashed page's/book's history and diff answered 200 instead of 404 | every inline node lookup and the diff title-batch query join `live_nodes`; 12/12 `revisions.test.ts`, 11/11 `diff.test.ts` pass (the "trashed page excluded from book-level diff" sub-case already passed via Phase 3's `book-diff.ts` fix) |
| 4.15–4.16 presence.ts | A trashed page's presence event still reached a former reader's SSE stream | the per-event title lookup joins `live_nodes` (the poll fallback already delegated to the Phase-3-fixed `listActivePresence`); 12/12 `presence.test.ts` pass |
| 4.17–4.18 workspaces/invitations/ai-credentials.ts | A trashed workspace root (set by direct SQL — no route trashes a root) still let members/an invitation/a credential save through instead of refusing | each root-node lookup joins `live_nodes`; 16/16, 6/6, 6/6 pass respectively |
| 4.20–4.21 comments.ts (gap file) | Indicators/threads/PATCH-resolved on a trashed page answered 200 instead of 404; a reply on a trashed page's thread still wrote a row | all three `NodeRow` lookups join `live_nodes`; the resolved-thread lookup joins `comments` to `live_nodes`; the anchor-mint's `page_content` re-read now goes through `live_page_content`, so this file needs no `ALLOW_LIST` entry at all; 29/29 `comments.test.ts` pass |

### Files Changed

| File | Action | What Was Done |
|---|---|---|
| `packages/db/src/content/read-page.ts` | Modified | both reads join `live_page_content` |
| `packages/db/src/content/read-page.test.ts` | Modified | two new tests |
| `packages/db/src/content/save-page.ts` | Modified | new `PageNotFoundError`; `live_nodes` pre-check before `sql.begin` |
| `packages/db/src/content/save-page.test.ts` | Modified | two new tests |
| `packages/db/src/index.ts` | Modified | export `PageNotFoundError` |
| `apps/api/src/routes/tree.ts` | Modified | `live_nodes` in three lookups |
| `apps/api/src/routes/pages.ts` | Modified | `live_nodes` in `locateNode()` and two inline queries; catch `PageNotFoundError` → 404 |
| `apps/api/src/routes/links.ts` | Modified | `live_nodes` in three queries |
| `apps/api/src/routes/mentions.ts` | Modified | `live_nodes` in three queries |
| `apps/api/src/routes/tags.ts` | Modified | `live_nodes` in two queries |
| `apps/api/src/routes/revisions.ts` | Modified | `live_nodes` in two queries |
| `apps/api/src/routes/diff.ts` | Modified | `live_nodes` in three queries |
| `apps/api/src/routes/presence.ts` | Modified | `live_nodes` in the per-event title lookup |
| `apps/api/src/routes/workspaces.ts` | Modified | `live_nodes` in the members route's root join |
| `apps/api/src/routes/invitations.ts` | Modified | `live_nodes` in the root lookup |
| `apps/api/src/routes/ai-credentials.ts` | Modified | `live_nodes` in `resolveWorkspaceRootId` |
| `apps/api/src/routes/comments.ts` | Modified | `live_nodes` in four lookups; `live_page_content` in the anchor-mint re-read |
| `apps/api/src/routes/{tree,pages,links,mentions,tags,activity,revisions,diff,presence,workspaces,invitations,ai-credentials,comments}.test.ts` | Modified | one `trash-non-disclosure` describe block (or, for the three root-only routes, one defensive test) per file |
| `scripts/checks/trash-filter.ts` | Modified | removed every "Phase 3/4 pending" `ALLOW_LIST` entry, plus `content/read-page.ts`'s Decision-2 entry (no longer trips either rule); `ALLOW_LIST` now holds only Decision 2's original structural/single-file entries |
| `openspec/changes/deletion-and-trash/tasks.md` | Modified | marked 3.10–3.13 and 4.1–4.19 `[x]`; added and marked 4.20–4.23 for the `comments.ts` gap file and the `page-lock.ts` write-action Finding |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command | `bun run -F @deep-wiki/db test` → 500 pass, 0 fail (52 files); `bun run -F @deep-wiki/api test` → 470 pass, 0 fail (58 files) |
| Runtime harness | `bun run e2e -- e2e/read.spec.ts e2e/tree.spec.ts e2e/comments.spec.ts` — the combined run showed 2 failures (`comments.spec.ts:86`, `read.spec.ts:208`), both the documented environmental flake at docs/TODO.md 2026-09-16 ("30s first-visit timeout in e2e/comments.spec.ts fails against bun run e2e's dev webServer" under concurrent load); re-run in isolation: `e2e/comments.spec.ts` 8/8 pass, `e2e/read.spec.ts` 10/10 pass, `e2e/tree.spec.ts` 16/16 pass (already green in the combined run) |
| Rollback boundary | Each route file's `live_nodes`/`live_page_content` swap, and its own test additions, is independently revertible; `content/{read-page,save-page}.ts` revert independently of the route layer; `scripts/checks/trash-filter.ts`'s `ALLOW_LIST` shrink is a pure subtraction, so reverting any one file's fix requires re-adding that file's own line |

### Full Verification (this work unit)

- `bun run check` — ok (12/12 structural checks pass; `trash-filter` `ALLOW_LIST` holds only Decision 2's initial entries, no `Phase 3/4 pending` block left)
- `bun run typecheck` — exit 0 (root + every workspace member, including `apps/web`/`apps/api`/`apps/landing`)
- `bun run lint` — exit 0 (root + every workspace member)
- `bun run -F @deep-wiki/db test` — 500 pass, 0 fail
- `bun run -F @deep-wiki/api test` — 470 pass, 0 fail
- `bun run e2e -- e2e/read.spec.ts e2e/tree.spec.ts e2e/comments.spec.ts` — green (see Runtime harness row above for the one documented flake and its isolated-rerun confirmation)

### Deviations from Design

1. **`packages/db/src/content/read-page.ts` dropped from `ALLOW_LIST` entirely**, rather than staying as a Decision-2 initial entry. Design Decision 2 lists it among the "write transaction and its reads, entered only after the route already located the node through live_nodes" group, but `read-page.ts` is a pure read module — nothing about it needs the base table once it joins `live_page_content` directly, and doing so closes the page-content spec's "denied like absence" requirement one layer earlier than relying solely on the caller. `save-page.ts`, `rebuild-derived.ts`, and `backfill-render.ts` keep their entries: they are genuinely inside a write transaction.
2. **`save-page.ts`'s new `PageNotFoundError` also covers a nonexistent node**, not only a trashed one — the task wording ("saving to a trashed page is denied identically to absence") is satisfied more directly by one `live_nodes` check that cannot distinguish the two cases by construction, rather than a trash-specific branch plus the pre-existing (and, before this fix, uncontrolled — a raw FK-violation error) absence path.
3. **`apps/api/src/routes/comments.ts`'s anchor-mint `page_content` re-read was switched to `live_page_content`**, beyond the literal task wording ("the three node lookups join live_nodes"), because doing so closed the file's need for any `ALLOW_LIST` entry at all — the alternative (leaving it on the base table with a new allow-list line) would have left a permanent exemption for a file the fix could remove entirely.
4. **`apps/api/src/routes/workspaces.ts`/`invitations.ts`/`ai-credentials.ts`'s RED tests are defensive, not disclosure-scenario tests**, because all three routes only ever look up the workspace root node, and nothing in this product trashes a root. Each RED test sets `trashed_at` on the root by direct SQL (no route can reach this state) and asserts the route refuses rather than proceeding — proving the `live_nodes` join is real defense-in-depth, not just check-satisfying syntax, should a future bug ever let a root become trashed.
5. **Two e2e failures in the combined `read+tree+comments` run were the pre-existing environmental flake documented at `docs/TODO.md` 2026-09-16** (dev-server first-visit hydration exceeding the specs' 30s timeout under concurrent worker load), not a regression from this work unit's changes — confirmed by re-running each failing spec file alone, where both passed completely (8/8 and 10/10).

### Issues Found

None beyond the recorded deviations above.

### Remaining Tasks (not in this work unit's scope)

- [ ] Phase 5 (`db/src/trash/` use cases + permissions) through Phase 12 (docs + final verification) — see `tasks.md`.

## Status (superseded by work unit 5 below)

Phase 1: 10/10 complete. Phase 2: 4/4 complete. Phase 3: 24/24 complete. Phase 4: 23/23 complete. Ready for `sdd-verify` on this work unit, then `sdd-apply` again for Phase 5.

## Scope executed — Work unit 5 (Phase 5: `db/src/trash/` use cases + permissions)

**Mode**: Strict TDD

### Completed Tasks (Phase 5 — all 12)

- [x] 5.1–5.2 `packages/db/src/trash/trash-node.ts` (`trashNode()`) + its GATE-1-style truth table.
- [x] 5.3–5.4 `packages/db/src/trash/restore.ts` (`restoreOperation()`) + its truth table.
- [x] 5.5–5.6 `packages/db/src/permissions/manageable-trash.ts` (`manageableTrashRoots`) + `packages/db/src/trash/listing.ts` (`listManageableTrash`).
- [x] 5.7–5.8 `packages/db/src/trash/lookup.ts` (`trashLookup`).
- [x] 5.9–5.10 `packages/db/src/trash/trace.ts` (`appendTrace`, `findTrashedTrace`) + `packages/db/src/permissions/grants-between.ts` (`hasGrantsBetween`).
- [x] 5.11–5.12 Extended `packages/db/src/permissions/truth-table.test.ts` with 4 new `T1`–`T4` manage/owner-trash cases; the 33 pre-existing cases pass unmodified (37/37 total) — no resolver code changed, proving the existing CTE already reads the base table correctly.

### TDD Cycle Evidence

| Task | RED (observed failure) | GREEN |
|---|---|---|
| `grants-between.ts` | `Cannot find module './grants-between'` | 5/5 pass |
| `manageable-trash.ts` | `Cannot find module './manageable-trash'` | 5/5 pass, first try (no implementation bugs) |
| `trace.ts` | `Cannot find module './trace'` | 9/9 pass after fixing two test bugs (see Deviations #1, #2) |
| `trash-node.ts` | `Cannot find module './trash-node'` | 18/18 pass after fixing test fixture bugs (missing real users for FK columns, missing `page_content` row for the `page_locks` FK — see Deviations #3) |
| `restore.ts` | `Cannot find module './restore'` | 11/11 pass, first try |
| `listing.ts` | `Cannot find module './listing'` | 5/5 pass, first try |
| `lookup.ts` | `Cannot find module './lookup'` | 5/5 pass, first try |
| `purge.ts` | `Cannot find module './purge'` | 7/8 pass first try, 8/8 after fixing a real production bug (see Deviations #4) |
| truth-table T1–T4 | Baseline run confirmed 33/33 pass before the new cases were added (the RED step here is additive, not a failing-then-fixed pair — the new cases pass immediately since they test an existing, unmodified code path) | 37/37 pass |

### Files Changed

| File | Action | What Was Done |
|---|---|---|
| `packages/db/src/permissions/grants-between.ts` | Created | `hasGrantsBetween()` — one `EXISTS` over `permissions` for the op's ids below the book |
| `packages/db/src/permissions/grants-between.test.ts` | Created | 5 tests |
| `packages/db/src/permissions/manageable-trash.ts` | Created | `manageableTrashRoots()` — op-root query + `canManyResources(manage)` |
| `packages/db/src/permissions/manageable-trash.test.ts` | Created | 5 tests |
| `packages/db/src/permissions/truth-table.test.ts` | Modified | +4 tests (`T1`–`T4`) |
| `packages/db/src/trash/trace.ts` | Created | `appendTrace()`, `findTrashedTrace()` |
| `packages/db/src/trash/trace.test.ts` | Created | 9 tests |
| `packages/db/src/trash/trash-node.ts` | Created | `trashNode()`, `ancestorTitles()` |
| `packages/db/src/trash/trash-node.test.ts` | Created | 18 tests |
| `packages/db/src/trash/restore.ts` | Created | `restoreOperation()` |
| `packages/db/src/trash/restore.test.ts` | Created | 11 tests |
| `packages/db/src/trash/listing.ts` | Created | `listManageableTrash()`, `fetchDisplayName()`, `computeRestoreBlockedBy()` (both exported for `lookup.ts`'s reuse) |
| `packages/db/src/trash/listing.test.ts` | Created | 5 tests |
| `packages/db/src/trash/lookup.ts` | Created | `trashLookup()` |
| `packages/db/src/trash/lookup.test.ts` | Created | 5 tests |
| `packages/db/src/trash/purge.ts` | Created | `purgeTrash()` |
| `packages/db/src/trash/purge.test.ts` | Created | 8 tests |
| `openspec/changes/deletion-and-trash/tasks.md` | Modified | marked 5.1–5.12 `[x]` |

### Truth-Table Sizes

| Module | Cases |
|---|---|
| `trash-node.ts` | 18 (not_found ×2, forbidden ×1, empty-container ×3, force-delete ×5, subtree atomicity ×1, trace/lock ×2, `ancestorTitles` ×3, plus the empty-page case folded into empty-container) |
| `restore.ts` | 11 (manage gate ×2, co-trashed subtree ×2, ancestor-trashed ×2, slug collision ×2, restore-as ×2, position ×1) |
| `manageable-trash.ts` | 5 |
| `listing.ts` | 5 |
| `lookup.ts` | 5 |
| `trace.ts` | 9 |
| `grants-between.ts` | 5 |
| `truth-table.test.ts` (new) | 4 (`T1`–`T4`), 37 total in the file |
| **Total new/modified assertions this unit** | **56 new trash-package tests + 4 new/extended permission-resolver cases = 60** |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command | `bun test packages/db/src/trash` → 56 pass, 0 fail (6 files); `bun test packages/db/src/permissions/truth-table.test.ts` → 37 pass, 0 fail |
| Runtime harness | Provisioned test Postgres (`packages/db/testing/provision.ts`) for every file — real transactions, real triggers (`nodes_trash_guard`, `node_deletions_forbid_update_trigger`), real FK cascades, nothing mocked |
| Rollback boundary | Every file in this unit is additive and unreferenced by any route until Phase 6 mounts `routes/trash.ts`; each of the 8 new/modified files reverts independently by deleting it (or, for `truth-table.test.ts`, reverting its one appended `describe` block) |

### Full Verification (this work unit)

- `bun run check` — ok (12/12 structural checks pass; `trash-filter`'s `packages/db/src/trash/` allow-list reason held true throughout — every file added there is one of the reasoned writers, no new base-table read leaked outside it)
- `bun run typecheck` — exit 0 (root + every workspace member, including `apps/web`/`apps/api`/`apps/landing`) — after fixing 12 test-only type errors (see Deviations #5)
- `bun run lint` — exit 0 (root `eslint .` + every workspace member)
- `bun run -F @deep-wiki/db test` — 570 pass, 0 fail (60 files)
- `bun run -F @deep-wiki/core test` — 158 pass, 0 fail (unaffected by this unit; run per the assigned scope's verification list)

### Deviations from Design

1. **`trace.test.ts`'s "an UPDATE raises" test needed the async-IIFE wrapping idiom `page-revision.test.ts` already established**, not a bare `expect(sql\`UPDATE …\`).rejects.toThrow()`. Passing postgres.js's tagged-template result directly to `expect(...).rejects` hung the test runner past its 5s per-test timeout; wrapping the awaited call in `(async () => { await sql\`…\` })()` (the codebase's own existing idiom) fixed it immediately. Recorded as a discovery, not a design deviation — the fix makes the test match the codebase's established pattern exactly.
2. **`trace.test.ts`'s "purging one page does not remove the book's other trace rows" test had a query bug**, not an implementation bug: it re-queried `nodes` by `slug = 'page'` with no workspace scoping, which can match a same-slugged row from an earlier test's fixture tree. Fixed by using the `page` node already returned from `seedTree()` directly. The assertion itself was also corrected: `node_id` carries no foreign key at all (by design), so deleting one page's node row leaves **both** trace rows intact, not just the untouched one — the original assertion incorrectly expected the deleted page's own trace row to vanish too.
3. **`trash-node.test.ts` needed real seeded users, not `crypto.randomUUID()`, for every `actorId` that reaches a successful trash** — `nodes.trashed_by` and `node_deletions.actor_id` both carry a real `REFERENCES users(id)` foreign key, so a random UUID only works for tests that never reach a write (the `not_found`/`forbidden` paths). Similarly, the page-lock-release test needed a real `page_content` row before `page_locks` (whose own FK targets `page_content(node_id, workspace_id)`, not `nodes`) could accept an insert. Both are test-fixture corrections; `trashNode()` itself needed no change.
4. **`purge.ts`'s deletion had to run in two ordered bulk passes (pages, then containers), not one flat `DELETE … WHERE id = ANY(ids)`.** `page_revision_changeset_fk` is not `DEFERRABLE`, so purging a book and one of its own pages in the same statement can fail: if Postgres processes the book row first, its cascade tries to delete the book's `changeset` row while a `page_revision` row (removed only via the *page's* own cascade through `page_content`) still references it, raising a live foreign-key violation. Deleting every eligible `page`-typed node first (cascading `page_content` → `page_revision`, `comments`, `chunks`) before deleting any container clears that reference unconditionally, regardless of row-processing order. This is a genuine, previously-latent schema interaction this change is the first feature to exercise (no prior feature hard-deletes a book), not a design.md deviation — Decision 6's own text already says "the cascade removes content, blocks, revisions, comments, links, tags, chunks, locks, grants and changesets," which is achieved, just via two ordered statements instead of one.
5. **12 pre-existing-pattern-violating test assertions failed `tsc`, not `bun test`.** `expect(<raw postgres.js query result>).toEqual([])` does not type-check against `postgres`'s `RowList` type (`Type 'never[]' is missing … columns, count, command, statement, state`) even though it runs correctly at runtime; no existing test in the codebase does this against a raw query result (every existing `toEqual([])` in the repo targets a plain array returned from an application function). Fixed by switching those 12 assertions to `expect(rows.length).toBe(0)`, across `trace.test.ts`, `restore.test.ts`, `trash-node.test.ts` and `purge.test.ts` — no production code was affected.

### Issues Found

None beyond the recorded deviations above.

### Remaining Tasks (not in this work unit's scope)

- [ ] Phase 6 (contracts + route wiring) through Phase 12 (docs + final verification) — see `tasks.md`.

## Status (superseded by work units 6–7 below)

Phase 1: 10/10. Phase 2: 4/4. Phase 3: 24/24. Phase 4: 23/23. Phase 5: 12/12. Ready for `sdd-verify` on this work unit, then `sdd-apply` again for Phase 6.

## Scope executed — Work units 6 and 7 (Phase 6: contracts + routes + wiring; Phase 7: purge CLI + cron)

**Mode**: Strict TDD

### Completed Tasks (Phase 6 — all 10; Phase 7 — all 5)

- [x] 6.1–6.3 `packages/contracts/src/trash.ts` (every schema from design Decision 7) + `apps/api/src/routes/trash.ts` (`createTrashRoutes`: `DELETE /nodes/:id`, `POST /nodes/:id/force-delete`, `GET /workspaces/:ref/trash`, `GET /trash/nodes/:id`, `POST /trash/:operationId/restore`) + mounted in `apps/api/src/index.ts`.
- [x] 6.4–6.5 `apps/api/src/routes/tree.ts` — `manageable[]`/`isOwner` on `GET /workspaces/:id/tree`.
- [x] 6.6–6.7 `apps/api/src/routes/pages.ts` — `GET /pages/:id` wires `trashLookup` after the `live_nodes` miss; a manager gets the content plus a `trash` block, everyone else the plain 404.
- [x] 6.8–6.9 `apps/api/src/routes/revisions.ts` — `GET /books/:id/history` gains `deletions[]`, filtered by `restricted` per design Decision 5's "Disclosure" paragraph.
- [x] 6.10 `bun run scripts/checks/routes-mounted.ts` — `createTrashRoutes` confirmed referenced as code.
- [x] 7.1–7.2 `packages/db/src/trash/purge.ts`/`purge.test.ts` — confirmed already complete from work unit 5 (see Deviations), re-verified green, marked `[x]`.
- [x] 7.3–7.4 `packages/db/trash-purge.ts` CLI (`ai-reindex.ts` idiom) + `packages/db/trash-purge.test.ts` (child-process test) + `trash:purge` script in `packages/db/package.json`.
- [x] 7.5 `docs/RUNNING.md` — Commands table row + new §8 "Trash purge" (cron line, what purges, that the trace survives, no on-demand purge).

### TDD Cycle Evidence

| Task | RED (observed failure) | GREEN |
|---|---|---|
| contracts (`trash.ts`) | N/A — pure schema module, no production behaviour to fail against; proven by `trash.test.ts`'s 13 parse/reject assertions passing on first write | 13/13 pass, plus `pages.test.ts`/`revisions.test.ts`'s 2 new assertions for the `trash`/`deletions` fields |
| `apps/api/src/routes/trash.ts` | `Cannot find module './trash'` before the route file existed; `route.test.ts` written first and run against the empty module | 18/18 pass on first full implementation (no fix cycle needed) |
| `tree.ts` manageable/isOwner | `body.isOwner`/`body.manageable` were `undefined` (property did not exist on the response) | 3 new tests pass; 29/29 total in `tree.test.ts` |
| `pages.ts` trash block | `res.status` was `404` where `200` was expected — the route's `live_nodes` miss short-circuited before `trashLookup` existed in the handler | 2 new tests pass; 29/29 total in `pages.test.ts` |
| `revisions.ts` deletions | `body.deletions` was `undefined` | 3 new tests pass (unrestricted visible, restricted hidden, restricted visible-to-reader); 15/15 total in `revisions.test.ts` |
| `readTrashedPageHtml` (`packages/db/src/trash/content.ts`) | `Cannot find module './content'` | 2/2 pass after fixing a test-fixture bug (see Deviations #1) |
| `listBookDeletions` (`packages/db/src/trash/history.ts`) | `Cannot find module './history'` | 3/3 pass, first try |
| `trashLookup`'s 3 new identity fields | N/A — additive fields on an already-green function; proven by a new assertion in the existing truth table, not a new RED/GREEN pair | 6/6 pass in `lookup.test.ts` (5 pre-existing + 1 new) |
| `trash-purge.ts` CLI | `Cannot find module` before the file existed; the 6 refusal-shape tests and the 2 real-DB iteration tests were all written first against the empty module | 7/7 pass, first try, once run scoped to the package (see Deviations #4) |

### Files Changed

| File | Action | What Was Done |
|---|---|---|
| `packages/contracts/src/trash.ts` | Created | Every schema from design Decision 7: `TrashNodeResponseSchema`, `NotEmptyRefusalSchema`, `ForceDeleteRequestSchema`, `NameMismatchRefusalSchema`, `StaleCountRefusalSchema`, `TrashListingResponseSchema`, `TrashLookupResponseSchema`, `RestoreRequestSchema`, `RestoreResponseSchema`, `RestoreAncestorTrashedRefusalSchema`, `RestoreSlugTakenRefusalSchema`, `DeletionTraceSchema` |
| `packages/contracts/src/trash.test.ts` | Created | 13 tests |
| `packages/contracts/src/index.ts` | Modified | barrel exports for `trash.ts` |
| `packages/contracts/src/pages.ts` | Modified | `ReadPageResponseSchema` gains `trash: TrashLookupResponseSchema.optional()` |
| `packages/contracts/src/pages.test.ts` | Modified | 1 new test (absent by default, parses when present) |
| `packages/contracts/src/revisions.ts` | Modified | `BookHistoryResponseSchema` gains `deletions: z.array(DeletionTraceSchema).default([])` |
| `packages/contracts/src/revisions.test.ts` | Modified | 1 new test (defaults to `[]`, parses a restricted line with title withheld) |
| `packages/db/src/trash/content.ts` | Created | `readTrashedPageHtml()` — the one place a trashed page's HTML is read from the base `page_content` table on purpose, for the manager-still-reads-it-content scenario `read-page.ts` cannot answer (it always joins `live_page_content`) |
| `packages/db/src/trash/content.test.ts` | Created | 2 tests |
| `packages/db/src/trash/history.ts` | Created | `listBookDeletions()` — the raw, unfiltered `node_deletions` read for a book; visibility filtering is the route's job |
| `packages/db/src/trash/history.test.ts` | Created | 3 tests |
| `packages/db/src/trash/lookup.ts` | Modified | `TrashLookupResult` gains `title`, `workspaceId`, `workspaceSlug` — `pages.ts`'s only way to answer `GET /pages/:id` after a `live_nodes` miss without a second base-table read of its own |
| `packages/db/src/trash/lookup.test.ts` | Modified | 1 new test |
| `packages/db/src/index.ts` | Modified | exports every `trash/*` and `permissions/manageable-trash` symbol the route layer needs |
| `apps/api/src/routes/trash.ts` | Created | `createTrashRoutes()` — the whole route surface above |
| `apps/api/src/routes/trash.test.ts` | Created | 18 tests |
| `apps/api/src/routes/tree.ts` | Modified | `GET /workspaces/:id/tree` gains `manageable`/`isOwner` |
| `apps/api/src/routes/tree.test.ts` | Modified | 3 new tests |
| `apps/api/src/routes/pages.ts` | Modified | `GET /pages/:id` wires `trashLookup`/`readTrashedPageHtml` after the `live_nodes` miss |
| `apps/api/src/routes/pages.test.ts` | Modified | 2 new tests |
| `apps/api/src/routes/revisions.ts` | Modified | `GET /books/:id/history` merges `listBookDeletions()` rows, `restricted`-filtered via `canManyResources(read)` + `manage`-on-book fallback |
| `apps/api/src/routes/revisions.test.ts` | Modified | 3 new tests |
| `apps/api/src/index.ts` | Modified | mounts `createTrashRoutes` |
| `packages/db/trash-purge.ts` | Created | the `trash:purge` CLI, `ai-reindex.ts`'s shape |
| `packages/db/trash-purge.test.ts` | Created | 7 tests (6 fast refusal-shape, 2 real-DB `--all`/`--workspace` iteration) |
| `packages/db/package.json` | Modified | `trash:purge` script |
| `docs/RUNNING.md` | Modified | Commands table row + new §8 "Trash purge" |
| `openspec/changes/deletion-and-trash/tasks.md` | Modified | marked 6.1–6.10 and 7.1–7.5 `[x]` |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command | `bun run -F @deep-wiki/contracts test` → 170 pass, 0 fail; `bun run -F @deep-wiki/db test trash` → 66 pass across 9 files (5 pre-existing trash modules + `content.ts`/`history.ts`); `bun run -F @deep-wiki/db test trash-purge` → 7 pass; `bun run -F @deep-wiki/api test trash tree pages revisions` → 18+29+29+15 = 91 pass |
| Runtime harness | Real Hono app in every route test (`app.request(...)`); provisioned test Postgres for every db-layer test; `bun run e2e -- e2e/tree.spec.ts e2e/read.spec.ts e2e/book-history.spec.ts` → 27/27 pass, confirming the widened tree/page/book-history responses do not regress existing web behaviour |
| Rollback boundary | Unmount `createTrashRoutes` in `index.ts` and delete `apps/api/src/routes/trash.ts`/`trash.test.ts` to revert the whole new route surface independently; the three route edits (`tree.ts`, `pages.ts`, `revisions.ts`) each revert independently since each adds an optional/defaulted field or an after-the-miss branch, never changing an existing success path; `packages/db/trash-purge.ts`/`.test.ts` and the `package.json` script line are additive |

### Full Verification (this work unit)

- `bun run check` — ok (12/12 structural checks pass; `trash-filter` unaffected — the new route/db files call through existing live-view-safe functions or read tables outside its two rules' scope)
- `bun run typecheck` — exit 0 (root + every workspace member, including `apps/web`/`apps/api`/`apps/landing`)
- `bun run lint` — exit 0 (root `eslint .` + every workspace member)
- `bun run -F @deep-wiki/contracts test` — 170 pass, 0 fail
- `bun run -F @deep-wiki/db test` — 583 pass, 0 fail (63 files)
- `bun run -F @deep-wiki/api test` — 496 pass, 0 fail (59 files)
- `bun run e2e -- e2e/tree.spec.ts e2e/read.spec.ts e2e/book-history.spec.ts` — 27/27 pass

### Deviations from Design

1. **`readTrashedPageHtml()` (`packages/db/src/trash/content.ts`) is a new function this work unit's task list does not name literally.** Task 6.7 says only "wire `trashLookup` after the `live_nodes` miss", but `trashLookup()` alone cannot satisfy the page-content spec's "A manager can still read a trashed page's content" scenario: `readPageHtml()` always joins `live_page_content`, which by construction excludes every trashed row, manager included. Rather than leave that scenario unmet, added one function in the `packages/db/src/trash/` directory (already allow-listed for reading trashed rows on purpose) that reads the base `page_content` table directly, callable only after the route's own `trashLookup()` call has already confirmed trashed-and-manage. `packages/db/src/index.ts` exports it alongside the rest of `trash/`.
2. **`trashLookup()`'s result gained three fields (`title`, `workspaceId`, `workspaceSlug`) beyond design Decision 7's own `TrashLookupResult` shape**, for the same reason as #1: `apps/api/src/routes/pages.ts` needs the trashed node's own identity to answer `GET /pages/:id`, and reading `nodes`/`workspaces` directly from `pages.ts` itself would trip `trash-filter.ts` rule 1 (that file carries no `ALLOW_LIST` entry). Extending the one function already allow-listed to read the base table was the option that added no new allow-list entry anywhere. Additive only — existing `lookup.test.ts` assertions read specific fields off the result, never the whole object, so nothing broke.
3. **`GET /trash/nodes/:id` is implemented and tested even though the assigned scope text and task 6.1 do not name it literally.** Design Decision 7's own route table lists it as part of the surface ("feeds the 'in the trash' state on a page screen"), and it is a thin, already-necessary wrapper over the already-built `trashLookup()` — omitting it would leave the shipped API surface short of what design.md committed to. One describe block in `trash.test.ts` covers it (manager lookup succeeds, outsider gets 404).
4. **`trash-purge.test.ts`'s fast refusal tests only pass when run scoped to the package (`bun run -F @deep-wiki/db test`), not via a bare `bun test <path>` from the repo root.** `Bun.spawnSync(['bun', 'run', CLI, ...])`'s child process auto-loads `.env` from its own cwd; the repo root carries a real `.env` with a live `DATABASE_URL`, which defeats the "refuses without DATABASE_URL" test's premise if the parent test process's cwd is the repo root. `ai-reindex.test.ts` has this exact same property (confirmed) — it is a pre-existing idiom risk, not new to this file, and the documented verification command (`bun run -F @deep-wiki/db test`) always runs with cwd `packages/db`, which carries no `.env`, so the shipped test suite is unaffected.
5. **Phase 7 tasks 7.1/7.2 were already complete before this work unit started.** Work unit 5's apply-progress (Phase 5) recorded `packages/db/src/trash/purge.ts` and `purge.test.ts` as created and fully green (8/8) — built ahead of `tasks.md`'s own Phase 7 sequencing because `trace.ts`'s `findTrashedTrace()` needed a caller to prove the `purged` event end-to-end. Re-verified both files still pass unmodified as part of this work unit's `bun run -F @deep-wiki/db test` run, then marked `[x]` in `tasks.md` rather than reimplementing them.
6. **The `restricted`-disclosure filter's post-purge fallback (`manage` on the book) is implemented in `revisions.ts` but has no dedicated RED test of its own.** The `deletion-trace` spec's own scenarios describe the pre-purge case only (a still-existing trashed node); the post-purge "manage on book" fallback comes from design.md Decision 5's "Disclosure" paragraph, one layer more detailed than the spec's scenarios. `canManyResources(read)` structurally cannot resolve a purged node's id at all (its ancestor CTE anchors on the row existing), so the fallback is exercised by the code path but not proven by a scenario naming a purged-and-restricted row; recorded as a gap for whoever verifies this work unit or extends `e2e/trash.spec.ts` in Phase 11.

### Issues Found

None beyond the recorded deviations above.

### Remaining Tasks (not in this work unit's scope)

- [ ] Phase 8 (web: delete action + confirm dialog) through Phase 12 (docs + final verification) — see `tasks.md`. Phase 8's owner review gate 1/3 is the next human checkpoint.

## Status (superseded by work unit 8 below)

Phase 1: 10/10. Phase 2: 4/4. Phase 3: 24/24. Phase 4: 23/23. Phase 5: 12/12. Phase 6: 10/10. Phase 7: 5/5.

## Scope executed — Work unit 8 (Phase 8: Delete action + `confirmText`), ending at owner-review gate 1/3

**Mode**: Strict TDD. Three commits on `main`: `3360126` (dialog), `1ce67e5` (Delete + flow), `a3fa410` (e2e + fixtures + Review Log).

### Completed Tasks (Phase 8 — 5 of 6; 8.6 is the owner's gate and stays `[ ]`)

- [x] 8.1–8.2 `ConfirmOptions.confirmText` and `onConfirm` (`useConfirm.ts`), the typed-name field on `ConfirmDialog.vue`: labelled `UFormField` naming what to type, focused on open, confirm action `aria-disabled` with "Type the name exactly as shown." (tooltip + `aria-describedby`) until the trimmed value equals the name exactly (case-sensitive), Enter in the field agrees only on a match; a refusal from `onConfirm` keeps the dialog open with the field error, a replaced description and focus on the field.
- [x] 8.3–8.4 `deleteRowAction()`/`'delete'` kind in `useTreeRowActions.ts` (last group; disabled reasons per design Decision 8), `manageable`/`isOwner`/`removeNode` on `useTree.ts` + `useWorkspaceTree.ts`, the flow in `useTrash.ts` (`deleteNode()`, `countSentence()`), the toolbar's icon-only trash control in `NavigationTreeActions.vue`, and `NavigationTree.vue` wiring (menu item, `Delete` key, chip notices, live region, focus handoff to the neighbouring row). `trashUrl()` in `utils/routes.ts`. `TrashNodeResponse` type exported from the contracts barrel.
- [x] 8.5 `e2e/tree-writes.spec.ts` (+7 tests, 18 total) over `e2e/tree-fixtures.bun.ts` (manager-not-owner, chapter with a page hidden from them, owner session); `e2e/tree.spec.ts` updated for the `write`-only member's disabled Delete; screenshots `trash-{menu,refusal,force-dialog}-{1280-light,1280-dark,320-light}.png`; `docs/UI-CHECKLIST.md` Review Log entry "2026-09-18 — Delete in the tree, and the confirm dialog's typed-name step — awaiting the owner's eye".
- [ ] 8.6 **STOP — owner review gate 1/3.** Not started: Phase 9.

### TDD Cycle Evidence

| Task | RED (observed failure) | GREEN | REFACTOR |
|---|---|---|---|
| 8.1/8.2 `useConfirm` (5 tests) | `confirmText` undefined on pending; `accept is not a function` | 11/11 | `handlers` map beside `resolvers` (a function is not `useState`) |
| 8.1/8.2 `ConfirmDialog` (4 tests) | `no field in the dialog`; `aria-disabled` null | 11/11 | one accept button with the tooltip switched off on match (first cut swapped the element under the pointer) |
| 8.3 `useTreeRowActions` (7 tests) | last group `['copy-link']` not `['delete']`; `deleteRowAction is not a function` | 22/22 | `contentsWord()` from `legalChildTypes()` — no second hierarchy list |
| 8.4 `routes.trashUrl` | `trashUrl is not a function` | 15/15 (incl. `handBuiltRouteStrings` walk) | — |
| 8.4 `useTree` (3 tests) / `useWorkspaceTree` (1) | `manageable` undefined; `removeNode is not a function` | 16/16, 11/11 | `removeTreeNode()` reuses `withoutNode()` |
| 8.4 `useTrash` (17 tests) | `Failed to resolve import "./useTrash"` | 17/17 | dropped the unused `isOwner` dep (the server's `canForce` decides); holder object for the closure-written answer (`tsc` narrowing); singular retention sentence |
| 8.4 `NavigationTreeActions` (4 tests) | `tree-delete-open` absent | 27/27 | — |
| 8.4 `NavigationTree` (5 new + 1 amended) | `Cannot read properties of undefined (reading 'has')` (menu without `manageable`); `tree-delete-open` absent | 38/38 | — |
| 8.5 fixtures test | `fixtures.chapterId` undefined (postgres could not bind it) | 2/2 | sibling assertion scoped to pages |
| 8.5 e2e (7 new) | run 1: pre-existing server assertion saw the chapter; run 2: pre-existing "created page" test was creating a chapter; run 3: `pageOrder` read mid-redraw | 18/18 (+ `tree.spec.ts` 11/11) | `expect.poll` after the removal, the Page type chosen explicitly |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command | `bun run -F @deep-wiki/web test` → 117 files, 1095 pass, 0 fail (baseline before the unit: 117 pass on the 8 touched suites) |
| Runtime harness | `bunx playwright test e2e/tree-writes.spec.ts e2e/tree.spec.ts` against the real API + seeded Postgres → 29/29 pass (4.4 min, 1 worker, host load average ~60). Invoked through Playwright directly rather than `bun run e2e` because the host could not boot `nuxt dev` inside Playwright's 120s `webServer` window; the suite's web server was started by hand on 4173 (pid recorded, killed afterwards; the owner's server on 3001 untouched) and `scripts/e2e.ts`'s lock preflight refuses while that lock is held. `bun test scripts/checks/__tests__/e2e-tree-fixtures.test.ts` → 2/2 |
| Rollback boundary | `3360126` (dialog: `confirmText` optional, `accept()` additive) · `1ce67e5` (Delete + flow: `useTrash.ts` new; `manageable`/`isOwner`/`removeNode` additive; `deleteRowAction` last group; toolbar control) · `a3fa410` (e2e/fixtures/docs). Each reverts on its own; the contracts barrel line is one type export |

### Full Verification (this work unit, each stage its own process)

- `bun run check` — ok (12/12)
- `bun run typecheck` — exit 0
- `bun run lint` — exit 0
- `bun run -F @deep-wiki/web test` — 1095 pass, 0 fail
- e2e `tree-writes.spec.ts` + `tree.spec.ts` — 29/29 pass

### Deviations from Design

1. **`DELETE /nodes/:id` answers `200` with `{ trashOperationId, trashed }`, not `204`** (the orchestrator's scope text said 204; the shipped route from work unit 6 returns the body). The flow reads the body and reports the counts; no change to the API.
2. **A non-owner's `409 not_empty` notice names the count** ("Empty “X” before deleting it (1 page).") where design Decision 8 says "without a count for a non-owner". The scope text asked for the counts, and the server already returns them to that caller, so the notice discloses nothing the response did not. Recorded in the Review Log as the owner's call.
3. **`useConfirm` gained `onConfirm`/`accept()` beyond Decision 8's `confirmText`.** Needed so `stale_count` re-asks with the fresh count and `name_mismatch` keeps the dialog with the field's error *inside the open dialog* (the scope's wording) rather than closing and reopening it. Still one dialog; the extension is additive and optional.
4. **The toolbar's Delete is icon-only** (name + tooltip, §4.3): a 280px pane holds "New…" and "Rename…" and a third labelled button wrapped.
5. **`useTree.removeNode` returns an undo instead of a `trash(nodeId, write)` wrapper**, so the flow (which has three request stages) owns when the row leaves and returns; `reorder`'s snapshot-and-revert idiom is reused.
6. **`TrashNodeResponse` is now exported from `packages/contracts/src/index.ts`** — the type existed in `trash.ts` but the barrel omitted it.

### Issues Found

- The pre-existing "a created page is drawn from the response" e2e created a **chapter** (the toolbar guesses a book's first legal child) and matched it by title; it now picks the Page type. Not a product defect, a test that said less than it seemed to.
- Under load, `bun run e2e`'s `webServer` timeout (120s) is too short for `nuxt dev` on this host; recorded in the Review Log's measurement paragraph, no change made to the harness.

### Remaining Tasks (not in this work unit's scope)

- [ ] 8.6 — the owner's review gate 1/3 (STOP).
- [ ] Phase 9 (Trash screen) through Phase 12 — see `tasks.md`.

## Status

Phase 1: 10/10. Phase 2: 4/4. Phase 3: 24/24. Phase 4: 23/23. Phase 5: 12/12. Phase 6: 10/10. Phase 7: 5/5. Phase 8: 5/6 — stopped at gate 1/3 (8.6). Ready for `sdd-verify` on this work unit; Phase 9 waits for the owner's verdict.
