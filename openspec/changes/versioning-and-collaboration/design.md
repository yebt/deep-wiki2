# Design: Versioning and Collaboration (Phase 3)

> Size note: the `sdd-design` skill's 800-word budget is deliberately exceeded. The orchestrator named seven decisions that must be *closed* here, each with its rejected alternative and reversal condition (`docs/SPECS.md` §14 convention). Compressing them to fit would leave the same fact to be re-derived — and re-decided differently — during `sdd-apply`.

## Technical Approach

Four subsystems, layered as the proposal sequences them: schema and provenance, then the pure diff engine, then comments, then presence, then UI. Placement follows the hexagon the repository already enforces.

| Layer | Package | What lands there | Why not elsewhere |
|---|---|---|---|
| Domain shapes | `packages/core/src/content/` | `Revision`, `Changeset`, `CommentAnchor`, `BlockDiff` types; the `PresenceBroadcaster` port | Zero framework imports, machine-enforced by `scripts/checks/core-purity.ts` |
| Algorithms over markdown | `packages/markdown/src/` | `diffBlocks()`, `trigramContainment()`, split-origin on `matchBlocks()`, `data-block-id` emission | These call `parse()`/`sliceBlocks()` and `node:crypto`; none can live in `core` |
| Persistence | `packages/db/src/` | `page_revision`, `changeset`, `comments`, split provenance, chain compression, comment reconciliation | `savePage`'s transaction already owns this boundary |
| Transport | `apps/api/src/routes/` | history, diff, comment, comment-indicator, presence SSE | All behind `can()` |

Nothing in this change introduces a second markdown pipeline. `diffBlocks()` and the `data-block-id` transform both call the existing `parse()` from `packages/markdown/src/pipeline.ts` — the sole pipeline owner per `scripts/checks/single-parser.ts`.

---

## Decision 1 — The comment anchor mechanism

### The anchor record

```ts
// packages/core/src/content/comment.ts — types only, no imports
export interface CommentAnchor {
  readonly blockId: BlockId;
  /** Character offsets into the block's canonical source text at creation. */
  readonly offsetStart: number;
  readonly offsetEnd: number;
  /** The exact text the comment was written about. Captured once, never rewritten. */
  readonly quote: string;
  readonly quoteHash: string;
  readonly status: 'anchored' | 'orphaned';
}
```

`quote` is the load-bearing field, not the offsets. Offsets are a fast path; the quote is what survives.

### Split provenance

`page_blocks` gains one nullable column:

```sql
ALTER TABLE "page_blocks" ADD COLUMN "split_from" text;
ALTER TABLE "page_blocks" ADD CONSTRAINT "page_blocks_split_from_fk"
  FOREIGN KEY ("page_id", "split_from") REFERENCES "page_blocks" ("page_id", "block_id");
```

`matchBlocks()`' pass 3 already knows the origin — the minted id exists *because* `assignment.id` claimed an adjacent slot. It is discarded today. Widen the result:

```ts
mintedIds: Array<{ id: string; slot: number; splitFrom: string }>;
```

`upsertActiveBlock()` in `rebuild-derived.ts:101` gains a `splitFrom` parameter, written only on first insert (a block's origin is a fact about its birth; `ON CONFLICT DO UPDATE` must not touch it).

### Chain resolution and compression

`superseded_by` is rewritten to the **terminal** survivor at save time, inside the transaction, immediately after `reconcileBlocks` writes its edges:

```sql
WITH RECURSIVE chain(block_id, target, depth, path) AS (
  SELECT block_id, superseded_by, 0, ARRAY[block_id]
    FROM page_blocks WHERE page_id = $1 AND superseded_by IS NOT NULL
  UNION ALL
  SELECT c.block_id, b.superseded_by, c.depth + 1, c.path || b.block_id
    FROM chain c JOIN page_blocks b ON b.page_id = $1 AND b.block_id = c.target
   WHERE b.superseded_by IS NOT NULL AND c.depth < 64 AND NOT b.block_id = ANY(c.path)
)
UPDATE page_blocks p SET superseded_by = terminal.target ...
```

`NOT b.block_id = ANY(c.path)` is the cycle guard and `depth < 64` the runaway guard; a chain that hits either is a bug and must fail loudly, not loop. Compression at **save** time, never at read time — `page-lock.ts:6` establishes "a read never writes" and this design does not break it. Steady-state chain depth is therefore 1, and the recursive walk is a safety net rather than the hot path.

### The confidence rule

Reconciliation runs as a third step inside `reconcileDerived`, after `reconcileBlocks`, consuming that function's `MatchBlocksResult` rather than recomputing it. `reconcileBlocks` is changed to *return* `{ assignments, mintedIds, nextBlocks }`; `reconcileDerived` threads it into `reconcileComments`. Matching the document twice would be the same fact computed in two places.

For each comment on block `B`:

| Situation | Outcome |
|---|---|
| `B` resolves through the chain to `B'` that is `tombstoned` | **Orphan** |
| Quote is an exact substring of `B'`'s new text at the stored offset | Migrate, offsets unchanged |
| Quote is an exact substring elsewhere, exactly once | Migrate to that index |
| Quote occurs more than once | Migrate to the occurrence nearest the old offset |
| No exact match: score `trigramContainment(quote, candidate)` over `B'` **and** every block whose `split_from = B'` | Highest score ≥ **0.8** wins and the comment migrates with offsets recomputed from the best window; anything else, including a tie at the top, **orphans** |

`trigramContainment(a, b) = |trigrams(a) ∩ trigrams(b)| / |trigrams(a)|` — asymmetric, unlike the Dice coefficient `matchBlocks()` uses. Dice penalises size asymmetry, so a two-sentence quote inside a long paragraph scores low no matter how intact it is; containment asks the question actually being asked: *is my quote still in there?*

**Threshold: 0.8, and it is deliberately stricter than τ=0.5.** τ=0.5 decides which block keeps an identifier — a wrong answer there still yields *a block*, and the block registry's own excerpt makes the mistake visible. The anchor threshold decides whether a person's words are re-attached to text they did not write about, which is the single failure `docs/UI-CHECKLIST.md:143` forbids outright. At 0.8 a quote must retain four of every five trigrams. The bias is the same as τ=0.5's; the magnitude is larger because the cost of being wrong is larger.

Orphaning is one-way: an orphaned comment is never re-anchored by a later save. Re-anchoring is precisely the misattribution risk, arriving later and with less evidence.

| | |
|---|---|
| **Rejected** | Dice similarity reused unchanged from `matchBlocks()`; offset-only migration with no quote; auto-migrate on any positive score |
| **Reverses it** | A measured orphan rate from real edit traffic, recorded as a Finding, the same way τ=0.5's reversal criterion is stated in `match-blocks.ts:29-38` |

---

## Decision 2 — Where the diff lives

**`packages/markdown/src/diff-blocks.ts`.** The result *types* live in `packages/core/src/content/diff.ts`.

`core` cannot host the algorithm, and this is structural rather than stylistic:

- `matchBlocks()` transitively imports `node:crypto` (`deriveBlockId`, `match-blocks.ts:1,99`). `core-purity.ts` forbids Node built-ins in `core` outright.
- `sliceBlocks()` needs an mdast `Root` from `parse()` — unified/remark, a framework import, and `core`'s own D19 already states "no mdast type ever crosses into `packages/core`" (`packages/core/src/content/types.ts:5`).
- A `core` diff would have to accept pre-sliced, pre-matched input. That relocates the diff-input rule — *call `matchBlocks()` fresh over `sliceBlocks(revision.content)`, never read the stored `block_index`* — out of the module that owns it and into every caller. The proposal's own risk register names reading `block_index` as the seductive wrong implementation; putting the rule and the code in one module is what makes the rule testable.

`packages/markdown` gains `"@deep-wiki/core": "workspace:*"`, importing the result types type-only. Precedent: `packages/contracts/src/env.ts:1` already imports `@deep-wiki/core`. Core has zero runtime dependencies by machine enforcement, so the layering cannot invert.

### Signature and semantics

```ts
export function diffBlocks(before: string, after: string): BlockDiff;
// BlockDiff = { changes: readonly BlockChange[] }
// BlockChange =
//   | { kind: 'added';     id: BlockId; slot: number; splitFrom?: BlockId }
//   | { kind: 'removed';   id: BlockId; slot: number; mergedInto?: BlockId }
//   | { kind: 'modified';  id: BlockId; fromSlot: number; toSlot: number; moved: boolean }
//   | { kind: 'moved';     id: BlockId; fromSlot: number; toSlot: number }
//   | { kind: 'unchanged'; id: BlockId; slot: number }
```

Internally: `sliceBlocks(parse(before), before)` → `PersistedBlockRecord[]`, `sliceBlocks(parse(after), after)` → `string[]`, then `matchBlocks()`. Classification from the result: `active` + identical text + same index → `unchanged`; `active` + identical text + different index → `moved`; `active` + differing text → `modified` (carrying `moved` as a flag so the UI can show both); `tombstoned` → `removed`; `superseded` → `removed` with `mergedInto`; any slot in `after` no active assignment claimed → `added`.

**Gotcha that must be handled, not discovered:** `matchBlocks()` mints split ids with `crypto.getRandomValues` (`match-blocks.ts:81-89`), so the same diff computed twice returns different minted ids. `diffBlocks` therefore **discards `mintedIds`' identifiers entirely** and reports `after`'s own `sliceBlocks` id at that slot — deterministic in both the anchored and derived cases. It keeps only `mintedIds[].splitFrom`, which is stable. A golden test computes the same diff twice and asserts byte-identical output.

| | |
|---|---|
| **Rejected** | The algorithm in `core` (impossible under core-purity without gutting it); a line differ (destroys "moved", explicitly forbidden by the roadmap); reading `page_revision.block_index` (anchor-only subset — a fully unanchored document would diff to nothing) |
| **Reverses it** | Nothing foreseeable. It would take `matchBlocks()` becoming crypto-free *and* mdast leaving the input type |

---

## Decision 3 — The save transaction

One transaction, the existing `sql.begin()` in `save-page.ts:61`. Ordering inside it:

```
BEGIN
 ├ page_content INSERT | (SELECT … FOR UPDATE, UPDATE guarded by content_hash)   [unchanged]
 ├ resolveBookId(nodeId)                       — recursive ancestor walk to the owning book
 ├ resolveChangeset(book, author, window)      — two statements, below
 ├ INSERT page_revision                        — immutable snapshot, FK to the changeset
 └ reconcileDerived → links, tags, blocks, comments, chain compression
COMMIT
```

The revision write stays **inside** the transaction. Outside it, a committed content write can be followed by a failed revision insert, and a version is lost permanently — `page_revision` is the one artefact this change creates that cannot be regenerated (proposal, Rollback §5).

### The changeset race

Two saves by the same author, in the same book, on two *different* pages, concurrently. They share no row lock: `page_content`'s `FOR UPDATE` is per page. Both would run a window query, both find nothing, both insert. Two changesets that should have been one.

This is resolved by a constraint, not by lock ordering or a retry loop:

```sql
CREATE UNIQUE INDEX "changeset_open_per_author_idx"
  ON "changeset" ("workspace_id", "book_id", "author_id") WHERE "closed_at" IS NULL;
```

```sql
-- 1. Retire the open changeset if its window has lapsed. Idempotent; both
--    concurrent savers compute the same outcome.
UPDATE changeset SET closed_at = last_activity_at
 WHERE workspace_id = $ws AND book_id = $book AND author_id = $author
   AND closed_at IS NULL
   AND last_activity_at <= now() - ($window || ' minutes')::interval;

-- 2. Join the open changeset or open a new one. Atomic.
INSERT INTO changeset (id, workspace_id, book_id, author_id, last_activity_at)
VALUES (gen_random_uuid(), $ws, $book, $author, now())
ON CONFLICT (workspace_id, book_id, author_id) WHERE closed_at IS NULL
DO UPDATE SET last_activity_at = now()
RETURNING id;
```

Statement 2 is the whole answer. The loser of a genuine concurrent insert blocks on the partial unique index until the winner commits, then its `DO UPDATE` fires and it receives the **winner's** id. Two saves, one changeset, guaranteed by the database rather than by timing. `closed_at` is set on retirement only and is never a second copy of the window — it stores *when activity stopped*, and whether that is inside the window is computed at read time from the one constant, exactly as `readLockStatus` computes lock expiry (`page-lock.ts:140-149`).

Cost: three added statements on the hottest write path. Acceptable because saving is an explicit click — `apps/web/app/composables/useSavePage.ts`, no autosave anywhere in the repository — so this is per-click, not per-keystroke.

| | |
|---|---|
| **Rejected** | Fixed 30-minute epoch buckets as a unique key (race-free but changes the semantics: two saves one minute apart across a boundary split); advisory locks on `(book, author)` (serialises saves across an entire book); queueing the revision write outside the transaction (loses history on failure) |
| **Reverses it** | Measured contention on `changeset_open_per_author_idx`, which would push grouping to a background reconciler |

---

## Decision 4 — The 30-minute window as a single-source constant

**`CHANGESET_WINDOW_MINUTES` is declared in `packages/contracts/src/env.ts` with no `.default()`.**

```ts
// The implicit changeset grouping window. Deliberately has NO zod default:
// the number lives in env.example and nowhere else, so a second copy is
// not merely discouraged — there is no second place to put it.
CHANGESET_WINDOW_MINUTES: z.coerce.number().int().positive(),
```

That is the mechanism, and it is why this is not just the house pattern restated. `scripts/checks/env-example.ts:51` reads `Object.keys(envSchema.shape)` and fails `bun run check` when a declared key is missing from `env.example` — so the key is guaranteed present. Because the schema carries no default, the *value* exists exactly once, in `env.example`. A missing value fails at boot (`parseEnv`), loudly, rather than falling back to a stale duplicate. Precedent: `PORT` and `DATABASE_URL` are already required-without-default.

Propagation follows `PAGE_LOCK_TTL_SECONDS` exactly: `loadConfig()` → route deps → `savePage({ changesetWindowMinutes })`. `packages/db` never reads env. No stored row encodes the window, so changing it is a config edit.

**A second, cheap mechanism is included because the first only covers new variables.** `scripts/checks/env-example.ts` gains a defaults-agreement rule: for every schema key that *does* carry `.default()`, if `env.example` also assigns a value, the two must parse equal. This passes today (`PAGE_LOCK_TTL_SECONDS=120` agrees with `.default(120)`), which is exactly why it can be added without a fix-up — and it closes the residual gap where `120` currently lives in two files with nothing comparing them. That gap is the same shape as the four Findings recorded on 2026-09-04 through 2026-09-06 (`docs/TODO.md:563-566, 695-698, 724-728`). Retrofitting `PAGE_LOCK_*` to the no-default form is **out of scope**; the check is what makes the duplicate safe.

| | |
|---|---|
| **Rejected** | `.default(30)` plus a matching `env.example` value (two copies; the exact named defect); a hard-coded constant in `packages/db` (invisible to `env.example`'s check entirely); a `window_minutes` column on `changeset` (a per-row copy, so changing the constant would leave history disagreeing with itself) |
| **Reverses it** | A requirement for per-workspace window configuration, which moves the value to `workspace_settings` and makes the env variable the default rather than the value |

---

## Decision 5 — Presence and SSE

### Presence is a view, not a table

Decision 3 of the proposal says presence derives from the lock heartbeat. Carried to its conclusion, presence needs no rows of its own:

```sql
CREATE VIEW "presence" AS
  SELECT node_id AS page_id, workspace_id, holder_user_id AS user_id,
         acquired_at AS since, heartbeat_at, 'editing'::text AS mode
    FROM page_locks;
```

TTL is evaluated on read, exactly as `readLockStatus` does — no expiry column, no sweeper, no second TTL. The proposal's spec defect ("`presence` has `workspace_id` but no composite foreign key") is closed in the strongest available form: a view has no rows to be cross-tenant, and it inherits `page_locks_page_fk (node_id, workspace_id) → page_content (node_id, workspace_id)` from `0010_page_locks.sql:15-16` structurally.

This also answers the proposal's open sub-question. **No `presence_mode` enum is created.** The SSE payload carries `mode: 'editing'` as a zod literal in `packages/contracts`. Adding `viewing` later is a migration that creates a real table, because a viewer has no lock to derive from — and at that point the second-heartbeat question genuinely reopens and must be decided then, on the read-path cost evidence SPECS §5.3 demands.

SPECS §7.2's sentence inverts with the same two nouns: it currently says "there is no separate lock table: an `editing` presence row *is* the lock". The correction is "there is no separate presence table: the lock row *is* the editing presence."

### Where the endpoint lives and how it is mounted

`apps/api/src/routes/presence.ts`, exporting `createPresenceRoutes(deps)`, mounted with `app.route('/', …)` in `index.ts`'s `import.meta.main` block alongside the other route factories.

`app.use()` in Hono applies only to routes registered after it. `createApp()` installs the CORS middleware at `index.ts:39` *before returning*, and every `app.route(...)` call happens after `createApp()` returns — so any route registered through a factory is covered. The rule the SSE route must not break: **it is never registered at module scope**, which is exactly how `/health` shipped outside CORS (`index.ts:19-35`). A test asserts the stream endpoint answers with `Access-Control-Allow-Origin`.

`GET /workspaces/:workspaceId/presence/stream`, `sessionMiddleware` first, then a workspace-membership check to open the stream at all.

### Per-event authorisation

Membership opens the stream. It does **not** authorise a single event. For each candidate event the subscriber's writer calls, at that moment:

```ts
const authorized = await can(deps.sql, {
  subjectType: 'user', subjectId: session.userId,
  resourceId: event.pageId, action: 'read',
});
if (!authorized) continue;   // silently dropped — no "hidden event" signal either
```

No connect-time ACL snapshot, no memoised decision, no TTL cache. A permission revoked mid-stream takes effect on the next event because the next event re-asks. Load arithmetic, stated so the tradeoff is falsifiable: presence events are heartbeat-rate, one per editor per `PAGE_LOCK_HEARTBEAT_SECONDS` (20s). Fifty concurrent editors fanned to two hundred subscribers is 10 000 `can()` calls per 20s — 500/s of recursive-CTE resolution, worst case, at a scale far above any plausible self-hosted deployment. If that becomes real, the correct lever is **coalescing events** (one per page per interval), never reusing a decision. Caching an authorisation decision is the thing that must be justified; evaluating it is the default.

The unauthorised subject sees no event, no count, no heartbeat difference. Tested with `apps/api/testing/expect-no-disclosure.ts` against the serialised SSE frame.

### Termination

| Trigger | Behaviour |
|---|---|
| Client disconnect | `streamSSE`'s abort signal unregisters the subscriber from the broadcaster |
| Dead peer | Keep-alive comment frame every `PAGE_LOCK_HEARTBEAT_SECONDS`; a failed write closes the stream |
| Session lapse | Session idle timeout re-evaluated on each keep-alive tick; a lapsed session closes the stream |
| Absolute cap | Closed after `SESSION_IDLE_TIMEOUT_MINUTES`; `EventSource` reconnects on its own. No new constant |

### Multiple API processes

**This design assumes a single API process** — and is built so that assumption is a latency property rather than a correctness one.

The broadcaster is `apps/api/src/presence/broadcaster.ts`, an in-memory `Map<workspaceId, Set<Subscriber>>` behind a `PresenceBroadcaster` port in `packages/core/src/ports/`. The heartbeat route (`PATCH /pages/:id/lock`) publishes to it after `heartbeatLock` succeeds — no second client loop, no write path independent of the lock.

An in-memory broadcaster with two processes fails **silently**: an editor on process A is invisible to a subscriber on process B, and nothing errors. So the durable truth is not the broadcaster — it is `page_locks`, which is already in Postgres. **The SSE route also polls the `presence` view on each keep-alive tick** (a read, no write, one indexed query per subscriber per 20s) and emits any presence it has not already sent for that connection. Correctness therefore does not depend on the broadcaster at all: with N processes the system degrades to ≤20s of extra latency, never to silence. No sticky sessions are required.

Swapping the in-memory broadcaster for Postgres `LISTEN/NOTIFY` or Redis then becomes a latency change behind an unchanged port, not a correctness fix.

| | |
|---|---|
| **Rejected** | A real `presence` table with its own heartbeat (two TTLs for one fact — the named recurring defect, and forbidden by proposal decision 3); connect-time permission snapshot (a revocation never takes effect); broadcaster-only fan-out (silent failure at two processes); workspace-membership-only event gating (leaks page existence — the proposal's highest-likelihood risk) |
| **Reverses it** | Measured poll cost at scale, which moves the fallback to `LISTEN/NOTIFY` behind the same port; a `viewing` presence requirement, which forces a real table |

---

## Decision 6 — `data-block-id` and its backfill

### Emission

`blockAnchorHandler` (`render.ts:89`) keeps rendering nothing — it is inline content inside a paragraph and cannot set an attribute on its parent. The attribute is applied one level up, in mdast, before `remark-rehype`:

```ts
// packages/markdown/src/render.ts — a transform over root children only.
// mdast-util-to-hast honours node.data.hProperties, so no positional
// mdast→hast mapping is needed and no second pipeline is constructed.
for (const child of tree.children) {
  const anchor = findBlockAnchor(child);
  if (anchor) child.data = { ...child.data, hProperties: { ...child.data?.hProperties, 'data-block-id': anchor.id } };
}
```

Two consequences that must be tested rather than assumed:

1. `SANITIZE_SCHEMA` strips unknown attributes. `attributes['*']` must gain `dataBlockId`, with a test asserting the attribute **survives sanitisation** — a silently stripped attribute is the failure mode here.
2. The transform mutates its tree. `render()` parses its own tree (`render.ts:123`), separate from the one `savePage` passes to `reconcileDerived` — the transform must stay inside `render()` and never touch a shared tree. `data.hProperties` is ignored by `remark-stringify`, so serialisation is unaffected: GATE-2 round-trip is untouched, which is the requirement the proposal states.

### Staleness detection and backfill

`page_content` already carries `pipeline_version` and `content_hash`. Both are used; nothing parallel is invented.

**Prerequisite — a latent bug this change must fix first.** `savePage` never writes `pipeline_version`; it relies on the column default of `1` (`0008_page_content.sql:27`). Every save therefore leaves it at `1` forever and staleness is undetectable. `packages/markdown` gains `export const CURRENT_PIPELINE_VERSION = 2` (one constant, one place), and `savePage` writes it on **both** the INSERT and the UPDATE.

| Concern | Mechanism |
|---|---|
| Stale row | `page_content.pipeline_version < CURRENT_PIPELINE_VERSION` |
| Not `content_hash` | The markdown did not change; the pipeline did. `content_hash` would report every row as fresh |
| Concurrency | The backfill re-renders from `markdown` and writes guarded by `WHERE content_hash = <the hash it read>`. A concurrent user save wins; the backfill skips that row rather than clobbering it |
| Mechanism | `packages/db/src/content/backfill-render.ts` plus a `backfill:render` script. Batched (200 rows), resumable, idempotent, safe to re-run. **Not a migration** — a `.sql` migration cannot call the TypeScript renderer |
| Read path meanwhile | `readPageHtml` still serves a stale row unchanged. Read mode never invokes the parser and never writes (page-content spec) |
| Degradation | A missing `data-block-id` means "no anchors known", not an error. The overlay client lists indicators it cannot position in the **orphan surface** already required by `UI-CHECKLIST` §4.7, rather than dropping them silently |

| | |
|---|---|
| **Rejected** | A new `render_version` column (a second version beside `pipeline_version`, and `docs/TODO.md:1238` already accepted the coupling deliberately); re-render on read (a read that writes); re-render inside a migration (the renderer is TypeScript); comparing rendered output to a fresh render to detect staleness (renders the whole corpus to find out which parts need rendering) |
| **Reverses it** | Measured reindex cost splitting `pipeline_version` into render and chunk versions, already logged as a Phase 2 open question |

---

## Decision 7 — Storage shape of `page_revision`

**Full markdown snapshot per save. No `rendered_html` on a revision** — a historical revision is rendered on demand; storing it would multiply storage and add a second cache to invalidate.

| Column | Note |
|---|---|
| `id uuid PK`, `workspace_id`, `page_id`, `author_id`, `created_at` | |
| `content text` | Full canonical markdown snapshot |
| `content_hash text` | Matches `page_content.content_hash` at the moment of the save |
| `block_index jsonb` | Provenance/audit only. **Explicitly not diff input** (see Decision 2) |
| `changeset_id uuid NULL` | |
| FKs | `(page_id, workspace_id) → page_content(node_id, workspace_id) ON DELETE CASCADE`; `(changeset_id, workspace_id) → changeset(id, workspace_id)`, which requires `changeset UNIQUE (id, workspace_id)` |
| Indexes | `(workspace_id, page_id, created_at DESC)` for page history; `(workspace_id, changeset_id)` for book diff |
| Immutability | A `BEFORE UPDATE` trigger raising an exception. A mechanism, not a comment. `DELETE` stays permitted for cascade and future pruning |

### Numbers, not adjectives

Saving is an explicit click; no autosave composable exists in the repository. Take a substantial design page at **8 KB** of markdown.

| Scenario | Saves/day | Raw/year | Stored/year (TOAST, ~3.5× on markdown) | Rows/year |
|---|---|---|---|---|
| 20-person team, 20 saves each/day, 250 working days | 400 | ~800 MB | **~230 MB** | 100 000 |
| 100-person team, same rate | 2 000 | ~4 GB | **~1.1 GB** | 500 000 |
| 100 people, 50 saves each/day | 5 000 | ~10 GB | **~2.9 GB** | 1 250 000 |

Even the pessimistic row is a gigabyte-scale table with two indexes on a self-hosted Postgres — unremarkable. Reading any revision is one indexed row read, not a delta-chain replay.

| | |
|---|---|
| **Rejected** | Per-revision deltas (3–4× smaller, but every read replays a chain and one corrupt delta destroys everything after it, for a saving that only matters at a scale this product does not have); storing `rendered_html` per revision (multiplies storage and creates a second cache to invalidate); revision-on-changeset-close rather than per-save (loses intermediate versions, which is the thing being built) |
| **Reverses it** | A measured table size or restore time that actually hurts, which would make periodic compaction — not deltas — the first move |

**Retention and pruning remain an open question this design deliberately does not close.** The proposal did not close it and no policy exists in SPECS or the roadmap. What *is* specified without the answer: a revision is immutable once written, and any future pruning must never orphan a `changeset` or a comment anchored into a pruned revision's blocks. Appended to `docs/TODO.md` Open Questions.

---

## Data Flow

```
SAVE
  PUT /pages/:id ──can('write')──▶ savePage()
       │
       └─ BEGIN ─┬─ page_content (content_hash guard)
                 ├─ resolveBookId → resolveChangeset (partial unique index arbitrates)
                 ├─ INSERT page_revision  ──▶ immutable snapshot
                 └─ reconcileDerived ─┬─ links / tags
                                      ├─ reconcileBlocks ──▶ split_from, superseded_by
                                      ├─ compressChains  ──▶ recursive CTE, save-time only
                                      └─ reconcileComments ──▶ migrate ≥0.8 | orphan
           COMMIT

DIFF                                   READ + OVERLAY
  GET /pages/:id/diff?from=&to=          GET /pages/:id ──▶ cached rendered_html (data-block-id)
    ├ can('read')                        GET /pages/:id/comments/indicators ── can('comment')
    ├ load two page_revision.content            │
    └ diffBlocks(before, after)                 └─▶ client composes overlay onto unchanged HTML
        └ parse → sliceBlocks ×2 → matchBlocks

PRESENCE
  PATCH /pages/:id/lock ─▶ heartbeatLock ─▶ broadcaster.publish(workspace, {pageId, userId, since})
                                                    │
  GET /workspaces/:id/presence/stream ◀─────────────┘   (+ poll `presence` view each keep-alive)
        └─ per event: can(user, event.pageId, 'read') ── else drop silently
```

---

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/db/drizzle/NNNN_block_split_provenance.sql` | Create | `page_blocks.split_from` + composite FK. **Ships before any comment work** |
| `packages/db/drizzle/NNNN_page_revisions_and_changesets.sql` | Create | `changeset` (+ `closed_at`, partial unique index, `UNIQUE (id, workspace_id)`), `page_revision`, immutability trigger |
| `packages/db/drizzle/NNNN_comments.sql` | Create | `comments`, threads, resolution, anchor columns, `(page_id, block_id)` FK |
| `packages/db/drizzle/NNNN_presence_view.sql` | Create | The `presence` view over `page_locks` |
| `packages/db/src/schema.ts` | Modify | Drizzle definitions for the above |
| `packages/db/src/content/save-page.ts` | Modify | Changeset resolution, revision insert, `pipeline_version` write |
| `packages/db/src/content/rebuild-derived.ts` | Modify | `split_from`; `reconcileBlocks` returns its result; `reconcileComments`; chain compression |
| `packages/db/src/content/backfill-render.ts` | Create | Batched, resumable, `content_hash`-guarded re-render |
| `packages/db/src/revisions/`, `changesets/`, `comments/`, `presence/` | Create | Queries behind `query-boundaries.ts` |
| `packages/markdown/src/match-blocks.ts` | Modify | `mintedIds[].splitFrom`; export `trigramContainment()` and `ANCHOR_CONTAINMENT_THRESHOLD` |
| `packages/markdown/src/diff-blocks.ts` | Create | `diffBlocks()` — the only diff implementation |
| `packages/markdown/src/render.ts` | Modify | `hProperties` transform, `dataBlockId` in `SANITIZE_SCHEMA`, `CURRENT_PIPELINE_VERSION` |
| `packages/markdown/package.json` | Modify | Add `@deep-wiki/core` |
| `packages/core/src/content/{diff,revision,changeset,comment}.ts` | Create | Types and ports, zero imports |
| `packages/core/src/ports/presence-broadcaster.ts` | Create | The broadcaster port |
| `packages/contracts/src/env.ts` | Modify | `CHANGESET_WINDOW_MINUTES`, no default |
| `env.example` | Modify | `CHANGESET_WINDOW_MINUTES=30` — the only place the number exists |
| `scripts/checks/env-example.ts` | Modify | Defaults-agreement rule |
| `apps/api/src/routes/{revisions,diff,comments,presence}.ts` | Create | All behind `can()` |
| `apps/api/src/presence/broadcaster.ts` | Create | In-memory implementation of the port |
| `apps/api/src/index.ts` | Modify | Mount the four route factories; thread `changesetWindowMinutes` |
| `apps/web/app/pages/...` | Create | The screens listed below |
| `docs/SPECS.md`, `docs/TODO.md` | Modify | §7.2 correction, §14 entries, Findings and the retention Open Question (append-only) |

## New UI screens — where the owner's review gates go

`docs/UI-CHECKLIST.md` §1 stops each of these for the project owner.

| # | Surface | Kind |
|---|---|---|
| 1 | Page history (revision list) | New screen |
| 2 | Page diff view (any two revisions; added/removed/**modified**/moved distinctly, §4.7) | New screen |
| 3 | Book changeset history and book-level diff (navigable between pages, §4.7) | New screen |
| 4 | Comment gutter and thread panel on the read screen | New surface on a reviewed screen |
| 5 | Orphaned-comment surface (first-class state, §4.7) | New surface |
| 6 | Presence indicator on read and edit screens (who + since when, expires visibly, §4.8) | New surface on a reviewed screen |

Three new screens, three new surfaces on already-reviewed screens. All six gate.

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit | `diffBlocks` added/removed/modified/moved, non-adjacent revisions, a fully unanchored document, determinism across two runs | `packages/markdown/src/diff-blocks.test.ts` |
| Unit | `trigramContainment` boundary behaviour at 0.8 | `packages/markdown/src/match-blocks.test.ts` |
| Property | Superseded chain walkable and compressed over generated edit sequences; no cycle, depth ≤ 64 | `packages/db` against the provisioned test Postgres |
| Property | Comment anchors over generated split/merge/delete sequences: **never attached to a block whose text does not contain the quote** | The strongest single assertion in this change |
| Integration | Two concurrent saves, one author, one book, two pages → exactly one `changeset` row | Real concurrent transactions, not mocks |
| Integration | Backfill: stale row re-rendered; a row saved concurrently is skipped, not clobbered |  |
| Integration | GATE-2: a newly minted comment anchor round-trips byte-identically; `data-block-id` does not alter serialisation | Existing corpus |
| Integration | `data-block-id` survives `rehypeSanitize` |  |
| Non-disclosure | `read`-without-`comment` sees no indicator/count/existence; a subscriber without read on page X receives no event mentioning X; mention notifications | `apps/api/testing/expect-no-disclosure.ts` |
| Structural | No diff code path references `block_index`; no code path refreshes presence outside the lock heartbeat | Grep-style assertions in the check suite |
| Structural | `bun run check` fails when `env.example` loses `CHANGESET_WINDOW_MINUTES` or a default disagrees |  |
| Routing | SSE endpoint answers with CORS headers (registered via `app.route`, never module scope) | `apps/api/src/index.test.ts` |
| E2E | Per `UI-CHECKLIST` §7, per screen |  |

## Threat Matrix

The reference matrix covers shell, subprocess, VCS and PR automation. This change introduces none of them.

| Boundary | Applicability |
|---|---|
| Documentation-like paths | **N/A** — no file is classified or executed. Markdown is parsed and sanitised at render, never run |
| Git repository selection | **N/A** — no VCS invocation |
| Commit state | **N/A** — no VCS invocation |
| Push state | **N/A** — no VCS invocation |
| PR commands | **N/A** — no PR automation |

The adversarial surface this change actually has is disclosure, and it is covered above and in the test table: per-event SSE authorisation, the `can('comment')` indicator endpoint, and mention notifications, each asserted from the unauthorised subject's point of view. Credentials, hashes and tokens are neither logged, serialised into a response, nor rendered — the SSE payload carries `userId`, display name and timestamps, and nothing else.

## Migration / Rollout

Migrations are numbered from `packages/db/drizzle/meta/_journal.json` **at apply time**, never from this document. Names are fixed; numbers are not. Apply order is the order in the file table; `down` runs in reverse, and `page_revision`'s `down` must state in its own comment that it destroys history no re-run can regenerate.

The backfill is a script, not a migration, and runs after deploy. Until it completes, stale pages serve without `data-block-id` and their comments appear in the orphan surface rather than the gutter — degraded, not broken.

## Open Questions

- [ ] `page_revision` retention and pruning. Deliberately not closed; see Decision 7. Append to `docs/TODO.md` Open Questions.
- [ ] Migration base against `ai-provider-foundation`. Owner-owned; this design assumes `content-and-editor`.
- [ ] The 0.8 containment threshold is a judgement, not a measurement, exactly as τ=0.5 is. Its reversal criterion is a measured orphan rate from real edit traffic.
