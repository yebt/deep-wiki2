# Tasks: Deletion and Trash

> Size note: the `sdd-tasks` skill's 530-word budget is deliberately exceeded, following
> `versioning-and-collaboration/tasks.md`'s own precedent. This change touches one migration, a
> new structural check that turns ~20 existing read sites red before they turn green one file at a
> time, six new `packages/db/src/trash/` use cases, a new route file plus edits to ten others, a
> purge CLI, four owner-gated UI surfaces, and a real-backend e2e suite. Compressing the sequencing
> and the per-surface RED-test obligations to fit a word count would delete the exact facts this
> file exists to carry into `sdd-apply`.

> **Strict TDD.** Every task that writes code names its RED test first; a GREEN task MUST NOT start
> until its RED task's failure has been observed for the stated reason, never "file does not exist"
> or an import error standing in for the real assertion. `bun run test` is the runner.

> **Verification, every unit.** Besides the unit's own Focused test command, run `bun run check`,
> `bun run typecheck`, and `bun run lint` before calling any unit done; UI units additionally run
> their named e2e spec. `bun run verify` end to end is OOM-killed on this host — Phase 12 runs its
> stages (`check`, `typecheck`, `lint`, `test`, `gate-2-round-trip`, `e2e`) separately rather than
> as one `bun run verify` invocation.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 4500–6500 (1 migration + views + 2 new tables, `packages/core/src/trash/`, a new structural check + fixtures, ~20 read-site rewrites, 6 new `db/src/trash/` modules, 2 permission modules, contracts, 1 new route file + edits to 10 route files, a purge CLI, 1 dialog extension, 3 new/modified UI surfaces, an e2e suite, docs) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (schema + core rules) → PR 2 (structural check, red) → PR 3 (green: db layer) → PR 4 (green: api routes) → PR 5 (db trash use cases + permissions) → PR 6 (contracts + route wiring) → PR 7 (purge CLI) → PR 8 (web: delete action + confirm dialog) → PR 9 (web: Trash screen) → PR 10 (web: trashed-page state + book history) → PR 11 (e2e) → PR 12 (docs + final verification) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main — single repo, no unmerged tracker branch to stack against (unlike `versioning-and-collaboration`'s `content-and-editor` base); migration `0022` is the only new number this change claims, so sequential merges to `main` keep `packages/db/drizzle/meta/_journal.json` consistent without a tracker branch |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Migration `0022_trash` + views + `core/trash/rules.ts` | PR 1 | `bun run -F @deep-wiki/db test 0022` / `bun run -F @deep-wiki/core test trash` | Provisioned test Postgres (`packages/db/testing/provision.ts`) | `down/0022_trash.down.sql`; core files are additive and unreferenced elsewhere yet |
| 2 | `scripts/checks/trash-filter.ts` + fixtures, red on every existing site | PR 2 | `bun test scripts/checks/__tests__/trash-filter.test.ts` | N/A — pure source-text/AST check, no service | Remove the check and its `package.json` wiring line |
| 3 | Green: `nodes/*`, `content`, `revisions`, `changesets`, `comments` (db layer) | PR 3 | `bun run -F @deep-wiki/db test` | Provisioned test Postgres | Each file's live-view swap is independently revertible; check stays red until PR 4 lands too |
| 4 | Green: every `apps/api/src/routes/*.ts` read site | PR 4 | `bun run -F apps-api test` | Real Hono app in tests | Each route file's swap is independently revertible |
| 5 | `packages/db/src/trash/*` use cases + `permissions/manageable-trash.ts` + `grants-between.ts` | PR 5 | `bun run -F @deep-wiki/db test trash` | Provisioned test Postgres | New modules, unreferenced by any route until PR 6 |
| 6 | Contracts + `routes/trash.ts` + `tree`/`pages`/`revisions.ts` wiring | PR 6 | `bun run -F apps-api test trash tree pages revisions` | Real Hono app in tests | Unmount `createTrashRoutes`; revert the three route edits independently |
| 7 | Purge job + CLI + cron doc line | PR 7 | `bun run -F @deep-wiki/db test purge` | Provisioned test Postgres | `packages/db/trash-purge.ts` and `package.json` script are additive |
| 8 | Web: Delete row/toolbar action + `confirmText` | PR 8 | `bun run -F apps-web test` | Real dev server + Playwright (`e2e/trash.spec.ts`, delete portion) | Composable/component revert; `confirmText` is an optional field |
| 9 | Web: Trash screen | PR 9 | `bun run -F apps-web test` | Real dev server + Playwright | New route and screen; revert independently of PR 8 |
| 10 | Web: trashed-page state + book history timeline | PR 10 | `bun run -F apps-web test` | Real dev server + Playwright | Two independent screen edits; each reverts without touching the other |
| 11 | Full `e2e/trash.spec.ts` | PR 11 | `bun run e2e -- trash` | Real backend + Playwright | Spec file is additive |
| 12 | Docs + full verification | PR 12 | `bun run check && bun run typecheck && bun run lint && bun run test` | Full local stack; `bun run e2e` last | Docs-only revert; no code coupling |

## Phase 1: Schema Foundation and Core Rules

- [x] 1.1 RED: `packages/core/src/trash/rules.test.ts` — `decideTrash()` table per the `node-trash` spec: manage+empty → ok; read-only, no manage/owner → `forbidden`; non-owner+non-empty → `not_empty`; owner+correct name+current count → ok; owner+wrong name → `name_mismatch`; owner+stale count → `stale_count`.
- [x] 1.2 GREEN: `packages/core/src/trash/rules.ts` — `decideTrash()`, zero framework imports.
- [x] 1.3 RED: extend `packages/core/src/trash/rules.test.ts` — `decideRestore()` table per the `trash-restore` spec: parent trashed → `ancestor_trashed`; slug held by a live sibling → `slug_taken`; neither → ok.
- [x] 1.4 GREEN: add `decideRestore()`, `TRASH_RETENTION_DAYS = 30`, and `daysUntilPurge()` to `packages/core/src/trash/rules.ts`; `packages/core/src/trash/index.ts` barrel.
- [x] 1.5 Run `bun run -F @deep-wiki/core check` to confirm core-purity holds for the new files. (No `check` script exists on `packages/core`'s own `package.json` — ran `bun run scripts/checks/core-purity.ts` from the repo root instead, which is the actual check `bun run check` invokes; reports `core-purity: ok`.)
- [x] 1.6 RED: a `packages/db` migration test — asserts `nodes` gains `trashed_at`/`trash_operation_id`/`trashed_by` with the paired-nullability `CHECK`, `nodes_parent_slug_unique` is replaced by `nodes_parent_slug_live_idx` (live rows only), `live_nodes`/`live_page_content` views exist, `node_deletions` and `trash_purge_runs` exist, and `nodes_trash_guard()` raises when a live row is inserted or moved under a trashed parent outside its own `trash_operation_id`.
- [x] 1.7 GREEN: `packages/db/drizzle/0022_trash.sql` + `packages/db/drizzle/down/0022_trash.down.sql` per design Decision 1; `packages/db/src/schema.ts` gains the three columns, `liveNodes`/`livePageContent` (`pgView(...).existing()`), `nodeDeletions`, `trashPurgeRuns`.
- [x] 1.8 RED: a down-migration test — the down path refuses (`RAISE EXCEPTION`) while any trashed row shares `(parent_id, slug)` with a live sibling, and otherwise restores the unconditional unique constraint and drops the three columns.
- [x] 1.9 GREEN: complete the refusal branch in `drizzle/down/0022_trash.down.sql` so 1.8 passes.
- [x] 1.10 Update `packages/db/src/nodes/create.test.ts` and `packages/db/src/nodes/rename.test.ts` to state live-only slug uniqueness explicitly (`tenancy-model` spec: a live node may take a trashed sibling's slug; two live siblings still cannot share one).

## Phase 2: Trash-Filter Structural Check — Red On Every Existing Site

- [x] 2.1 RED: `scripts/checks/__tests__/trash-filter.test.ts` + fixtures under `scripts/checks/__fixtures__/trash-filter/` — one fixture per rule from the `trash-non-disclosure` spec: rule 1 (base-table read outside the allow-list), rule 2 (page-keyed table read with no live view), and a compliant fixture that must pass both.
- [x] 2.2 GREEN: `scripts/checks/trash-filter.ts` — rule 1 (`nodes`/`page_content`, text and Drizzle-builder twin), rule 2 (`page_revision`/`changeset`/`comments`/`links`/`page_tags`/`chunks`/`page_locks`/`presence`), `ALLOW_LIST` per design Decision 2's initial entries.
- [x] 2.3 Wire `bun run scripts/checks/trash-filter.ts` into `package.json`'s `check` script, after `single-source.ts`.
- [x] 2.4 Run `bun run check` and record every file it now fails on (the exact set Phases 3–4 must turn green) as this task's proof-of-red evidence — fix nothing here. (See Deviations — the red list is 24 files, plus 8 of those are not named by any existing Phase 3/4 task; the pre-commit hook forced a temporary `ALLOW_LIST` workaround, documented in apply-progress.md.)

## Phase 3: Green One File At A Time — db Layer

*3.1 is sequential and blocks the rest of this phase; 3.2–3.19 touch disjoint files and can run in parallel worktrees once 3.1 lands.*

- [ ] 3.1 (sequential) GREEN: `packages/db/src/nodes/subtree.ts` — `liveOnly` option on `queryDescendantIds`; new `trashLiveDescendants(tx, { workspaceId, ancestorPath, operationId, userId })`; add to `ALLOW_LIST`.
- [ ] 3.2 (parallel) RED: `packages/db/src/nodes/create.test.ts` — create under a trashed parent is refused; create with a trashed sibling's slug succeeds.
- [ ] 3.3 (parallel) GREEN: `packages/db/src/nodes/create.ts` — lookups and `resolveSiblingSlug` over `live_nodes`.
- [ ] 3.4 (parallel) RED: `packages/db/src/nodes/rename.test.ts` — renaming a trashed node is refused identically to an unknown node; renaming to a trashed sibling's slug succeeds.
- [ ] 3.5 (parallel) GREEN: `packages/db/src/nodes/rename.ts` — live-view lookups.
- [ ] 3.6 (parallel) RED: `packages/db/src/nodes/move.test.ts` — moving into a trashed target container is refused.
- [ ] 3.7 (parallel) GREEN: `packages/db/src/nodes/move.ts` — live-view lookups.
- [ ] 3.8 (parallel) RED: `packages/db/src/nodes/reorder.test.ts` — reordering excludes trashed siblings from the live position sequence.
- [ ] 3.9 (parallel) GREEN: `packages/db/src/nodes/reorder.ts` — live-view lookups.
- [ ] 3.10 (parallel) RED: `packages/db/src/content/read-page.test.ts` — a former reader requesting a now-trashed page's content is denied identically to an unknown page (`page-content` spec).
- [ ] 3.11 (parallel) GREEN: `packages/db/src/content/read-page.ts` — join `live_page_content`.
- [ ] 3.12 (parallel) RED: `packages/db/src/content/save-page.test.ts` — saving to a trashed page is denied identically to absence.
- [ ] 3.13 (parallel) GREEN: `packages/db/src/content/save-page.ts` — check `live_nodes` before the write transaction opens.
- [ ] 3.14 (parallel) RED: `packages/db/src/revisions/queries.test.ts` — a former reader's history query on a now-trashed page is denied identically to no `read` (`revision-history` spec).
- [ ] 3.15 (parallel) GREEN: `packages/db/src/revisions/queries.ts` — join `live_nodes`.
- [ ] 3.16 (parallel) RED: `packages/db/src/changesets/history.test.ts` — a trashed page's revisions are excluded from book history for a subject without `manage` on that page; other pages in the same changeset still appear (`changesets` spec).
- [ ] 3.17 (parallel) GREEN: `packages/db/src/changesets/history.ts` — join `live_nodes` per revision row.
- [ ] 3.18 (parallel) RED: `packages/db/src/comments/queries.test.ts` — comment data for a trashed page is fully absent for a former reader, scanned with `expect-no-disclosure` (`comment-threads` spec).
- [ ] 3.19 (parallel) GREEN: `packages/db/src/comments/queries.ts` — join `live_nodes`.
- [ ] 3.20 Run `bun run scripts/checks/trash-filter.ts` — confirm every file touched in this phase is green; route-layer files stay red until Phase 4.

## Phase 4: Green One File At A Time — api Routes

*All pairs in this phase touch disjoint route files and can run in parallel worktrees.*

- [ ] 4.1 (parallel) RED: `apps/api/src/routes/tree.test.ts` — a trashed page is absent from the tree for a subject who could read it before (`navigation-tree` spec).
- [ ] 4.2 (parallel) GREEN: `apps/api/src/routes/tree.ts` — query `live_nodes`.
- [ ] 4.3 (parallel) RED: `apps/api/src/routes/pages.test.ts` — `GET /pages/:id` on a trashed id answers byte-identical to an unknown id for a former reader.
- [ ] 4.4 (parallel) GREEN: `apps/api/src/routes/pages.ts` — `live_nodes`/`live_page_content` lookup, `notFound()` on miss (the manager's trash block is wired in Phase 6).
- [ ] 4.5 (parallel) RED: `apps/api/src/routes/links.test.ts` — backlinks exclude a trashed source page (`knowledge-graph` spec).
- [ ] 4.6 (parallel) GREEN: `apps/api/src/routes/links.ts` — join `live_nodes`.
- [ ] 4.7 (parallel) RED: `apps/api/src/routes/mentions.test.ts` — autocomplete excludes a trashed page.
- [ ] 4.8 (parallel) GREEN: `apps/api/src/routes/mentions.ts` — join `live_nodes`.
- [ ] 4.9 (parallel) RED: `apps/api/src/routes/tags.test.ts` — tag-filtered navigation excludes a trashed page.
- [ ] 4.10 (parallel) GREEN: `apps/api/src/routes/tags.ts` — join `live_nodes`.
- [ ] 4.11 (parallel) RED: `apps/api/src/routes/activity.test.ts` — activity for a trashed page is absent for a former reader.
- [ ] 4.12 (parallel) GREEN: `apps/api/src/routes/activity.ts` — join `live_nodes`.
- [ ] 4.13 (parallel) RED: `apps/api/src/routes/revisions.test.ts` and `apps/api/src/routes/diff.test.ts` — history/diff on a trashed page denied identically to no `read`.
- [ ] 4.14 (parallel) GREEN: `apps/api/src/routes/revisions.ts`, `apps/api/src/routes/diff.ts` — join `live_nodes`.
- [ ] 4.15 (parallel) RED: `apps/api/src/routes/presence.test.ts` — presence and locks for a trashed page are absent.
- [ ] 4.16 (parallel) GREEN: `apps/api/src/routes/presence.ts` — join `live_nodes`/`live_page_content`.
- [ ] 4.17 (parallel) RED: `apps/api/src/routes/{workspaces,invitations,ai-credentials}.test.ts` — any node-scoped count or lookup these routes expose excludes a trashed page.
- [ ] 4.18 (parallel) GREEN: `apps/api/src/routes/{workspaces,invitations,ai-credentials}.ts` — join `live_nodes` wherever they touch node rows.
- [ ] 4.19 Run `bun run scripts/checks/trash-filter.ts` — MUST be fully green with no `ALLOW_LIST` growth beyond Decision 2's initial entries; this is the gate before Phase 5 starts.

## Phase 5: `db/src/trash/` Use Cases and Permissions

- [ ] 5.1 RED: `packages/db/src/trash/trash-node.test.ts` — a GATE-1-style truth table over `{isOwner, hasManage, isContainer, liveDescendants, submitted}`, written first from the unauthorised subject's point of view: 404-vs-403 split, non-empty refusal, stale count, already-trashed exclusion (`node-trash` spec, every scenario).
- [ ] 5.2 GREEN: `packages/db/src/trash/trash-node.ts` — `trashNode()`: row-lock the workspace, re-read the node from the base table, count via `subtree.ts`, `decideTrash`, propagate, release `page_locks`, append the trace.
- [ ] 5.3 RED: `packages/db/src/trash/restore.test.ts` — co-trashed subtree restored, a separately-trashed descendant stays trashed, ancestor-trashed refusal, slug collision `409`, restore-as success, second collision refused the same way (`trash-restore` spec, every scenario).
- [ ] 5.4 GREEN: `packages/db/src/trash/restore.ts` — `restoreOperation()` per design Decision 4.
- [ ] 5.5 RED: `packages/db/src/trash/listing.test.ts` — the listing shows only manageable trashed nodes; empty for a subject with no `manage` anywhere.
- [ ] 5.6 GREEN: `packages/db/src/permissions/manageable-trash.ts` (`manageableTrashRoots`) + `packages/db/src/trash/listing.ts`.
- [ ] 5.7 RED: `packages/db/src/trash/lookup.test.ts` — `trashLookup` denies a subject without `manage` identically to unknown; permits the manager who trashed it.
- [ ] 5.8 GREEN: `packages/db/src/trash/lookup.ts`.
- [ ] 5.9 RED: `packages/db/src/trash/trace.test.ts` — append-only (an `UPDATE` raises), `trashed`/`restored`/`purged` events, no cascading FK to the node, cascades only with the book, `restricted` hides the title from a subject without access to the node and shows it to one who had access (`deletion-trace` spec, every scenario).
- [ ] 5.10 GREEN: `packages/db/src/trash/trace.ts` (`appendTrace`, reusing `resolveBookId`) + `packages/db/src/permissions/grants-between.ts` (`hasGrantsBetween`).
- [ ] 5.11 RED: extend `packages/db/src/permissions/truth-table.test.ts` with the `manage`/owner trash cases; run first to confirm it fails only on the new cases.
- [ ] 5.12 GREEN: wire the new cases into the resolver/truth-table fixtures; confirm the pre-existing 30 cases are unmodified.

## Phase 6: Contracts and Route Wiring

- [ ] 6.1 RED: `apps/api/src/routes/trash.test.ts` — `DELETE /nodes/:id` (empty → `200`; non-empty non-owner → `409 not_empty`; no `read` → `404`; `read` no `manage` → `403`); `POST /nodes/:id/force-delete` (`name_mismatch`, `stale_count`, success); `GET /workspaces/:ref/trash` (manageable-only listing); `POST /trash/:opId/restore` (all `trash-restore` scenarios) — against a real Hono app.
- [ ] 6.2 GREEN: `packages/contracts/src/trash.ts` — every schema from design Decision 7.
- [ ] 6.3 GREEN: `apps/api/src/routes/trash.ts` (`createTrashRoutes`) implementing 6.1; mount in `apps/api/src/index.ts`.
- [ ] 6.4 RED: `apps/api/src/routes/tree.test.ts` — the tree response carries `manageable[]` and `isOwner`.
- [ ] 6.5 GREEN: `apps/api/src/routes/tree.ts` — add `manageable`/`isOwner` per design Decision 7.
- [ ] 6.6 RED: `apps/api/src/routes/pages.test.ts` — `GET /pages/:id` on a trashed id returns the `trash` block for the manager who trashed it, and the plain `404` for everyone else.
- [ ] 6.7 GREEN: `apps/api/src/routes/pages.ts` — wire `trashLookup` after the `live_nodes` miss.
- [ ] 6.8 RED: `apps/api/src/routes/revisions.test.ts` — `GET /books/:id/history` carries `deletions[]` alongside `changesets[]` (`changesets` spec).
- [ ] 6.9 GREEN: `apps/api/src/routes/revisions.ts` — merge `node_deletions` rows into the history response.
- [ ] 6.10 Run `bun run scripts/checks/routes-mounted.ts` — confirm `createTrashRoutes` is referenced as code in `index.ts`.

## Phase 7: Purge Job and CLI

- [ ] 7.1 RED: `packages/db/src/trash/purge.test.ts` — `trash-purge` spec scenarios: a 29-day node untouched, a 31-day node purged, idempotent rerun, cascade inventory (content/revisions/comment/chunks for a page; changeset for a book), a tracked run row through `completed`.
- [ ] 7.2 GREEN: `packages/db/src/trash/purge.ts` — `purgeTrash()` per design Decision 6.
- [ ] 7.3 RED: `packages/db/trash-purge.test.ts` — the CLI validates `--workspace <uuid>` / `--all`, rejects a malformed uuid, and `--all` iterates workspaces one transaction each.
- [ ] 7.4 GREEN: `packages/db/trash-purge.ts` CLI + `package.json` `trash:purge` script.
- [ ] 7.5 Update `docs/RUNNING.md` with the operator cron line (`17 3 * * *  cd <repo> && bun run -F @deep-wiki/db trash:purge --all`).

## Phase 8: Web — Delete Action and Confirm Dialog Extension

- [ ] 8.1 RED: `apps/web/app/composables/useConfirm.test.ts` — with `confirmText` set, the confirm button stays `aria-disabled` until the typed value matches exactly; Enter inside the field confirms only on match.
- [ ] 8.2 GREEN: `apps/web/app/composables/useConfirm.ts`, `apps/web/app/components/ConfirmDialog.vue` — `ConfirmOptions.confirmText` per design Decision 8.
- [ ] 8.3 RED: `apps/web/app/composables/useTreeRowActions.test.ts` — Delete is disabled with a stated reason for a non-manageable id and for a non-owner on a non-empty container; enabled for the owner (`navigation-tree` spec).
- [ ] 8.4 GREEN: `apps/web/app/composables/useTreeRowActions.ts`, `apps/web/app/components/NavigationTreeActions.vue` — Delete kind, confirm flow, `409 not_empty` → `confirmText` dialog.
- [ ] 8.5 Build the delete flow against a real dev server per `docs/UI-CHECKLIST.md` §2–§6 (read both files in full first, per `CLAUDE.md`); write and pass its e2e happy path plus the force-delete wrong-name/stale-count cases.
- [ ] 8.6 **STOP — owner review gate 1/3: Delete action and the extended confirm dialog.** Do not start Phase 9 until reviewed against `docs/UI-CHECKLIST.md` and `docs/DESIGN-SYSTEM.md`.

## Phase 9: Web — Trash Screen

- [ ] 9.1 RED: `apps/web/app/utils/routes.test.ts` — `trashUrl(slug)` resolves to `/w/<slug>/trash`.
- [ ] 9.2 GREEN: `apps/web/app/utils/routes.ts` — `trashUrl()`; `apps/web/app/components/ManagementSidebar.vue` gains the Trash entry.
- [ ] 9.3 GREEN: `apps/web/app/composables/useTrash.ts`, `apps/web/app/components/TrashList.vue`, `apps/web/app/pages/w/[workspace]/trash.vue` per design Decision 8's screen contract (rows, states, inline restore-as, empty state).
- [ ] 9.4 Build against a real dev server per `docs/UI-CHECKLIST.md` §2–§6; write and pass e2e coverage for list/restore/restore-as/empty/skeleton/error states.
- [ ] 9.5 **STOP — owner review gate 2/3: Trash screen.** Do not start Phase 10 until reviewed against `docs/UI-CHECKLIST.md` and `docs/DESIGN-SYSTEM.md`.

## Phase 10: Web — Trashed-Page State and Book History Timeline

- [ ] 10.1 RED: a test for `apps/web/app/pages/w/[workspace]/p/[id]/index.vue` — a manager visiting a trashed page's address sees the read-only `InlineNotice` with Restore; a non-manager sees the existing not-found screen.
- [ ] 10.2 GREEN: wire the page response's `trash` block into `apps/web/app/pages/w/[workspace]/p/[id]/index.vue`.
- [ ] 10.3 RED: a test for `apps/web/app/pages/w/[workspace]/b/[id]/history.vue` — `deletions[]` and `changesets[]` render as one timeline interleaved by time (`changesets` spec).
- [ ] 10.4 GREEN: wire `deletions` into `history.vue`'s timeline rendering.
- [ ] 10.5 Build both against a real dev server per `docs/UI-CHECKLIST.md` §2–§6; write and pass their e2e coverage.
- [ ] 10.6 **STOP — owner review gate 3/3: trashed-page state and book history timeline.** Do not start Phase 11 until reviewed against `docs/UI-CHECKLIST.md` and `docs/DESIGN-SYSTEM.md`.

## Phase 11: End-to-End Suite

- [ ] 11.1 Write `e2e/trash.spec.ts` covering design Decision 8's full list: delete → absent from tree and `GET /pages/:id` → listed → restore → back in the tree at the parent's end; owner force-delete (wrong name keeps Restore disabled, exact name enables, stale count re-asks with the fresh number); former reader gets the same not-found for `/w/<slug>/p/<id>` and a random id; a manager of one shelf sees only that shelf's items; a manager on a trashed page's address sees the notice and restores; restore-as after a collision; no horizontal overflow at 320 on the list and the dialog; a full keyboard pass through delete → confirm → trash → restore.
- [ ] 11.2 Run the full e2e suite against a real backend; fix any flake before proceeding.

## Phase 12: Documentation and Final Verification

- [ ] 12.1 `docs/SPECS.md` §3.2 — add `trashed_at`, `trash_operation_id`, `trashed_by` to the `nodes` column list; note the live-only partial unique index.
- [ ] 12.2 `docs/SPECS.md` §14 — record this change's decisions: the `live_nodes`/`live_page_content` view-pair mechanism, purge-as-a-job, the trace keyed to the book.
- [ ] 12.3 `docs/WALKTHROUGH.md` — add the delete/trash/restore walkthrough steps.
- [ ] 12.4 `docs/TODO.md` — append (never delete) Findings: shelves have no book, so their trace rows have `book_id IS NULL` and no screen shows them yet; the tree's `manageable`/`isOwner` signal closes part of the "no `manage` signal reaches the client" question for one action only; the three spec reconciliations from design's Open Questions (`node-trash` 403/404 split, `trash-non-disclosure` wording, `deletion-trace` `restricted` scenario).
- [ ] 12.5 `apps/web/PRODUCT.md` — remove or update its "Not yet: deletion" line.
- [ ] 12.6 `CLAUDE.md` — update the check list from eleven checks to twelve, adding `trash-filter.ts`'s header summary in the numbered list.
- [ ] 12.7 Run `bun run check`, `bun run typecheck`, `bun run lint`, `bun run test`, `bun run -- gate-2-round-trip`, then the full `bun run e2e` suite as separate stages (the combined `bun run verify` is OOM-killed on this host).
- [ ] 12.8 Confirm every Success Criteria checkbox in `openspec/changes/deletion-and-trash/proposal.md` (read-only) against shipped behaviour before declaring the change complete.
