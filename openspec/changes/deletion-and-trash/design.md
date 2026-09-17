# Design: Deletion and Trash

## Technical Approach

Approach 1 from the exploration, made mechanical. A trashed node is a live row with `trashed_at`, `trash_operation_id` and `trashed_by` set on it and on every live descendant in one transaction. Non-disclosure is not a predicate each read site remembers: two Postgres views, `live_nodes` and `live_page_content`, are the only spelling of `nodes`/`page_content` a read site may use, and a new structural check (`scripts/checks/trash-filter.ts`, in `bun run check`) fails any module that names the base table outside a short, reasoned allow-list. The permission resolver keeps walking the base table, so `manage` on a trashed node still resolves and the Trash listing is an ordinary `canManyResources(manage)` fold. The purge is the `reindex.ts` idiom driven by a CLI and a cron line. The pure rules — what "empty" means, who may force, what `N` is, when a restore is refused, the retention constant — live in `packages/core/src/trash/` with no framework import.

Read the specs under `specs/` first; this document says how each is met and names three places where the design and a spec must be reconciled (Open Questions).

```
DELETE /nodes/:id ─┐                          GET /workspaces/:ref/trash
POST …/force-delete┴► routes/trash.ts ──► db/src/trash/{trash-node,restore,listing,lookup,trace}.ts
                                              │            │
                              core/trash/rules.ts ◄────────┘   (decideTrash · decideRestore · TRASH_RETENTION_DAYS)
                                              │
        nodes ──► live_nodes ──► every other read route        purge CLI (cron) ──► db/src/trash/purge.ts ──► DELETE FROM nodes … cascade
        page_content ──► live_page_content ──► chunks / content reads             └─► node_deletions (+purged row)
```

## Architecture Decisions

### Decision 1 — Schema: three columns on `nodes`, a partial unique index, a guard trigger, two views, two tables

**Choice.** Migration `0022_trash.sql` + `down/0022_trash.down.sql`:

| Object | Definition |
|---|---|
| `nodes.trashed_at timestamptz`, `nodes.trash_operation_id uuid`, `nodes.trashed_by uuid REFERENCES users ON DELETE SET NULL` | `CHECK ((trashed_at IS NULL) = (trash_operation_id IS NULL))`. Column name follows the `tenancy-model` delta (`trash_operation_id`, not `trash_op_id`). |
| `nodes_parent_slug_unique` → dropped; `CREATE UNIQUE INDEX nodes_parent_slug_live_idx ON nodes (parent_id, slug) WHERE trashed_at IS NULL` | Live siblings stay unique; a trashed row frees its name. `seed.ts` looks nodes up with a `SELECT`, not `ON CONFLICT`, so nothing else names the constraint. |
| `nodes_ws_trashed_idx (workspace_id, trashed_at) WHERE trashed_at IS NOT NULL`; `nodes_trash_op_idx (trash_operation_id) WHERE trash_operation_id IS NOT NULL` | Listing, purge and restore predicates. |
| `nodes_trash_guard()` BEFORE INSERT OR UPDATE OF `parent_id`, `trashed_at` | Raises when a **live** row would sit under a trashed parent, unless the parent shares the row's `trash_operation_id` (so one `UPDATE … WHERE trash_operation_id = $op` restores a whole op regardless of row order). Storage-layer enforcement of the invariant *live ⇒ parent live*, in the `0016_page_blocks_no_resurrection` idiom. |
| `live_nodes` = `SELECT * FROM nodes WHERE trashed_at IS NULL`; `live_page_content` = `page_content` joined to `nodes` on `(node_id, workspace_id)` `WHERE trashed_at IS NULL` | The helper (Decision 2). Simple views are inlined by the planner, so `nodes_ws_path_idx`/`nodes_ws_parent_position_idx` still serve. Declared in `schema.ts` as `pgView(...).existing()` for the builder twin. |
| `node_deletions` | Decision 5. |
| `trash_purge_runs` | Decision 6. |

**Propagation.** Because every live descendant is stamped at trash time, "trashed" is a property of the row, never of its ancestry: `live_nodes` needs no ancestor walk, and a child's `trashed_at` is always ≤ its parent's (a child can only be trashed *before* or *with* its parent), so a parent eligible for purge never leaves a younger child behind.

**`path` trigger.** Untouched. Trash and restore never change `parent_id`; a move of a live container still rewrites *every* descendant's path through `subtree.ts`, trashed rows included, so a later restore finds consistent paths. `page_content` needs nothing — it stays byte-identical until the cascade.

**Down path.** Drops views, tables, trigger and indexes, then refuses (`RAISE EXCEPTION`) while any trashed row shares `(parent_id, slug)` with a live sibling; otherwise re-creates the unconditional constraint and drops the three columns — trashed rows become live, as the proposal's rollback plan states.

**Alternatives rejected.** A `trashed_nodes` table (exploration Approach 2: breaks the cascade the purge relies on, duplicates `NodeType`). An `is_trashed` boolean plus a separate timestamp (two facts for one). Storing the op only on the root row (restore would have to re-derive "what came with it" from ancestry, which is exactly the resurrection bug the proposal names).

### Decision 2 — The helper is a view, and the check forbids the base table

**Choice.** A read site writes `FROM live_nodes` / `JOIN live_page_content` (builder: `.from(liveNodes)`). `scripts/checks/trash-filter.ts` has two rules, both in `query-boundaries.ts`'s idiom (regex over source text, `*.test.ts` excluded, a Drizzle twin per rule, self-files exempt, fixtures under `__fixtures__/trash-filter/`):

| Rule | Fails when |
|---|---|
| 1 — base table | Outside `ALLOW_LIST`, a file contains `\b(FROM\|JOIN)\s+(nodes\|page_content)\b` or `\.(from\|join\|innerJoin\|leftJoin)\s*\(\s*(nodes\|pageContent)\s*[,)]`. `\bnodes\b` does not match inside `live_nodes`. |
| 2 — page-keyed tables | Outside `ALLOW_LIST`, a file reads (`FROM\|JOIN`) any of `page_revision`, `changeset`, `comments`, `links`, `page_tags`, `chunks`, `page_locks`, `presence` and names neither `live_nodes` nor `live_page_content` (nor the builder identifiers). This is what catches `changesets/history.ts`, which lists a trashed page's revisions today without ever naming `nodes`. |

`ALLOW_LIST` is a `Record<path, reason>` as in `test-coverage.ts`; an entry with an empty reason is an error. Initial entries: `packages/db/src/nodes/subtree.ts` (path-prefix operations over the whole subtree, trashed rows included), `packages/db/src/nodes/verify-paths.ts` (integrity over every row), `packages/db/src/permissions/` (the resolver must walk trashed rows so `manage` on one resolves), `packages/db/src/trash/` (the one module that reads trashed rows on purpose), `packages/db/src/content/{save-page,rebuild-derived,backfill-render,read-page}.ts` (write transaction and its reads, entered only after the route located the node), `packages/db/seed.ts`, `e2e/` fixtures. Everything else — `create/rename/move/reorder.ts` lookups and `resolveSiblingSlug`, every route, `revisions/queries.ts`, `changesets/history.ts`, `comments/queries.ts`, `mentions`, `tags`, `presence` — turns red at first and is made green one file at a time (Decision 9).

**How `manage` holders see trashed rows.** Only through `packages/db/src/trash/`: the listing (`manageableTrashRoots` in `permissions/manageable-trash.ts` = op-root query + `canManyResources({ action: 'manage' })`) and `trashLookup(nodeId, subject)` (base-table read + `can(manage)`), which `GET /pages/:id` calls after a `live_nodes` miss so a manager following a stale link gets the content plus a `trash` block (page-content delta, "A manager can still read a trashed page's content") and everyone else gets the same 404 an unknown id gets.

**Wiring.** `package.json` `check` gains `bun run scripts/checks/trash-filter.ts`; `scripts/checks/__tests__/trash-filter.test.ts` runs the fixtures; `checks-wiring.test.ts` W1–W3 then hold without edits. CLAUDE.md's check list grows from eleven to twelve.

**Alternatives rejected.** A `sql` fragment `notTrashed(alias)` (a fragment can be interpolated into the wrong clause — `LEFT JOIN … ON` — and still pass a text check). A set helper mirroring `readableResourceIds` (a post-filter a site can forget to apply, and N ids across the wire for every list). Filtering inside the permission CTEs (`manage` on a trashed node must keep resolving, and `pages.ts` answers 403 for a denied live page, which would make a trashed page 403 instead of 404).

### Decision 3 — Trash and force-delete: two routes, one pure decision

**Choice.**

| Route | Gate | Body → answer |
|---|---|---|
| `DELETE /nodes/:id` | 404 when no `read` (`live_nodes` miss or `can(read)` false); 403 `forbidden` when `read` but neither `manage` nor owner | Container with live children → `409 { error: 'not_empty', pages, containers, canForce }`; otherwise `200 { trashOperationId, trashed: { pages, containers } }` |
| `POST /nodes/:id/force-delete` | Same 404/403; then `session.userId === workspaces.owner_id` or 403 | `{ confirmName, acceptedCount }` → `409 { error: 'name_mismatch' }` or `409 { error: 'stale_count', pages, containers }` naming the fresh count; else `200` as above |

The owner is `workspaces.owner_id` (exists since `0001`; the creator, granted `manage` at the root in `createWorkspace`). No owner transfer exists; not needed here. The rule lives in `packages/core/src/trash/rules.ts`:

```ts
decideTrash({ mode: 'trash' | 'force', isOwner, hasManage, isContainer, live: { pages, containers },
              submitted?: { confirmName, acceptedCount }, title })
  → { ok: true } | { ok: false, reason: 'forbidden' | 'not_empty' | 'name_mismatch' | 'stale_count' }
```

The route reads `can(manage)`, `owner_id` and the counts and hands them to `decideTrash`; the owner rule is expressed in core, not as a route-level bypass, and `decide()`'s 30-case table is untouched. `N` is live descendant **pages** (spec: "count of live descendant pages"); `containers` is returned beside it for the sentence but is not what the owner accepts. Both counts come from `subtree.ts`, which gains `liveOnly` on `queryDescendantIds` and a new `trashLiveDescendants(tx, { workspaceId, ancestorPath, operationId, userId })` — the propagation `UPDATE … WHERE path LIKE $prefix AND trashed_at IS NULL` is a `path LIKE` writer and can live nowhere else (`query-boundaries` rule 2).

`trashNode()` in `packages/db/src/trash/trash-node.ts`, one transaction: `SELECT … FROM workspaces … FOR UPDATE` (the house serialisation idiom — the count and the UPDATE are one decision, so a page created between the confirmation and the submit is caught by `stale_count`), re-read the node from the base table `WHERE trashed_at IS NULL`, count, `decideTrash`, propagate, `DELETE FROM page_locks WHERE node_id = ANY(op ids)` (page-content delta; presence is a view over locks and clears with them), append the trace (Decision 5), return the op id.

**Reconciliation.** The `node-trash` spec's scenario "Subject without manage or ownership is denied … identically to the node not existing" would answer 404 to a subject who can *read* the node. `tree.ts`'s `authorizeWrite` rules the opposite for every tree write ("a caller who can read the parent already knows it exists, so naming the missing grant discloses nothing"), and the Delete row action is on screen for that subject. The design follows the precedent — 404 without `read`, 403 with it — and asks for the spec scenario to say so (Open Questions).

**Alternatives rejected.** A single `DELETE` whose body carries the force fields (a DELETE body is legal but stripped by some clients, and the force path deserves its own audit line). A pre-flight `GET …/delete-preview` (the 409 on the plain delete already carries the count; one fewer route). Owner as an implicit root `manage` grant in the resolver (bypasses every explicit deny — a GATE-1 semantic change nobody asked for).

### Decision 4 — Restore by operation id, to the end of the parent, never with a minted name

**Choice.** `POST /trash/:operationId/restore` body `{ name?: string }`, gate `manage` on the op root (404 otherwise — a trashed op id must be indistinguishable from an unknown one). `restoreOperation()` in `packages/db/src/trash/restore.ts`, one transaction under the workspace row lock:

1. Op root = the row of the op whose parent is not in the op. Parent must exist and be live, else `409 { error: 'ancestor_trashed', ancestor: { title } }`. Only the direct parent is checked — the guard trigger's invariant makes "parent live" equivalent to "every ancestor live".
2. Slug: keep the original unless a live sibling holds it → `409 { error: 'slug_taken', sibling: { title } }`. With `name`: `resolveSiblingSlug(tx, { parentId, title: name })` — the one collision rule, now reading `live_nodes` — and the root's `title`/`slug` are rewritten; a second collision is the same 409. Descendants keep their slugs: their live siblings were all trashed with them, so nothing below the root can collide.
3. Position: the root goes to the **end** of its parent's live children (`MAX(position) + 1`); descendants keep theirs (their sibling sets are unchanged).
4. `UPDATE nodes SET trashed_at = NULL, trash_operation_id = NULL, trashed_by = NULL WHERE trash_operation_id = $op` — one statement, trigger-safe per Decision 1; append a `restored` trace row.

`decideRestore({ parentLive, slugTaken, requestedName })` in core names the refusal; the route maps it. The Trash listing carries `restoreBlockedBy: { title } | null` per item so the screen can disable Restore with the reason before anyone clicks.

**Alternatives rejected.** Restore to the original `position` (thirty days of reordering later, the number means nothing and a tie with a live sibling gives the tree an unstable order; the row can be moved afterwards). Shifting siblings to make room (rewrites rows nobody touched). Restore by node id (would have to re-derive the co-trashed subtree from ancestry and resurrect what someone else deleted on purpose). Restoring a trashed ancestor implicitly (BookStack refuses; the owner ruled the same).

### Decision 5 — The trace: `node_deletions`, keyed to the book, decided by a snapshot

**Choice.**

```sql
node_deletions (
  id uuid PK, workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  book_id uuid, book_node_type node_type NOT NULL DEFAULT 'book' CHECK (book_node_type = 'book'),
  node_id uuid NOT NULL,            -- no FK: the node is purged and the row stays
  node_type node_type NOT NULL, title text NOT NULL, location text NOT NULL,   -- "Shelf › Book › Chapter", snapshot
  event text NOT NULL CHECK (event IN ('trashed','restored','purged')),
  trash_operation_id uuid NOT NULL, actor_id uuid REFERENCES users ON DELETE SET NULL,
  page_count integer NOT NULL DEFAULT 0, restricted boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (book_id, workspace_id, book_node_type) REFERENCES nodes (id, workspace_id, type) ON DELETE CASCADE )
```

`book_id` is the nearest `book` ancestor via `resolveBookId` (the same walk changesets use); a book names itself, so its trace cascades with its own purge, as the owner accepted. A shelf has no book: `book_id IS NULL`, the row exists in the workspace and no screen shows it yet (recorded gap). Written in the trash, restore and purge transactions; `restored`/`purged` rows copy `book_id` from the node's latest `trashed` row rather than walking ancestors again. A `BEFORE UPDATE` trigger refuses updates (append-only, `0012`'s revision idiom).

**Book history.** `GET /books/:id/history` gains `deletions: DeletionTrace[]` beside `changesets` (a trace is not a changeset; the diff screen keeps consuming `changesets` unchanged); `pages/w/[workspace]/b/[id]/history.vue` renders one timeline ordered by time, a trace line reading "*Page X* deleted by Y · <time>" / "restored by …". While the book itself is trashed the route answers 404 (`live_nodes` miss) and its traces are invisible; they return with the book.

**Disclosure.** `restricted` is snapshotted at trash time by `hasGrantsBetween(bookId, nodeIds)` in `packages/db/src/permissions/` (one `EXISTS` over `permissions` for the op's ids below the book): when no grant row sits between the book and the node, the node's readability *was* the book's by construction, and a reader of the book may see the line — which is the `deletion-trace` spec's rule. A `restricted` row is filtered through `canManyResources(read)` on `node_id` while the row exists (the rule revisions already follow on this route) and, after purge, is shown only to `manage` on the book. Recorded as a reconciliation item.

**Alternatives rejected.** An FK to the node with `ON DELETE SET NULL` (the spec wants the id kept; a null id cannot pair `restored` with its `trashed`). Folding traces into `changeset` rows (a deletion has no revisions; every consumer of changesets would need a branch). A workspace-level activity table (the owner keyed the trace to the book).

### Decision 6 — Purge: a tracked run per workspace, a CLI, a cron line

**Choice.** `packages/db/src/trash/purge.ts`, `purgeTrash(sql, { workspaceId, now? })`, one transaction under the workspace row lock: insert a `trash_purge_runs` row (`state` enum `trash_purge_run_state` queued|running|completed|failed, `cutoff`, `purged_nodes`, `started_at`, `finished_at`, `error_code`), select the eligible roots `WHERE workspace_id = $1 AND trashed_at IS NOT NULL AND trashed_at < $cutoff` (`cutoff = now - TRASH_RETENTION_DAYS` computed in core, compared in SQL), append `purged` trace rows for pages and containers under a book, `DELETE FROM nodes WHERE id = ANY(ids)` — the cascade removes content, blocks, revisions, comments, links, tags, chunks, locks, grants and changesets — then mark the run `completed` with the count. A rerun finds nothing and completes as a no-op; a failure marks `failed` and rolls the deletes back. `TRASH_RETENTION_DAYS = 30` is a core constant; per-workspace retention is out of scope.

`packages/db/trash-purge.ts` (beside `ai-reindex.ts`): `bun run -F @deep-wiki/db trash:purge --workspace <uuid> | --all`; `--all` iterates workspaces one transaction each. `docs/RUNNING.md` documents the operator line (`17 3 * * *  cd <repo> && bun run -F @deep-wiki/db trash:purge --all`). No in-process scheduler, no on-demand purge route or button (trash-purge spec; the launch brief's `DELETE /trash/:opId` is therefore **not** built).

**Alternatives rejected.** A `setInterval` in `apps/api` (a second process owning writes, invisible to the operator, and a test-suite hazard). A `queued` job the API enqueues (nothing enqueues; the sweep is the job). Deleting per node in application code (the cascade already is the mechanism, "by choice").

### Decision 7 — API surface and contracts

| Route | File | Notes |
|---|---|---|
| `DELETE /nodes/:id`, `POST /nodes/:id/force-delete` | `apps/api/src/routes/trash.ts` (`createTrashRoutes`) | Decision 3 |
| `GET /workspaces/:ref/trash` | same | `resolveWorkspaceId` (id or slug), then `readableWorkspaceIds` gate (404 like the tree), then `manageableTrashRoots`; an empty list for a member with no `manage` anywhere — indistinguishable from an empty trash, deliberately |
| `GET /trash/nodes/:id` | same | `trashLookup`: 404 unless trashed **and** `manage`; feeds the "in the trash" state on a page screen |
| `POST /trash/:operationId/restore` | same | Decision 4 |
| `GET /books/:id/history` | `revisions.ts` | gains `deletions` |
| `GET /workspaces/:id/tree` | `tree.ts` | gains `manageable: string[]` (`canManyResources(manage)` over the same rows) and `isOwner: boolean` — the one `manage` signal the client needs for a disabled-with-reason Delete (Decision 8); no other action is exposed |
| `GET /pages/:id` | `pages.ts` | after a `live_nodes` miss, `trashLookup`; a hit adds `trash: { operationId, trashedAt, trashedBy, daysLeft, restoreBlockedBy }` |

Contracts in `packages/contracts/src/trash.ts`: `TrashNodeResponseSchema`, `NotEmptyRefusalSchema`, `ForceDeleteRequestSchema`, `TrashListingResponseSchema` (item: `operationId`, `root: { id, type, title }`, `location: string[]`, `trashedBy: { id, displayName } | null`, `trashedAt`, `purgeAt`, `daysLeft`, `pages`, `containers`, `restoreBlockedBy`), `RestoreRequestSchema`, `RestoreResponseSchema`, `RestoreRefusalSchema`, `TrashLookupResponseSchema`, `DeletionTraceSchema`; `BookHistoryResponseSchema` and the tree response extended. No secret-shaped field (query-boundaries rule 5). `index.ts` mounts `createTrashRoutes` (routes-mounted).

### Decision 8 — UI: one dialog extended, one new screen, one new page state

All three are human-gate surfaces; the pre-build contract, the state list and the e2e list below are the tasks' input, and `docs/UI-CHECKLIST.md` + `docs/DESIGN-SYSTEM.md` are read in full before the first line of markup.

**Delete, in the row menu and the toolbar** (`useTreeRowActions.ts`, `NavigationTreeActions.vue`): kind `'delete'`, label "Delete…", icon `i-lucide-trash-2`, last group. Disabled (`aria-disabled`, reason as the visible description, §3/§5) when the id is not in `manageable` and the caller is not owner ("You need manage access to delete this."), or when a container has visible children and the caller is not owner ("Empty this chapter first — only the workspace owner can delete a chapter with pages in it."). The client's "non-empty" is a lower bound (unreadable children are invisible); the server's `409 not_empty` is shown as the existing chip-tier notice beside the tree, without a count for a non-owner. Flow: Delete → `confirm({ title: 'Delete "X"?', description: 'It moves to the trash for 30 days, where anyone who manages it can restore it.', confirmLabel: 'Delete', tone: 'destructive' })` → `DELETE` → row removed optimistically, live region "Moved “X” to the trash." with a link to the Trash → or `409 not_empty` with `canForce` → second dialog with `confirmText`.

**`ConfirmOptions.confirmText?: string`** (`useConfirm.ts`, `ConfirmDialog.vue`): when present the dialog renders a `UFormField` ("Type *Handbook* to confirm") over a `UInput` (16px, `h-14`, §9.5), the description carries the count ("**12 pages** and 3 chapters will be deleted. They move to the trash for 30 days."), the confirm button is `aria-disabled` with "Type the name exactly as shown." until the trimmed value equals `confirmText` exactly, and Enter inside the field confirms only when it matches. Focus lands on the field rather than on Cancel — the match is the consent, so a stray Enter cannot confirm. Everything else — `z-70`, Escape and scrim as "no", focus return to the opener, `error` filled action — is unchanged. Still one dialog.

**Alternatives rejected.** A second, destructive-only confirmation component for the typed-name step: rejected because `useConfirm`'s own header comment states the product keeps exactly one confirm dialog, and a second component would fork that contract for a single flow rather than extend the one that already exists.

**The Trash screen** at `/w/<slug>/trash` (`trashUrl(slug)` in `routes.ts`; `pages/w/[workspace]/trash.vue` inside `layouts/workspace.vue`; "Trash" joins the Workspace section of `ManagementSidebar`). Nearest screen: `members.vue` — same `measure` column, same `PageHeading`, same list rhythm. Pre-build contract: a manager (or the owner) who deleted something, or was asked to bring it back; "get that page back"; the single primary action is Restore; data is the listing item above and nothing the client does not have; it does not purge, bulk-restore or reorder; empty is "The trash is empty. Deleted pages and containers stay here for 30 days." and 400 items are one list with the row's `title` truncated and the full title on hover/focus. Row: type icon + type word (§4.3), title `body-large`, supporting line "In Shelf › Book · deleted by Ana · <time datetime>" (`body-medium text-muted`, viewer's zone, zone named, client-formatted per §4.11), trailing "Gone in 12 days" as `label-small`, Restore as a Filled-tonal `soft` button (one Filled per screen is impossible on a list), `aria-disabled` with `restoreBlockedBy`'s reason when set. A `409 slug_taken` swaps the row's trailing area for an inline `UFormField` "New name" with the sibling's title in the reason ("A page named “Overview” already exists there."), Restore and Cancel; Escape cancels and returns focus to Restore. States: skeleton rows in the loaded box; recoverable error with Retry; the empty state doubles as the no-`manage` state on purpose (recorded); success announced in a live region ("Restored “X” to Book Y.") with an "Open" link, and the row leaves. Keyboard: every row action is a tab stop in reading order; no drag.

**A trashed page's address, for a manager** (`pages/w/[workspace]/p/[id]/index.vue`): the page response's `trash` block renders the content read-only under an `InlineNotice` "This page is in the trash — it will be deleted permanently in 12 days." with Restore (same restore call, same collision path) and the Edit/comment affordances withheld. Everyone else lands on the existing not-found screen, which renders from the status code alone.

**E2E (`e2e/trash.spec.ts`, real backend):** delete a page → absent from the tree and from `GET /pages/:id` → listed → restore → back in the tree at the end of its parent; owner force-delete: wrong name keeps Restore disabled, exact name enables, stale count (`POST /nodes` in between) re-asks with the fresh number; former reader: `/w/<slug>/p/<id>` and a random id render the same not-found screen; manager of one shelf sees only that shelf's items; manager on a trashed page's address sees the notice and restores; restore-as after a collision; no horizontal overflow at 320 on the list and the dialog; a full keyboard pass through delete → confirm → trash → restore.

### Decision 9 — What `sdd-tasks` must sequence

1. `0022_trash.sql` + down + `migration.test.ts` assertions; `schema.ts` views; `core/trash/rules.ts` with its tests (core-purity).
2. `scripts/checks/trash-filter.ts` + fixtures + test + `check` wiring — **red** on every existing read site.
3. Green one file at a time: `nodes/{create,rename,move,reorder}.ts` (trashed parent/target refused; slug among live siblings), `subtree.ts` additions, `content`, `revisions`, `changesets`, `comments`, then every route in `apps/api/src/routes/`; a test per surface from the point of view of a subject who could read the page before it was trashed.
4. `db/src/trash/` use cases + `permissions/manageable-trash.ts` + `hasGrantsBetween`; GATE-1 truth table gains the `manage`/owner cases.
5. Contracts, `routes/trash.ts`, `revisions.ts` deletions, `tree.ts` `manageable`/`isOwner`, `pages.ts` trash lookup; `routes-mounted` green.
6. `purge.ts`, `trash-purge.ts` CLI, `RUNNING.md` cron.
7. Web: `useTreeRowActions` Delete → `confirmText` → Trash screen → trashed-page state, each a human-gate checkpoint; then `e2e/trash.spec.ts`.
8. Docs: `SPECS.md` §3.2 (`trashed_at`, `trash_operation_id`) and §14 (this decision set), `WALKTHROUGH.md`, `TODO.md` Findings (owner-column gap for shelves' traces, the `manage` signal now on the tree response), CLAUDE.md's check count.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/db/drizzle/0022_trash.sql`, `drizzle/down/0022_trash.down.sql` | Create | Decision 1 |
| `packages/db/src/schema.ts` | Modify | three columns, `liveNodes`/`livePageContent` views, `nodeDeletions`, `trashPurgeRuns` |
| `packages/core/src/trash/{rules,index}.ts` | Create | `decideTrash`, `decideRestore`, `TRASH_RETENTION_DAYS`, `daysUntilPurge` |
| `packages/db/src/nodes/subtree.ts` | Modify | `liveOnly` count; `trashLiveDescendants` |
| `packages/db/src/nodes/{create,rename,move,reorder}.ts` | Modify | lookups and `resolveSiblingSlug` over `live_nodes` |
| `packages/db/src/trash/{trash-node,restore,listing,lookup,trace,purge}.ts` | Create | the use cases |
| `packages/db/src/permissions/{manageable-trash,grants-between}.ts` | Create | manage-set listing; `restricted` snapshot |
| `packages/db/trash-purge.ts` | Create | CLI on the `ai-reindex.ts` shape; `package.json` script `trash:purge` |
| `packages/contracts/src/trash.ts` (+ tree, book-history, page schemas) | Create/Modify | Decision 7 |
| `apps/api/src/routes/trash.ts`; `index.ts` | Create/Modify | routes; mount |
| `apps/api/src/routes/{tree,pages,revisions,comments,links,mentions,tags,activity,diff,presence,workspaces,invitations,ai-credentials}.ts` | Modify | `live_nodes`; `manageable`/`isOwner`; `deletions`; trash lookup |
| `packages/db/src/{revisions/queries,changesets/history,comments/queries}.ts` | Modify | join `live_nodes` |
| `scripts/checks/trash-filter.ts`, `__tests__/trash-filter.test.ts`, `__fixtures__/trash-filter/**`, root `package.json` | Create/Modify | Decision 2 |
| `apps/web/app/composables/{useTreeRowActions,useConfirm,useTrash}.ts`, `components/{ConfirmDialog,ManagementSidebar,NavigationTreeActions,TrashList}.vue`, `pages/w/[workspace]/trash.vue`, `pages/w/[workspace]/p/[id]/index.vue`, `pages/w/[workspace]/b/[id]/history.vue`, `utils/routes.ts` | Create/Modify | Decision 8 |
| `e2e/trash.spec.ts` | Create | Decision 8 |
| `docs/{SPECS,RUNNING,WALKTHROUGH,TODO}.md`, `CLAUDE.md` | Modify | Decision 9 |

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit (core) | `decideTrash`/`decideRestore` tables, retention arithmetic across a DST boundary | `bun test`, pure |
| Unit (checks) | each `trash-filter` rule against a valid and a violating fixture; wiring | fixtures under `__fixtures__/trash-filter/` |
| Integration (db) | propagation atomicity, guard trigger (restore under a trashed parent raises; same-op restore passes), partial index, `stale_count` under two transactions, restore by op only, purge boundary (29 vs 31 days), purge idempotence, cascade inventory, trace survival and cascade with the book, `restricted` snapshot | disposable Postgres, one test per scenario in the specs |
| Integration (api) | every read route: trashed id ≡ unknown id byte-for-byte for a former reader; 404/403 order on delete; manager paths | Hono app in tests |
| E2E | Decision 8's list | Playwright against a real backend |

## Threat Matrix

N/A — no VCS/PR automation, no shell-out, no subprocess, no executable-file classification. The purge CLI is an operator-invoked bun script taking `--workspace <uuid>` / `--all`, validates the uuid shape, binds parameters and never composes a command.

## Migration / Rollout

`0022` is additive and runs under the existing `migrate()`; existing rows are live by default. The down path refuses on a live/trashed slug collision rather than guessing (Decision 1). No production deployment exists; roll-forward is the practical path. The cron line is documentation until an operator installs it.

## Open Questions

- [ ] **Spec reconciliation — `node-trash`**: a subject with `read` but no `manage` should get 403 (the `authorizeWrite` precedent), not "identical to not existing". The design follows the precedent; the scenario should be amended.
- [ ] **Spec reconciliation — `trash-non-disclosure`**: "exactly one helper function" is realised as the `live_nodes`/`live_page_content` view pair (a view cannot be applied in the wrong clause); the scenarios hold unchanged, the wording should say "helper (a view)".
- [ ] **Spec reconciliation — `deletion-trace`**: add the `restricted` scenario (a node with its own grants below the book is not disclosed to a reader of the book after purge).
- [ ] **Scope addition for the owner**: the tree response now carries `manageable` and `isOwner`, closing part of the "no `manage` signal reaches the client" Open Question for one action only.
- [ ] Shelves have no book: their trace rows have `book_id IS NULL` and no screen shows them yet.
