# Proposal: Deletion and Trash

## Intent

Creation, rename, move and reorder exist; **deletion does not** (`docs/TODO.md` Finding 2026-09-09). It was withheld on purpose: `nodes_parent_fk` is `ON DELETE CASCADE`, so a delete today would silently take a whole subtree, every revision and every comment other people wrote, with no undo — the database answers "cascade" by accident, not by choice. The three product questions that blocked it were answered by the owner on 2026-09-17 and are recorded there as decision 11. This change builds what those answers describe: a delete that refuses a non-empty container, an owner-only force-delete that names its cost, a trash with restore for 30 days, a purge that runs on a schedule rather than on demand, and a trace in the book's history that outlives the purge.

Success looks like this: a page or container disappears from every surface the moment it is trashed, comes back intact when restored within 30 days, is gone for good afterwards, and the book's history still says who deleted it and when. Nothing about a trashed id tells a caller who could not read it that it ever existed.

## Decisions carried into this change

Confirmed by the owner (2026-09-17); the proposer did not reopen them.

| # | Decision |
|---|---|
| 1 | A container (shelf, book, chapter) must be **empty** to delete. Already-trashed descendants count as absent |
| 2 | The **workspace owner** may force-delete a non-empty container by typing its name and accepting "N pages will be deleted" — the whole live subtree, excluding already-trashed nodes |
| 3 | A page's comments and revisions go with it **at purge**; the book's history keeps a **permanent trace** ("page X deleted by Y at T") that survives the purge |
| 4 | **Trash with restore**, 30 days, then a purge job |
| 5 | Absence and denial are indistinguishable everywhere. Trash and restore require `manage` on the node, or the owner's force rule |

Rulings taken during research, following the BookStack lineage (`docs/SPECS.md` §1) and the house rule that the product never renames anything behind the user's back:

- **Restore under a trashed ancestor is refused with a named reason** (BookStack: "remain deleted until the parent is also restored"). Restoring a container restores the subtree trashed **with it** — the same trash operation — and not nodes trashed separately before. Deliberate: a restore must not resurrect something someone else deleted on purpose.
- **A slug collision on restore answers `409` naming the live sibling**, and the Trash screen offers "restore as …" with a name the person types. Never an automatic `-2`. Deliberate deviation from BookStack, Drive and Notion, where the collision is unhandled or silently suffixed.

## Scope

### In Scope

| Deliverable | Constraint |
|---|---|
| `trashed_at` on `nodes`, set on the node and its whole live subtree in one transaction, with the trash operation's id so a restore knows what came with it | `nodes` stays the single structural source of truth (`single-source.ts`) |
| `nodes_parent_slug_unique` becomes a partial unique index `WHERE trashed_at IS NULL` | Live siblings stay unique; a trashed row no longer blocks a name |
| `DELETE /nodes/:id` — empty-container rule, `manage` gate, owner force rule with the live-descendant count and the typed name verified server-side | Count computed through `subtree.ts`, the one `path LIKE` writer |
| One shared trash-aware read helper mirroring `readableResourceIds`, plus a structural check under `scripts/checks/` that fails when a read site over `nodes` or `page_content` does not go through it | The filter is a mechanism, not a checklist |
| Every existing read surface excludes trashed nodes: tree, page read, backlinks, mentions, tags, activity, revisions, diff, comments, presence, locks | A trashed id answers exactly what an unknown id answers |
| Append-only deletion trace keyed to the **book**, no cascading FK to the deleted node, written at trash time and again at restore | Outlives the purge; the book's history shows it |
| Trash screen under the management sidebar listing what the subject may `manage`; restore, "restore as …", per-item countdown to purge | Human-gate screen; "manageable set" is a new access pattern, implemented under `packages/db/src/permissions/` |
| `POST /nodes/:id/restore` with the two refusals above (`409` collision naming the sibling; trashed ancestor with a named reason) | Reuses `resolveSiblingSlug`; never mints a name |
| 30-day purge as an explicit tracked, idempotent per-workspace job on the `reindex.ts` idiom, deleting the node so the existing cascade chain does the rest | "Cascades on purge, by choice" — the accident becomes the mechanism |
| Tree row "Delete" action: disabled with a stated reason when the container is not empty and the subject is not the owner | `useTreeRowActions.ts` |
| `ConfirmOptions` gains an optional `confirmText`: the confirm button stays disabled until the typed text matches exactly | One confirm dialog, extended — not a second one |
| Create, rename and move refuse a trashed parent or target; rename may take a name a trashed sibling holds | `create.ts`, `rename.ts`, `move.ts` |

### Out of Scope

Bulk trash or bulk restore; trashing a workspace; AI and MCP write tools (`propose_edit`); an "empty trash now" action (purge runs on schedule only, per decision 4); retention configurable per workspace; recovery after purge. `packages/ai-tools` does not exist at `75c8edd`; Phase 7 inherits the helper and the structural check rather than receiving special treatment here.

## Capabilities

### New Capabilities

- `node-trash`: the trash operation — empty-container rule, owner force-delete with typed name and live count, subtree propagation, `manage` gate, the trace line written at trash time
- `trash-restore`: the Trash listing (manageable set), restore of a node with the subtree trashed with it, the trashed-ancestor refusal, the `409` collision and "restore as …"
- `trash-purge`: the tracked, idempotent, per-workspace 30-day purge job; cascade of content, revisions, comments, chunks and grants at purge
- `deletion-trace`: the append-only book-keyed record, its survival past purge, and its appearance in the book's history
- `trash-non-disclosure`: the shared trash-aware read helper, the structural check, and the rule that a trashed id is indistinguishable from an unknown or unreadable one on every surface. A dedicated spec rather than a delta on each read spec because the check is one requirement enforced in one place, as `core-purity-enforcement` is

### Modified Capabilities

- `tenancy-model`: `nodes` carries `trashed_at`; sibling slug uniqueness holds among **live** siblings only
- `navigation-tree`: trashed nodes are absent; the Delete row action and its disabled-with-reason states
- `knowledge-graph`: backlinks, autocomplete and tag navigation exclude trashed pages; a wiki-link to a trashed page renders as unresolved
- `page-content`: content access to a trashed page answers as absence; the lock is released at trash
- `revision-history`, `comment-threads`, `changesets` (base text lives in the unarchived `versioning-and-collaboration` change): history, comments and activity exclude trashed pages; the book history surfaces the deletion trace

## Approach

**Schema first, helper and check second, routes third, purge job fourth, UI last behind the human gate.**

- **Storage.** Approach 1 from the exploration. A timestamp on `nodes`, never a second table: restore is a column flip with no id churn, the permission resolver walks `parent_id` and is untouched, and the FK chain that made deletion dangerous becomes the purge's one-statement implementation. A trash operation id on each affected row is what makes "restore what was trashed with it" a query instead of a guess.
- **Non-disclosure as a mechanism.** Every route already routes absence and denial through one `notFound()`. The trash filter gets the same treatment: one helper, and a check in `bun run check` so a forgotten call site fails a commit, not a review. This is the GATE-1 posture applied to a new fact.
- **The trace is not the node.** It is a row keyed to the book with a title snapshot and no cascading FK to the deleted node, appended at trash and restore, never updated. It cascades only with the book itself, which the owner accepted: a book's history has no purpose without the book.
- **Purge is a job, not a trigger.** The `reindex.ts` idiom — `queued|running|completed|failed`, idempotent under a state guard — so a purge is observable and re-runnable. Deleting an already-gone row is a no-op, which is what makes it safe to re-run.
- **Hexagonal placement.** `packages/core` gains the pure rules — what "empty" means, who may force, which subtree restores, when a restore is refused — as functions over plain data. `packages/db` owns the SQL; `apps/api` the routes; `apps/web` the screen.

## Cross-cutting gates

| Gate | Assessment |
|---|---|
| **GATE-1 — permissions** | **Touched.** `manage` gates trash and restore; the owner force rule is a new decision the pure resolver must express, not a route-level bypass; the manageable-set listing is a new access pattern. The 30-case truth table must not regress, and the new cases are written from the unauthorised subject's point of view first |
| **GATE-2 — markdown round-trip** | Untouched. No markdown is parsed or serialised |
| **GATE-3 — vector tenant isolation** | Adjacent. `chunks` cascade at purge; a trashed page's chunks stay in the index for 30 days and the retrieval path, once it exists, MUST go through the helper. Recorded as a requirement on `trash-non-disclosure` |

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `packages/db/src/schema.ts`, `packages/db/drizzle/` | Modified | `trashed_at`, trash operation id, partial unique index, deletion-trace table, purge job table |
| `packages/db/src/nodes/` | Modified | Trash, restore, trash-aware `subtree.ts` count; `create`/`rename`/`move` legality |
| `packages/db/src/permissions/` | Modified | Manageable-set query; owner force rule |
| `packages/db/src/trash/` | New | Helper, purge job, deletion trace |
| `packages/core/src/` | Modified | Pure trash/restore rules; no framework import |
| `packages/contracts/src/` | Modified | Delete, restore, trash listing, trace schemas |
| `apps/api/src/routes/` | Modified | Delete and restore routes; the filter on every read route |
| `scripts/checks/` | New | The trash-filter structural check, wired into `bun run check` |
| `apps/web/app/` | Modified | Delete action, `confirmText`, Trash screen under the management sidebar |
| `docs/TODO.md`, `docs/SPECS.md` | Modified | Findings entry; §3.2 gains `trashed_at` |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A read surface misses the trash filter and a "deleted" page leaks | High | One helper plus a structural check in `bun run check`; a test per surface from the point of view of a subject who could read the page before it was trashed |
| Converting `nodes_parent_slug_unique` to a partial index on a live constraint | Med | Additive migration with a tested `down`; `create.test.ts` and `rename.test.ts` updated to state live-only uniqueness explicitly |
| "N pages will be deleted" counts already-trashed descendants, or is computed outside `subtree.ts` | Med | Count goes through `subtree.ts` with the trash predicate; the route re-counts server-side and refuses a stale count |
| Restore resurrects nodes trashed separately before the container | Med | Trash operation id on every row; restore selects by it, never by ancestry alone |
| Purge job deletes early or twice | Low | `trashed_at < now() - 30 days` evaluated in SQL; idempotent by construction; job rows record what ran |
| The manageable-set listing becomes a second permission path | Med | Lives under `packages/db/src/permissions/`; `query-boundaries.ts` rule 1 forbids anything else |
| `confirmText` widens the one confirm dialog in a way the UI gate rejects | Med | Optional field, disabled-until-match, reviewed against `docs/UI-CHECKLIST.md` and `docs/DESIGN-SYSTEM.md` before build; the screen is a human gate |
| `revision-history`, `comment-threads` and `changesets` specs are not archived yet | Med | Their deltas are written against the change-folder base; sdd-spec states which base each delta targets |
| The research artifact is not resolvable in Engram under `sdd/deletion-and-trash/research` | Low | Its findings and rulings are recorded in this proposal; sdd-design cites this document |

## Rollback Plan

1. **Code**: revert the work units. With no delete route mounted, `routes-mounted.ts` and typecheck catch any leftover reference.
2. **Schema**: every migration ships a tested `down`. The `down` for the partial index must first purge or rename trashed rows that collide with a live sibling, or the unconditional constraint cannot be restored — the `down` states this and refuses rather than guessing.
3. **Data**: a trashed row is a live row with a timestamp; rolling back the column loses the trash state, not the content. The trace table is additive and can be dropped without touching content.
4. **Dev reset**: `podman compose down -v` and re-bootstrap.
5. No production deployment exists; the practical path is roll-forward with a corrective migration.

## Dependencies

- `versioning-and-collaboration` merged on `main` (it is — `75c8edd`, v0.6.0); its specs are unarchived, see Risks.
- The `reindex.ts` job idiom and `readableResourceIds` as templates.
- Strict TDD: tests written before each unit, per `openspec/config.yaml`.
- Every new screen or interaction stops for owner review (`execution_mode.human_gates`).

## Success Criteria

- [ ] Deleting a non-empty container as a non-owner is refused with a named reason and no row changes
- [ ] The owner's force-delete requires the exact typed name and a server-verified live count; the whole live subtree is trashed in one transaction, already-trashed descendants untouched
- [ ] A trashed id answers byte-identically to an unknown id on every read surface, for a subject who could read it a moment before
- [ ] The structural check fails when a read over `nodes` or `page_content` bypasses the helper, and `bun run check` runs it
- [ ] Restore returns the node and exactly the subtree trashed with it; nodes trashed separately stay in trash
- [ ] Restore under a trashed ancestor is refused with a named reason; a slug collision answers `409` naming the live sibling; "restore as …" succeeds with the typed name and never with a minted suffix
- [ ] A name held by a trashed sibling is available to create and rename
- [ ] The purge job deletes nodes trashed 30 or more days ago, cascades their content, revisions, comments, chunks and grants, and is a no-op when re-run
- [ ] The book's history shows "page X deleted by Y at T" after the purge has run
- [ ] The Trash screen lists exactly what the subject may `manage` and passed the owner's review against `docs/UI-CHECKLIST.md` and `docs/DESIGN-SYSTEM.md`
- [ ] The GATE-1 truth table is green and gains the `manage`/owner cases
- [ ] `bun run check`, `bun run test`, `bun run typecheck`, `bun run lint` all green
