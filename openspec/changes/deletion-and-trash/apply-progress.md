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

## Status

Phase 1: 10/10 complete. Phase 2: 4/4 complete. Phase 3: 20/24 complete (3.1–3.9, 3.14–3.31 done; 3.10–3.13 pending, out of this work unit's scope). Ready for `sdd-verify` on this work unit, then `sdd-apply` again for the remainder of Phase 3 (3.10–3.13) and Phase 4.
