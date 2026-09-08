# Tasks: Versioning and Collaboration (Phase 3)

> Size note: the `sdd-tasks` skill's 530-word budget is deliberately exceeded, following `design.md`'s own precedent. This change spans ten capability specs, two prerequisite latent-defect fixes, four migrations whose numbers cannot be written here, six owner-gated UI surfaces, and named proof-of-red obligations on four specific tests. Compressing the sequencing, the gate placement and the vacuous-pass warnings to fit a word count would delete the exact facts this file exists to carry forward into `sdd-apply`.

> **Strict TDD.** Every implementation task is a RED (failing test) task followed by a GREEN (implementation) task, numbered as a pair. `bun run test` is the runner. A GREEN task MUST NOT be started until its RED task's failure has been observed for the stated reason — not "file does not exist" or an import error masquerading as the real assertion failing.

> **Migration numbers.** Do not copy a number out of `design.md`'s File Changes table — it says `NNNN` on purpose. Read `packages/db/drizzle/meta/_journal.json` at apply time and take the next unused `idx`/tag on **this branch**. `main` ends at `0007`; `ai-provider-foundation` (unmerged) has already claimed `0008`–`0012`; this branch (`content-and-editor`) currently ends at `0010`. Task text below fixes only migration **names**.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 3500–5500 (10 new/modified capability specs, 4 migrations, `packages/core`+`markdown`+`db`+`api`+`web` all touched, 6 new UI surfaces, property/integration/non-disclosure test suites) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (defect fixes) → PR 2 (core types + schema foundation) → PR 3 (diff engine) → PR 4 (save-time wiring + backfill) → PR 5 (comments) → PR 6 (presence) → PR 7 (route wiring) → PR 8–13 (one PR per gated UI surface) → PR 14 (docs + final verification) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — orchestrator must ask the user; `feature-branch-chain` is suggested because this whole change already stacks on the unmerged `content-and-editor` branch, so a tracker branch for Phase 3 keeps each slice's diff free of Phase 2's own unmerged content |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Fix `pipeline_version` write gap + `env.example` defaults-agreement check | PR 1 | `bun run -F @deep-wiki/db test save-page` / `bun run -F root test env-example` | N/A — pure unit/integration, no external service beyond provisioned test Postgres | Revert two files; no schema change |
| 2 | `packages/core` revision/changeset/comment-anchor/diff types + `PresenceBroadcaster` port | PR 2a | `bun run -F @deep-wiki/core test` | N/A — zero-import types | Delete new files; nothing else references them yet |
| 3 | Split-provenance migration + `mintedIds[].splitFrom` + `upsertActiveBlock` param | PR 2b | `bun run -F @deep-wiki/db test rebuild-derived` | Provisioned test Postgres (`packages/db/testing/provision.ts`) | `down` migration drops the column; code revert is independent |
| 4 | `page_revision` + `changeset` migration, save-page wiring, chain-compression CTE | PR 2c | `bun run -F @deep-wiki/db test save-page changeset` | Provisioned test Postgres, concurrent-transaction test | `down` migrations in reverse; flagged as history-destroying in its own comment |
| 5 | `diffBlocks()` pure engine + `trigramContainment` export | PR 3 | `bun run -F @deep-wiki/markdown test diff-blocks match-blocks` | N/A — pure functions | Delete `diff-blocks.ts`; no persistence coupling |
| 6 | `data-block-id` emission + `pipeline_version`-gated backfill script | PR 4 | `bun run -F @deep-wiki/markdown test render` / `bun run -F @deep-wiki/db test backfill-render` | Provisioned test Postgres for the backfill's concurrency-guard test | Cached HTML is derived; re-render strips the attribute |
| 7 | `comments` migration + reconciliation pass + indicator/creation routes + mentions | PR 5 | `bun run -F @deep-wiki/db test comments` / `bun run -F apps-api test comments` | Provisioned test Postgres, `expect-no-disclosure.ts` harness | `down` migration; routes are additive |
| 8 | `presence` view + broadcaster port impl + SSE route + heartbeat wiring | PR 6 | `bun run -F apps-api test presence` | Provisioned test Postgres; real SSE stream in test, not mocked | View drop is trivial; heartbeat revert restores Phase 2 behaviour |
| 9 | Route mounting (`history`, `diff`, `comments`, `presence`) in `apps/api/src/index.ts` | PR 7 | `bun run -F apps-api test index` | Real Hono app boot | Unmount route factories; no data effect |
| 10–15 | One PR per gated UI surface (history, page diff, book diff, comment gutter+thread, orphan surface, presence indicator) | PR 8–13 | Per-surface Playwright spec named in Phase 10 | Real dev server + Playwright, per `UI-CHECKLIST.md` §7 | Each screen reverts independently; read/edit modes stay functional (proposal Rollback §1) |
| 16 | Docs corrections + `bun run verify` | PR 14 | `bun run verify` | Full local stack | Docs-only revert; no code coupling |

## Phase 1: Latent Defect Fixes (ship before anything that depends on them)

- [x] 1.1 RED: `packages/db/src/content/save-page.test.ts` — assert a saved row's `page_content.pipeline_version` equals `CURRENT_PIPELINE_VERSION` after both an INSERT and an UPDATE save. **Proof-of-red**: this must fail today for the real reason — the column silently returns `1` from `0008_page_content.sql:27`'s `DEFAULT 1`, not from a missing import or a thrown error. Assert against a `CURRENT_PIPELINE_VERSION` value greater than 1 so a vacuous pass against the existing default is impossible.
- [x] 1.2 GREEN: export `CURRENT_PIPELINE_VERSION = 2` from `packages/markdown/src/render.ts` (or an adjacent constants module it re-exports); `packages/db/src/content/save-page.ts` writes it on both the INSERT and UPDATE branches of `savePage()`.
- [x] 1.3 RED: `scripts/checks/env-example.test.ts` (new or extended) — a fixture zod schema key carrying `.default(30)` and a fixture `env.example` line assigning `=99` MUST fail `checkEnvExample`. **Proof-of-red**: today's `checkEnvExample` in `scripts/checks/env-example.ts` contains no comparison of a `.default()` value at all — the test must fail because no such check exists, and the task must record that this fixture would have silently passed before this task, exactly like `PAGE_LOCK_TTL_SECONDS=120` agreeing with `.default(120)` by accident today.
- [x] 1.4 GREEN: `scripts/checks/env-example.ts` gains a defaults-agreement rule — for every `envSchema` key with `.default()`, if `env.example` also assigns a value, parse both and require equality; mismatch is a hard failure with both values named in the error.
- [x] 1.5 Verify `bun run check` still passes unmodified today's real values (`PAGE_LOCK_TTL_SECONDS=120` vs `.default(120)`) — this MUST pass with no fix-up, confirming the design's claim that the rule lands clean.

## Phase 2: Core Domain Types and Ports (`packages/core`)

- [x] 2.1 RED: `packages/core/src/content/revision.test.ts`, `changeset.test.ts`, `comment.test.ts`, `diff.test.ts` — type-level/shape assertions (construction, readonly fields) for `Revision`, `Changeset`, `CommentAnchor`, `BlockDiff`/`BlockChange`.
- [x] 2.2 GREEN: create `packages/core/src/content/{revision,changeset,comment,diff}.ts` — types only, zero imports, per design.md Decision 1 and Decision 2's type split.
- [x] 2.3 RED: `packages/core/src/ports/presence-broadcaster.test.ts` — a fake implementation of the port satisfies its interface contract (publish/subscribe shape).
- [x] 2.4 GREEN: create `packages/core/src/ports/presence-broadcaster.ts` — the `PresenceBroadcaster` port.
- [x] 2.5 Run `bun run -F @deep-wiki/core check` (core-purity) to confirm zero framework/Node-built-in imports across all new files.

## Phase 3: Schema Foundation — Split Provenance, Revisions, Changesets

*Split provenance ships before any comment-anchor work (proposal headline sequencing requirement).*

- [x] 3.1 RED: `packages/db/src/content/rebuild-derived.test.ts` — a generated split (one previous block matches two adjacent next slots) asserts the minted fragment's `page_blocks.split_from` equals the surviving original's id. **Must fail today**: no `split_from` column exists.
- [x] 3.2 GREEN: migration `packages/db/drizzle/NNNN_block_split_provenance.sql` — `ALTER TABLE page_blocks ADD COLUMN split_from text` + composite FK `(page_id, split_from) REFERENCES page_blocks(page_id, block_id)`; update `packages/db/src/schema.ts`.
- [x] 3.3 GREEN: widen `MatchBlocksResult.mintedIds` in `packages/markdown/src/match-blocks.ts` to `Array<{ id: string; slot: number; splitFrom: string }>`, populated from pass 3's `assignment.id` (currently discarded per design.md Decision 1).
- [x] 3.4 GREEN: `upsertActiveBlock()` in `packages/db/src/content/rebuild-derived.ts:101` gains a `splitFrom?: string` parameter, written only on first insert — `ON CONFLICT DO UPDATE` must not touch it once set.
- [x] 3.5 RED: property test over generated split/merge/delete sequences (`packages/db` against provisioned test Postgres) — every `superseded_by` chain resolves to a status `'active'` terminal survivor with no cycle and depth ≤ 64.
- [x] 3.6 GREEN: recursive CTE chain-compression query, run inside the save transaction immediately after `reconcileBlocks` writes its edges (design.md Decision 1, "Chain resolution and compression"). Cycle guard `NOT b.block_id = ANY(c.path)` and `depth < 64` must both fail loudly (thrown error), not loop silently.
- [x] 3.7 RED: `packages/db/src/revisions/*.test.ts` — inserting a `page_revision` with a cross-tenant `(page_id, workspace_id)` or `(changeset_id, workspace_id)` pair is rejected by the FK.
- [x] 3.8 GREEN: migration `packages/db/drizzle/NNNN_page_revisions_and_changesets.sql` — `changeset` (`closed_at`, partial unique index `changeset_open_per_author_idx` on `(workspace_id, book_id, author_id) WHERE closed_at IS NULL`, `UNIQUE (id, workspace_id)`, book-only CHECK), `page_revision` (columns and indexes per design.md Decision 7), `BEFORE UPDATE` immutability trigger on `page_revision` that raises. Update `packages/db/src/schema.ts`.
- [x] 3.9 RED: attempt an `UPDATE` on an existing `page_revision` row in a test and assert it raises.
- [x] 3.10 GREEN: confirm the trigger from 3.8 satisfies 3.9 (no separate implementation task — verifies the migration, not new code).
- [x] 3.11 REFACTOR: extract the chain-compression CTE and the changeset-resolution statements into named functions in `packages/db/src/content/rebuild-derived.ts` / a new `packages/db/src/changesets/resolve-changeset.ts`, keeping `savePage()`'s own transaction body readable per design.md Decision 3's ordering list.

## Phase 4: Block Diff Engine (pure, `packages/markdown`)

- [x] 4.1 RED: `packages/markdown/src/diff-blocks.test.ts` — added/removed/modified/moved classification against hand-built before/after markdown pairs, per design.md Decision 2's classification table.
- [x] 4.2 RED (moved-detection, quality-bar flag): a fixture where **nothing moved** must classify every block `unchanged`, not `moved` — write this assertion explicitly rather than relying on the added/removed fixtures to exercise it, since a trivial no-op diff would pass `moved`-handling code that never actually ran.
- [x] 4.3 RED (determinism, quality-bar flag): call `diffBlocks(before, after)` twice on the same inputs and assert byte-identical output, specifically on a fixture that triggers a split (mints an id). **This must fail before 4.5** because `matchBlocks()` mints split ids via `crypto.getRandomValues` (`match-blocks.ts:81-89`) and a naive `diffBlocks` that reports minted ids verbatim is nondeterministic across runs.
- [x] 4.4 RED: a fully unanchored document (`sliceBlocks` returns records with no `anchorId`) still diffs correctly end to end — this fixture must fail against any implementation that reads `page_revision.block_index` instead of re-parsing.
- [x] 4.5 GREEN: `packages/markdown/src/diff-blocks.ts` — `diffBlocks(before, after)`, calling `sliceBlocks(parse(...))` fresh on both sides and `matchBlocks()`, per design.md Decision 2. Discards `mintedIds[].id` entirely and reports `after`'s own `sliceBlocks` id at that slot; keeps only `mintedIds[].splitFrom`.
- [x] 4.6 GREEN: add `"@deep-wiki/core": "workspace:*"` to `packages/markdown/package.json`, importing `BlockDiff`/`BlockChange` type-only from `packages/core/src/content/diff.ts`.
- [x] 4.7 RED: `packages/markdown/src/match-blocks.test.ts` — `trigramContainment(a, b)` boundary behaviour exactly at 0.8 (0.79 fails, 0.80 passes, asymmetric under argument swap).
- [x] 4.8 GREEN: export `trigramContainment()` and `ANCHOR_CONTAINMENT_THRESHOLD = 0.8` from `packages/markdown/src/match-blocks.ts`.
- [x] 4.9 RED: the diff engine is called between non-adjacent revisions (revision 1 vs revision 5 content) directly, not composed from intermediate diffs — assert the direct result differs from a naive intermediate composition where they would disagree.
- [x] 4.10 Structural check: grep-style assertion (add to `scripts/checks/`) that no file under `packages/markdown/src/diff-blocks.ts` or any caller references `block_index`.
- [x] 4.11 REFACTOR: once 4.1–4.9 are green, review `diffBlocks()` for duplicate slot-matching logic against `matchBlocks()` itself and extract any shared classification helper.

## Phase 5: Save-Time Wiring — Changeset Resolution, Revision Insert

- [x] 5.1 RED: `packages/db/src/content/save-page.test.ts` — a successful save produces exactly one new `page_revision` row with the current `content_hash`; a save that fails (e.g., stale `content_hash`) writes neither `page_content` nor `page_revision`.
- [x] 5.2 GREEN: wire `page_revision` INSERT and `resolveChangeset()` call into `savePage()`'s transaction (`packages/db/src/content/save-page.ts`), ordered per design.md Decision 3.
- [x] 5.3 RED (concurrency, quality-bar flag): two **genuinely concurrent** transactions — same author, same book, two different pages, both racing the changeset window query at the database level (use two real overlapping transactions against the provisioned test Postgres, not two sequential calls) — must resolve to exactly one `changeset` row. **Prove the race actually happens**: assert both transactions' window queries observe zero existing rows before either commits (e.g., via a `pg_sleep` or an explicit barrier), otherwise the test proves nothing about `changeset_open_per_author_idx`.
- [x] 5.4 GREEN: `resolveChangeset()` — the two-statement window-retirement + `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING id` sequence from design.md Decision 3.
- [x] 5.5 RED: two saves by different authors in the same book within the window never share a changeset, even though both fall inside `CHANGESET_WINDOW_MINUTES`.
- [x] 5.6 GREEN: confirm 5.4's per-author partial index satisfies 5.5 (verification task, no new code expected).
- [x] 5.7 GREEN: add `CHANGESET_WINDOW_MINUTES: z.coerce.number().int().positive()` (no `.default()`) to `packages/contracts/src/env.ts`; add `CHANGESET_WINDOW_MINUTES=30` to `env.example` as the only place the number exists.
- [x] 5.8 GREEN: thread `changesetWindowMinutes` from `loadConfig()` through route deps to `savePage()`, mirroring `PAGE_LOCK_TTL_SECONDS`'s propagation path exactly.
- [x] 5.9 Run `bun run check` to confirm `env-example.ts`'s presence check (unaffected — no default exists for this key) and Phase 1's new defaults-agreement rule both pass.

## Phase 6: Render Format Change and Backfill

*Sequenced after Phase 1 (pipeline_version must be truthful before staleness detection means anything) and before comment-overlay work.*

- [x] 6.1 RED: `packages/markdown/src/render.test.ts` — `render()` output for a document with an anchored block carries `data-block-id="<id>"` on the corresponding element, and an unanchored block carries none.
- [x] 6.2 GREEN: `render.ts` — the `hProperties` transform over `tree.children` from design.md Decision 6, applied before `remark-rehype`.
- [x] 6.3 RED: the same fixture's `data-block-id` attribute **survives `rehypeSanitize`** — assert it is still present post-sanitisation, not merely present in the pre-sanitised hast tree.
- [x] 6.4 GREEN: add `dataBlockId` to `SANITIZE_SCHEMA.attributes['*']` in `packages/markdown/src/render.ts:18-31`.
- [x] 6.5 RED: GATE-2 corpus round-trip test — serialising the tree that received the `hProperties` mutation must be byte-identical to serialising the same markdown through the existing pipeline (i.e., the transform must never touch the tree `reconcileDerived` receives).
- [x] 6.6 GREEN: confirm `render()` parses its own tree (`render.ts:123`) separately from `savePage`'s tree, and that `data.hProperties` is ignored by `remark-stringify`. No production code change expected if isolation already holds; if it does not, isolate the transform to `render()`'s own local tree.
- [x] 6.7 RED: `packages/db/src/content/backfill-render.test.ts` — a stale row (`pipeline_version < CURRENT_PIPELINE_VERSION`) is re-rendered and its `pipeline_version` updated; a row saved concurrently during the backfill (content_hash changed after the backfill read it) is skipped, not clobbered.
- [x] 6.8 GREEN: `packages/db/src/content/backfill-render.ts` — batched (200 rows), resumable, `content_hash`-guarded re-render, plus a `backfill:render` script entry.
- [ ] 6.9 Manual/documented check: a pre-backfill page missing `data-block-id` degrades to "no anchors known" in the orphan surface (Phase 10), never an error — cross-reference in Phase 10's orphan-surface task.

## Phase 7: Comments — Schema, Reconciliation, Overlay, Mentions

*Depends on Phase 3 (split provenance) and Phase 6 (`data-block-id`, backfill).*

- [ ] 7.1 RED: `packages/db/src/comments/*.test.ts` — a comment insert with a cross-tenant `(page_id, block_id)` reference is rejected by the FK.
- [ ] 7.2 GREEN: migration `packages/db/drizzle/NNNN_comments.sql` — `comments` table, threads, resolution state, anchor columns (`block_id`, `offset_start`, `offset_end`, `quote`, `quote_hash`, `status`), `(page_id, block_id)` FK. Update `packages/db/src/schema.ts`.
- [ ] 7.3 RED (orphan-vs-migrate, quality-bar flag, five sub-cases): for each block transition in design.md Decision 1's confidence table (unchanged, modified-in-place, exact-substring-elsewhere, multiple-occurrence, no-exact-match), write one fixture and assert the specified outcome. **For the no-exact-match/containment case specifically**: build the fixture so the best-scoring candidate's `trigramContainment` score is deliberately **below 0.8** (e.g., 0.6–0.75), and assert it orphans — a fixture whose top score happens to clear 0.8 would take the "migrate" path for the right reason but tell you nothing about the orphan branch; a second fixture must independently confirm a score just above 0.8 migrates.
- [ ] 7.4 GREEN: `reconcileComments()` in `packages/db/src/content/rebuild-derived.ts` (or a new `packages/db/src/comments/reconcile-comments.ts`) — consumes `reconcileBlocks`'s returned `{ assignments, mintedIds, nextBlocks }` (change `reconcileBlocks` to return this rather than `void`); implements the confidence table exactly, checking `trigramContainment` over `B'` **and** every block whose `split_from = B'`.
- [ ] 7.5 RED: an orphaned comment is never re-anchored by a later save, even if a subsequent edit would now score above threshold.
- [ ] 7.6 GREEN: confirm 7.4's orphan status is a one-way write (no code path transitions `orphaned` back to `anchored`); add the guard if reconciliation is written generically enough to need one.
- [ ] 7.7 RED: `apps/api/testing/expect-no-disclosure.ts`-based test — a subject with `read` but not `comment` receives no comment id, text, author, or count; the response is indistinguishable from a page with zero comments.
- [ ] 7.8 GREEN: `apps/api/src/routes/comments.ts` — indicator/count endpoint gated by `can('comment')`, comment creation endpoint, all behind `can()`.
- [ ] 7.9 RED: a comment on an unanchored block, once created, mints and persists an anchor into canonical markdown that round-trips byte-identically through the GATE-2 corpus.
- [ ] 7.10 GREEN: anchor-minting path in the comment-creation route/service, reusing the lazy-assignment mechanism already covered by the GATE-2 corpus.
- [ ] 7.11 RED: mention notification test — a mentioned user without `read` on the page receives no notification; no credential/hash/token is logged or rendered.
- [ ] 7.12 GREEN: wire mention notifications through the existing `MailSender` port.
- [ ] 7.13 REFACTOR: once 7.3–7.10 are green, consolidate the five confidence-table branches into one clearly named function per branch if `reconcileComments()` has grown past a single readable unit.

## Phase 8: Editing Presence

*The view has no migration prerequisite of its own; sequence its creation only after confirming Phase 2–7 changes left `page_locks` untouched.*

- [ ] 8.1 Verify `packages/db/src/locks/page-lock.ts` and `page_locks`' schema are unmodified by every prior phase (diff review against Phase 2 base) before proceeding — this is the "untouched-and-verified" gate the design requires before the view can safely assume the lock table's shape.
- [ ] 8.2 GREEN: migration `packages/db/drizzle/NNNN_presence_view.sql` — `CREATE VIEW presence AS SELECT ... FROM page_locks` per design.md Decision 5. No RED test precedes a pure view definition; its correctness is proven by 8.4–8.7 below.
- [ ] 8.3 GREEN: `apps/api/src/presence/broadcaster.ts` — in-memory `Map<workspaceId, Set<Subscriber>>` implementation of the `PresenceBroadcaster` port from Phase 2.
- [ ] 8.4 RED (non-disclosure, quality-bar flag — the highest-risk requirement in this change): a workspace member without `read` on page X receives **no event mentioning page X**, not even a page id with the title omitted. Build the fixture as a genuine **workspace-scoped fan-out** (broadcast to every workspace subscriber, then filter) so the test actually exercises per-subscriber filtering rather than a channel that was never workspace-wide to begin with; assert the id field is absent from the serialised frame, not merely that the title is absent — a test that only checks the title would pass against an implementation that still leaks the id.
- [ ] 8.5 GREEN: `apps/api/src/routes/presence.ts` — `GET /workspaces/:workspaceId/presence/stream`, `sessionMiddleware` then membership check to open the stream, then per-event `can(user, event.pageId, 'read')` before emitting, silently dropping otherwise.
- [ ] 8.6 RED: heartbeat route test — `PATCH /pages/:id/lock` refreshing the lock also publishes to the broadcaster in the same request; assert no other code path calls the broadcaster's publish method (structural/grep-style check).
- [ ] 8.7 GREEN: wire `heartbeatLock`'s success path in `page-lock.ts` to call `broadcaster.publish(...)`.
- [ ] 8.8 RED: the SSE route also polls the `presence` view on each keep-alive tick and emits presence not yet sent for that connection (multi-process degradation path from design.md Decision 5).
- [ ] 8.9 GREEN: keep-alive tick handler in `presence.ts` — poll `presence` view, diff against already-sent state per connection.
- [ ] 8.10 RED: `apps/api/src/index.test.ts` — the presence stream endpoint answers with `Access-Control-Allow-Origin`, proving it was registered via `app.route(...)` after `createApp()`'s CORS middleware, never at module scope (the `/health` failure mode from `index.ts:19-35`).
- [ ] 8.11 GREEN: mount `createPresenceRoutes(deps)` via `app.route('/', ...)` in `index.ts`'s `import.meta.main` block.
- [ ] 8.12 RED: stale presence (heartbeat past `PAGE_LOCK_TTL_SECONDS`) reports no active presence, with no separate presence TTL anywhere in the code.

## Phase 9: Remaining Route Wiring

- [ ] 9.1 RED: `GET /pages/:id/history` returns revisions newest-first, gated by `can('read')`.
- [ ] 9.2 GREEN: `apps/api/src/routes/revisions.ts`.
- [ ] 9.3 RED: `GET /pages/:id/diff?from=&to=` loads two `page_revision.content` values and calls `diffBlocks()`, gated by `can('read')`; a book-level `GET .../diff?since=` aggregates changed pages from changesets.
- [ ] 9.4 GREEN: `apps/api/src/routes/diff.ts`.
- [ ] 9.5 Mount `revisions.ts` and `diff.ts` in `apps/api/src/index.ts` alongside Phase 8's presence and Phase 7's comments routes; re-run 8.10's CORS-registration pattern check against all four.

## Phase 10: UI Screens — One Owner-Review Gate Per Surface

*`docs/UI-CHECKLIST.md` §1: no screen is done until the owner reviews it, and work does not continue on top of an unreviewed screen. Each surface below gets its own gate — they are not batched.*

- [ ] 10.1 Build page history screen (revision list) per `UI-CHECKLIST.md` §2–§6; write and pass its happy-path e2e (§7).
- [ ] 10.2 **STOP — owner review gate 1/6: page history.** Do not start 10.3 until the owner has reviewed and passed this screen against `UI-CHECKLIST.md` and `DESIGN-SYSTEM.md`.
- [ ] 10.3 Build page-level diff view (added/removed/**modified**/**moved** distinctly treated, §4.7); write and pass its happy-path and permission-denied e2e.
- [ ] 10.4 **STOP — owner review gate 2/6: page diff view.**
- [ ] 10.5 Build book-level changeset history + book diff, navigable between changed pages without returning to a list (§4.7); e2e coverage per §7.
- [ ] 10.6 **STOP — owner review gate 3/6: book changeset history and diff.**
- [ ] 10.7 Build the comment gutter + thread panel on the read screen (anchored-indicator display, reply, resolve), composed client-side over unchanged cached HTML per design.md Decision 5; e2e coverage including the permission-denied case (comment-indicator absent for `read`-only).
- [ ] 10.8 **STOP — owner review gate 4/6: comment gutter and thread panel.**
- [ ] 10.9 Build the orphaned-comment surface as a first-class state (§4.7) — never a crash, never a silent vanish; wire the "no anchors known" degradation from Phase 6.9 into this surface explicitly.
- [ ] 10.10 **STOP — owner review gate 5/6: orphaned-comment surface.**
- [ ] 10.11 Build presence indicators on read and edit screens (who + since when, expires visibly, never reads as a hard lock, §4.8); e2e coverage per §7 including the soft-lock-path scenario.
- [ ] 10.12 **STOP — owner review gate 6/6: presence indicators.**

## Phase 11: Documentation and Final Verification

- [ ] 11.1 `docs/SPECS.md` §7.2 — correct "there is no separate lock table: an `editing` presence row *is* the lock" to state the inverse (design.md Decision 5); add the composite FK the proposal flagged as missing.
- [ ] 11.2 `docs/SPECS.md` §14 — record the read-cache/per-viewer-permission tension as resolved, citing this change's overlay decision. **Verify §14 actually exists on this branch's copy of the file before editing it** — the proposal notes it is present on `main` (commit `cc8c700`) but absent from this branch's `docs/SPECS.md`; do not assume the section to edit exists.
- [ ] 11.3 `docs/TODO.md` — append (never delete) Findings for: the orphan-rate instrumentation follow-up, the `page_revision` retention Open Question, and the migration-base collision risk against `ai-provider-foundation`.
- [ ] 11.4 Run `bun run check`, `bun run typecheck`, `bun run lint`, `bun run test`, then `bun run verify` end to end.
- [ ] 11.5 Confirm every Success Criteria checkbox in `proposal.md` against the shipped behaviour before declaring the change complete.
