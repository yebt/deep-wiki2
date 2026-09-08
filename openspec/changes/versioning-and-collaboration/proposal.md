# Proposal: Versioning and Collaboration (Phase 3)

## Intent

Phase 2 gave the tree content and one writing surface. It kept exactly one row per page: `page_content` is overwritten on every save, so **the previous version of a document does not exist anywhere**. There is no history, no diff, no comment, and no signal that another person is in the document beyond the soft lock's own record.

Phase 3 adds the four collaboration primitives the product's own flow already assumes — a design document is *interrogated*, and interrogation without history, diffs and comments is just overwriting. Three of them are also load-bearing for later phases: Phase 5 lands every AI edit as a **pending revision reviewed through the diff view** (SPECS §9), and Phase 7's `get_diff` and `propose_edit` MCP tools are thin wrappers over what this change builds. Building the diff engine badly here is paid for twice.

**Headline sequencing requirement**: `page_blocks` gains **split provenance before any comment anchor ships**. The orphan-with-excerpt behaviour below is not implementable without it, and `docs/UI-CHECKLIST.md:143` forbids the failure mode that results — "never an anchor pointing at the wrong block". This is an ordering constraint on the work, not an aspiration.

## Settled decisions

Confirmed by the project owner, 2026-09-08. Recorded here so the spec and design phases inherit them rather than reopening them.

| # | Decision | Rationale | Consequence to accept |
|---|---|---|---|
| **1** | **Comment anchors orphan with their excerpt.** A comment captures its own excerpt at creation. When its block splits or merges and re-location confidence is low, the comment becomes an orphan displaying the original text it referred to | Same conservative bias as the existing τ=0.5 block-matching threshold (`docs/TODO.md` Finding 2026-09-06). Losing the position is acceptable; pointing at someone else's text is not | Comments can orphan on ordinary edits. The orphan surface is a first-class UI state, not an error path |
| **2** | **Changesets are implicit, grouped by window.** Saves by the same author in the same book inside a **30-minute** window join the same changeset, with an optional message | Book history stays complete without user ceremony, and stays far less noisy than one changeset per save | 30 minutes is **a default chosen for lack of an owner instruction and open to revision.** It MUST live as one named constant with a single source of truth — `CHANGESET_WINDOW_MINUTES` in `packages/contracts/src/env.ts` mirrored into `env.example`, where `scripts/checks/env-example.ts` already machine-checks the drift. Never a number written in two places |
| **3** | **Presence is `editing` only**, derived from the heartbeat the soft lock already runs (`packages/db/src/locks/page-lock.ts`, `PAGE_LOCK_HEARTBEAT_SECONDS=20`) | No new writes on the read path — SPECS §5.3 puts ~95% of traffic there and read mode is optimised precisely to avoid that cost. And no second TTL for one fact: "the same fact written in two places with nothing comparing them" is this repository's own named recurring defect | **"Who is reading this right now" is not a Phase 3 feature.** The roadmap bullet "surface what the team is working on right now" is scoped to **editing** activity only. `presence_mode` still declares `viewing`, unused, or the enum is narrowed — the design decides which |
| **4** | **Comment visibility is a separate overlay, composed client-side.** `rendered_html` stays one blob per page; `render()` emits an invisible `data-block-id` per anchored block; indicators and counts come from a **separate endpoint gated by `can('comment')`**; the client composes them onto the unchanged cached HTML | Forking the HTML cache per viewer is combinatorial and would couple permission changes to content-cache invalidation for the first time in the project. Reuses the non-disclosure pattern already shipped in `packages/db/src/permissions/{can-many,readable}.ts` with its test helper `apps/api/testing/expect-no-disclosure.ts` | **This resolves the tension recorded as UNRESOLVED in `docs/SPECS.md` §14** ("Read mode's cached HTML cannot bake in a per-viewer decision"). It picks that entry's second named closure — render inert, resolve client-side through a non-disclosing endpoint. **Resolving it also unblocks clickable wiki-links**, which §14 says had to wait for this decision. Making them clickable stays out of scope here; only the blocker is removed |

> **Correction, verified**: that §14 entry exists on `main` (`docs/SPECS.md:751`, commit `cc8c700`) and is **absent from this branch's** `docs/SPECS.md`. Phase 3's docs work unit must not assume it is present in the file it edits. It is also a concrete instance of the base-divergence risk below.

## Defects folded into scope

Fixes, not decisions. Each is a defect in an existing artefact that Phase 3 is the first change able to close.

| Defect | Where | Why it must be fixed here |
|---|---|---|
| The `presence` draft has `workspace_id` but **no composite foreign key** | `docs/SPECS.md:370-379` | It would be the only multi-tenant table in the project missing one, and the one feeding SSE fan-out. The project rule (SPECS §14) is composite FK `(id, workspace_id)` so a cross-tenant row is *unrepresentable*, not merely unqueried |
| Presence is per-**page** but broadcast per-**workspace** | Roadmap; SPECS §7.2 | "Ana is editing page X" discloses page X's existence to a member with no read on it. Same non-disclosure class as wiki-links. Needs **per-subscriber, per-page filtering**, not workspace-membership gating |
| `page_blocks` records **no split provenance** | `packages/db/drizzle/0008_page_content.sql:39-54` | On a split the new fragment gets a freshly minted id with nothing linking it to its origin. `supersededBy` is single-hop, with no path compression and no code anywhere that walks the chain. Decision 1 is unimplementable until this is closed |
| SPECS §7.2 still asserts "there is no separate lock table: an `editing` presence row *is* the lock" | `docs/SPECS.md:384-385` | Phase 2 shipped `page_locks` as a real compare-and-swap primitive. Decision 3 inverts the stated direction — presence is derived **from** the lock. The spec text must be corrected, not quietly contradicted by the code |

## Scope

### In Scope

| Deliverable | Constraint |
|---|---|
| `page_revision`: content snapshot plus the block index at that revision, written inside the existing save transaction | Composite FK `(page_id, workspace_id)` → `page_content`; `(changeset_id, workspace_id)` → `changeset` when non-null |
| `changeset`: book-scoped, implicit 30-minute window grouping, optional message | Own `workspace_id`; `(book_id, workspace_id, 'book')` FK into `nodes` with a CHECK, mirroring `page_content` |
| Block-level diff: added, removed, **modified**, **moved**, between any two revisions | Calls `matchBlocks()` fresh over `sliceBlocks()` of **both** sides. See the diff-input rule below |
| Page-level diff view; book-level "what changed since &lt;date&gt;" over changesets | Moved is a distinct visual treatment (`UI-CHECKLIST` §4.7); book diff is navigable between pages without returning to a list |
| `page_blocks` split provenance + a superseded-chain walk with path compression | Closes the Phase 2 gap. Property-tested over edit sequences |
| `comments` anchored to `(block_id, offset_within_block)` with a captured excerpt; threads, resolution state, mention notifications over `MailSender` | Orphan-with-excerpt per decision 1; reconciliation runs at save time alongside `reconcileBlocks` |
| Comment indicator/count endpoint gated by `can('comment')`; `render()` emits `data-block-id`; a comment on an unanchored block mints and persists an anchor into canonical markdown | Per decision 4. Anchor minting uses the already-designed lazy-assignment mechanism and must round-trip (GATE-2 corpus already covers the anchor syntax) |
| `presence` (`editing` only) derived from the lock heartbeat; SSE channel per workspace | Composite FK; **per-subscriber page-level read filtering** before any event leaves the server |
| Presence surfaced as the soft-lock signal: "Ana is editing, opened 4 minutes ago" | `UI-CHECKLIST` §4.8 — who and since when, stale presence expires visibly, never reads as a hard lock |
| Spec corrections: SPECS §7.2 presence table and lock relationship; TODO Findings entries | `docs/TODO.md` is append-only; other agents are active in it |

### Out of Scope

Clickable/resolved wiki-links (unblocked here, delivered separately); real-time multiplayer and full visibility of in-progress work (SPECS §15); `viewing` presence and any read-path presence write (decision 3); revision **restore/revert** as a user action — this change stores and diffs history, it does not roll back to it; AI pending revisions and the AI panel (Phase 5); `get_diff` / `propose_edit` MCP tools (Phase 7); diagrams (Phase 4); revision retention and pruning (Open Question below).

## The diff input rule

`page_revision.block_index` is built by `buildBlockIndex()`, which extracts **explicitly anchored blocks only**. It has the same *shape* as `page_content.block_index` and is a strict *subset* of a document's blocks. **The diff engine MUST NOT read the stored `block_index` column.** It re-parses `revision.content` through `sliceBlocks()` — which gives every top-level block an id, anchored or derived — and runs `matchBlocks()` over both sides at diff time.

This is what makes the diff work between *any* two revisions rather than only adjacent saves, and it is why **the roadmap forbids falling back to a line differ**: "moved" is free with stable block IDs and impossible without them. A line differ renders a move as delete-plus-add and throws away the entire payoff of block-level identity.

## Capabilities

### New Capabilities

- `revision-history`: `page_revision` snapshots written in the save transaction, and the page history query
- `changesets`: book-scoped implicit grouping by window, the single-source-of-truth window constant, book-level history as one query
- `block-diff`: added / removed / modified / moved over two block sets; the fresh-parse input rule; page and book diff views
- `comment-threads`: anchoring with captured excerpt, orphan-with-excerpt degradation, threads, resolution, mention notification
- `comment-overlay`: the `can('comment')`-gated indicator endpoint and client-side composition over the unchanged cached HTML
- `editing-presence`: presence derived from the lock heartbeat, SSE fan-out, per-subscriber page-level filtering

### Modified Capabilities

- `page-content`: "Save Regenerates The Cached Render And Block Index" gains a `page_revision` write in the same transaction; `page_blocks` gains split provenance and a compressed superseded chain
- `markdown-pipeline`: "Block Split Assigns The Original ID To The Best-Matching Fragment" gains a requirement that the **new** fragment records its origin; the superseded chain becomes walkable rather than single-hop
- `document-modes`: read mode's cached HTML carries invisible `data-block-id` attributes, and per-viewer comment data is required **never** to enter that cache; the soft lock gains presence as a derived broadcast without gaining a second heartbeat
- `permission-resolver`: the `comment` action gains its first real producer, and with it a non-disclosure requirement asserted against a real endpoint rather than vacuously

> **Correction to the exploration**: it attributed split provenance to `knowledge-graph`. Verified against the baseline — the block-ID split/merge/supersede requirements live in `openspec/specs/markdown-pipeline/spec.md:79-108`, and the `page_blocks` table ships in `0008_page_content.sql`. `knowledge-graph` is **not** modified here: its "Unresolved-Link Rendering Does Not Disclose Existence" requirement (spec.md:96) stays vacuous until wiki-links become clickable, which is out of scope.

## Approach

**Sequencing across the four subsystems.** Schema and provenance first, engine second, comments third, UI last.

1. **Foundation** (no user-visible surface): `page_revision`, `changeset`, the `page_blocks` split-provenance column and chain walk, the `presence` composite FK. Nothing here can be built on later without a data migration, and split provenance gates comments.
2. **Diff engine**: pure functions over `sliceBlocks`/`matchBlocks`, no persistence coupling. Testable in isolation, and the cheapest thing to get right.
3. **Comments**: anchoring, excerpt capture, the save-time reconciliation pass, the overlay endpoint, `data-block-id` emission.
4. **Presence**: derives from the lock; the SSE filter is its own gate. Independent of 2 and 3 apart from the FK in step 1, so it may run in parallel with them.
5. **UI last**: diff view, comment gutter, presence indicators — each a human-gate screen under `docs/UI-CHECKLIST.md` §1.

**Hexagonal placement.** `packages/core` keeps the domain shapes and ports (revision, changeset, comment anchor, the diff result type) with **zero framework imports** — `scripts/checks/core-purity.ts` enforces it. The diff *algorithm* consumes `{id, text}` pairs and belongs in `packages/markdown` beside `matchBlocks()`, which already produces exactly that. Persistence stays in `packages/db`, SSE transport in `apps/api`.

**Presence wraps the lock, it does not subsume it.** `acquireLock()` is an atomic `INSERT … ON CONFLICT … WHERE` compare-and-swap — genuine concurrency control that a one-way broadcast fact neither needs nor should duplicate. The same request that already refreshes `page_locks.heartbeat_at` every 20s refreshes and broadcasts presence server-side. No second client-driven heartbeat loop.

## Cross-cutting gates

| Gate | Assessment |
|---|---|
| **GATE-1 — permissions** | **Must not regress, and this change is the sharpest test of it since Phase 1.** Three new disclosure channels: the comment-indicator endpoint, presence SSE events, and mention notifications. Presence is the subtle one — workspace-membership gating is *not* sufficient, because presence is per-page. Every one of the three is covered by tests written from the unauthorised subject's point of view, via `apps/api/testing/expect-no-disclosure.ts` |
| **GATE-2 — markdown round-trip** | **Touched.** Minting an anchor for a comment writes into canonical markdown. The anchor syntax is already corpus-covered; the corpus must additionally prove that a *newly minted* anchor round-trips, and `data-block-id` emission must not alter serialisation — it is an HTML-render concern only |
| **GATE-3 — vector tenant isolation** | Not exercised (no vector query here), but its premise applies verbatim: every table added by this change carries a non-nullable `workspace_id` tied by a composite FK, resolved from the authenticated subject and never read from a request body |

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `packages/db/src/schema.ts`, `packages/db/drizzle/` | Modified | `page_revision`, `changeset`, `comments`, `presence`; split-provenance column on `page_blocks`. See the migration-number risk |
| `packages/db/src/content/save-page.ts` | Modified | Writes a `page_revision` and resolves the changeset window in the same transaction |
| `packages/db/src/content/rebuild-derived.ts` | Modified | Records split origin; runs the comment reconciliation pass alongside `reconcileBlocks` |
| `packages/db/src/locks/page-lock.ts` | Modified | Heartbeat also refreshes and emits presence |
| `packages/markdown/src/match-blocks.ts` | Modified | Split result exposes origin; new diff module consumes it |
| `packages/markdown/src/render.ts` | Modified | `blockAnchorHandler` emits an invisible `data-block-id` instead of nothing |
| `packages/core/src/` | Modified | Revision, changeset, comment-anchor and diff-result entities and ports — no framework imports |
| `packages/contracts/src/` | Modified | Revision, diff, comment, presence schemas; `CHANGESET_WINDOW_MINUTES` in `env.ts` |
| `env.example` | Modified | The window constant; drift is machine-checked by `bun run check` |
| `apps/api/src/routes/` | New | History, diff, comment, comment-indicator and presence-SSE routes, all behind `can()` |
| `apps/web` | New | Diff view, comment gutter and orphan surface, presence indicators — human-gate screens |
| `docs/SPECS.md`, `docs/TODO.md` | Modified | §7.2 presence table and lock relationship corrected; §14 tension marked resolved; Findings appended (append-only) |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Presence SSE leaks the existence of pages the subscriber cannot read.** Workspace-scoped fan-out is the natural implementation and the wrong one | High | Per-subscriber, per-page read filtering is a *requirement*, not an optimisation, and is tested from the unauthorised subject's point of view before the channel ships. A workspace-only filter fails the test |
| **Comments orphan more often than the owner expects.** Decision 1 trades position for correctness; if the reconciliation confidence threshold is set poorly the product feels lossy | Med | Instrument the orphan rate the same way τ=0.5's false-match rate is already tracked, and record it as a Finding once real edit traffic exists. The threshold is tunable; the conservative bias is not |
| **Two heartbeats for one fact.** An independent presence TTL beside the lock TTL is exactly this repository's named recurring defect, and it is the *easy* thing to build | Med | Decision 3 forbids it structurally: presence has no independent write path. A test asserts that no code path refreshes presence without going through the lock heartbeat |
| **The diff reads `block_index` because it is already stored and looks right.** It is an anchor-only subset; the diff would silently ignore every unanchored block | Med | Stated as an explicit requirement with a fixture whose blocks are entirely unanchored — a `block_index`-based implementation returns an empty diff and fails |
| **`data-block-id` changes the read-mode cache format**, so every existing `rendered_html` is stale on deploy | Med | The cached render is derived and regenerable from markdown. Ship a backfill that re-renders, and treat a missing attribute as "no anchors known" rather than an error |
| **Anchor minting writes into a document the user owns**, so a comment silently edits markdown | Med | Covered by GATE-2 (minted anchors round-trip) and surfaced in the UI: the user is told a comment anchors the block. Never a silent rewrite |
| **Migration-number collision with `ai-provider-foundation`** | High | See Delivery risk below. Owner-owned |
| **The changeset window is a guess.** 30 minutes may group too much or too little | Med | One named constant, one source of truth, machine-checked against `env.example`. Changing it is a config edit, not a code change, and no stored row encodes the window |

## Open Question — `page_revision` retention

**Carried forward as an open question, not decided here.** No retention or pruning policy exists anywhere in the roadmap or SPECS.

Volume is bounded by real save clicks: `apps/web/app/composables/useSavePage.ts` confirms saving is an explicit user action, and no autosave composable exists anywhere in the repository. That makes unbounded accrual acceptable at early-adopter scale and **unresolved for a mature deployment**. What is specifiable without the answer: that a revision is immutable once written, and that pruning — whenever it arrives — must never orphan a `changeset` or a comment anchored into a pruned revision's blocks. What is genuinely blocked on it: any cap, any TTL, any compaction scheme. Append to `docs/TODO.md` Open Questions.

## Delivery risk the owner owns — the migration base

`main` ends at `0007_invitations.sql`. Two branches are unmerged and both claim numbers above it:

| Branch | Migrations | Collision |
|---|---|---|
| `content-and-editor` (this base) | `0008_page_content`, `0009_knowledge_graph`, `0010_page_locks` | — |
| `ai-provider-foundation` | `0008_ai_settings_and_credentials`, `0009_ai_usage_ledger`, `0010_ai_capability_observations`, `0011_embedding_indexes_and_chunks`, `0012_embedding_reindex_jobs` | **`0008`, `0009` and `0010` are each taken twice** |

**This proposal assumes `content-and-editor` as its base** and would number Phase 3's migrations from `0011` — which `ai-provider-foundation` has already used.

**If the owner merges `ai-provider-foundation` first**, Phase 3's migrations renumber from `0013`, and `content-and-editor`'s own three need renumbering during that merge. **If `content-and-editor` merges first**, the AI branch's five renumber instead. Either way the renumbering is mechanical but must happen *at merge*, not after both are on `main` — two `0008`s on one branch is a broken migration table, not a conflict Git will report. The same divergence already shows in `docs/SPECS.md`, where §14's entry exists on `main` and not on this branch.

The decision is the owner's. This change does not pick a merge order; it states which base it assumed so the assumption is falsifiable.

## Rollback Plan

1. **UI**: revert the diff, comment and presence screens. Read and edit modes are independent by construction and keep working.
2. **Presence**: revert the SSE route and the heartbeat's broadcast call. The lock is unchanged and stays coherent without presence — Phase 2 built it that way deliberately (`page-lock.ts:1-6`).
3. **Comments**: revert routes and the reconciliation pass. Persisted anchors minted for comments **stay in the markdown** — they are valid anchor syntax that round-trips, so they are inert rather than corrupt.
4. **Diff**: pure functions with no persistence; deleting the module is the whole rollback.
5. **Schema**: each migration ships a tested `down`, applied in reverse (`presence` → `comments` → `changeset` → `page_revision` → the `page_blocks` provenance column). Dropping `page_revision` **destroys history that cannot be regenerated** — it is the one irreplaceable artefact this change creates, and its `down` must say so.
6. **Cache**: `rendered_html` is derived; re-render to strip `data-block-id`.
7. No production deployment exists, so the practical path is roll-forward with a corrective migration.

## Dependencies

- Phase 2 (`content-and-editor`) merged or assumed as base: `page_content`, `page_blocks`, `page_locks`, `matchBlocks()`, `sliceBlocks()`, `render()`.
- `MailSender` (Phase 1) for mention notifications.
- **Sequencing**: split provenance before any comment anchor. Per-subscriber SSE filtering before any presence event leaves the server.
- **Owner-owned, not blocking specification**: the merge order against `ai-provider-foundation`.

## Success Criteria

- [ ] A comment whose block splits or merges below the confidence threshold renders as an orphan with its original excerpt — never attached to a different block's text
- [ ] `page_blocks` records split origin, and the superseded chain is walkable and path-compressed, proven by property tests over edit sequences
- [ ] Two saves by one author in one book inside the window share a changeset; a save outside it starts a new one; the window exists as exactly one constant, and `bun run check` fails if `env.example` drifts from it
- [ ] The diff reports added, removed, modified and **moved** between any two revisions, including non-adjacent ones, and a document with zero anchored blocks still diffs correctly
- [ ] No diff code path reads the stored `block_index` column
- [ ] `rendered_html` is one blob per page, carries no comment data, and is not invalidated by a permission change
- [ ] A member with `read` but not `comment` receives no indicator, no count, and no evidence that a comment exists
- [ ] A member without read on page X receives no presence event mentioning page X, over a workspace-scoped channel
- [ ] Presence has no write path independent of the lock heartbeat, and stale presence expires visibly
- [ ] A minted comment anchor round-trips byte-identically through the GATE-2 corpus
- [ ] `docs/SPECS.md` §7.2 gains the composite FK and states that presence derives from `page_locks`; §14's read-cache tension is recorded as resolved
- [ ] Every new screen passed the owner's UI review against `docs/UI-CHECKLIST.md` and `docs/DESIGN-SYSTEM.md`
- [ ] `bun run check`, `bun run test`, `bun run typecheck`, `bun run lint` all green
