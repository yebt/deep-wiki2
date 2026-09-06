# Design: Content and the Editor (Phase 2)

## Technical Approach

Four structural moves carry this change.

1. **A canonical form, defined once.** `canonicalise(md) = stringify(parse(md))` in `packages/markdown`. Stored page markdown is canonical **by construction** — the save path rejects a write that is not its own fixed point. GATE-2's byte-identity claim is then a claim about a set we control, not about every string a human can type.
2. **Three buckets, plus a per-document probe.** Every markdown construct is *modelled* by the ProseMirror schema, *carried verbatim* as an opaque atom, or *refused*. Bucket membership is not a hardcoded promise: edit-mode entry runs the round-trip probe on that exact document and refuses to open if it is not byte-identical. The corpus proves the classes; the probe protects the documents the corpus never imagined.
3. **Tenant isolation extends the composite key rather than adding a `WHERE`.** Phase 1 pinned rows to a workspace with `(id, workspace_id)`. Content additionally needs "this node is a page", so `nodes` gains `UNIQUE (id, workspace_id, type)` and `page_content` carries a `CHECK`-pinned `node_type` into a three-column foreign key. Content on a chapter becomes unrepresentable, not merely unqueried.
4. **List endpoints fold in `core`, gather in one SQL statement.** Backlinks, mentions, tags and the tree need "which of these N may this subject read". Phase 1's D7 (SQL gathers, `decide()` decides) is preserved exactly by returning ≤10 `(origin, effect, depth)` rows *per candidate* from one recursive CTE and folding each group in `packages/core`. No N+1, no application-code filter, no second decision path.

---

## The canonical-form invariant

| Question | Answer |
|---|---|
| What is canonical | The output of the single pinned pipeline: `stringify(parse(md))` |
| Where enforced | `savePage()` asserts `canonicalise(markdown) === markdown` and rejects otherwise (`409 not_canonical` with the normalised form attached) |
| Who normalises | Only an **explicit, diff-previewed** action at an ingest boundary: import, paste of foreign markdown, and Phase 7 agent writes. Never a side effect of opening or saving |
| Why | It converts "the serialiser might rewrite the user's document" from a permanent risk into a single, visible, consented event. The user still owns the bytes; the product picks a spelling once, in the open |
| Proved by | `canonicalise(canonicalise(x)) === canonicalise(x)` (idempotence) across every corpus fixture, including the deliberately non-canonical ones |

**The pinned-options rule, made mechanical.** `packages/markdown` exports `PINNED_OPTIONS` (currently `{ bullet: '-', emphasis: '_' }`, growing to cover `bulletOrdered`, `fence`, `fences`, `listItemIndent`, `rule`, `strong`, `tightDefinitions`, `resourceLink`, `setext` — every option that decides a *spelling* rather than a *meaning*). Two tests guard it:

- **Pin coverage**: for every key `k` in `PINNED_OPTIONS` a fixture `fixtures/pins/pin-<k>.md` must exist. A new pinned option without a fixture fails the suite; the check reads the object's keys, so it cannot drift.
- **Pin efficacy**: each `pin-<k>.md` is written so that remark's *default* for `k` produces different bytes. Deleting the pin makes exactly that named fixture fail, which is the proposal's success criterion stated as an executable assertion.

Serialiser options that decide meaning (e.g. `handlers`) are not pinned data; they are code and are covered by the corpus directly.

---

## The ProseMirror schema and the three buckets

`packages/editor/src/schema.ts` — a real ProseMirror schema, no Milkdown import.

| Bucket | Members | Representation |
|---|---|---|
| **A — modelled** | `paragraph`, `heading`, `blockquote`, `list`/`listItem` (attrs: `ordered`, `start`, `spread`), `code` (attrs: `lang`, `meta`), `thematicBreak`, `table`/`tableRow`/`tableCell` (attrs: `align`), `footnoteDefinition`/`footnoteReference`, `break`; marks `emphasis`, `strong`, `delete`, `inlineCode`, `link`; custom inline nodes `wikiLink` (attrs: `target`, `anchor`, `alias`) and `tag` (attr: `name`); block-level `blockAnchor` is an attr on the owning block, not a node | Full ProseMirror nodes/marks with `toMarkdown` handlers owned by `packages/markdown` |
| **B — carried verbatim** | `html` (block and inline), `definition` + `linkReference`/`imageReference`, `yaml` frontmatter, and any future mdast node the schema does not name | Atom node `verbatim` / inline atom `verbatimInline`, attr `raw: string` holding the **literal source slice**, `atom: true`, `selectable: true`, `contentEditable=false`. Serialisation emits `raw` unchanged |
| **C — refused** | Whatever the probe rejects. Known members today: setext headings (`setext` is a global option, so a document mixing setext and ATX cannot round-trip under one pin), indented code blocks (the pipeline emits fences), and any non-canonical spelling reaching edit mode without normalisation | Edit mode does not open. The response names the construct, its line, and offers read-only or "normalise this document" with a diff |

**Why `raw` is a string and not source offsets.** An offset into the original buffer is invalidated the moment the user edits anything above it. A stored literal is stable under every edit elsewhere in the document, which is exactly the property "carried verbatim" has to mean.

**Diagram fences are bucket A, deliberately.** A Mermaid fence is a `code` node with `lang`; Phase 4 renders it from the same node. Treating it as opaque would work for round-tripping and then have to be undone.

### Fail-closed: the per-document probe

```
GET /pages/:id/edit-session
  → load canonical markdown
  → doc  = fromMarkdown(md)          # md → PM doc
  → back = toMarkdown(doc)           # PM doc → md
  → back === md ?  acquire lock, return the doc
                :  409 { reason, construct, line, offeredExits: [read_only, normalise] }
```

It never opens and drops. It never opens and repairs. The probe is a pure function pair over a string, so it costs one extra parse per edit entry — measured in the same request that takes the lock, and unnoticeable beside the network round trip.

---

## The corpus, and why it grows with the schema

`packages/markdown/fixtures/` becomes three directories, and one table-driven suite reads all of them:

| Directory | Assertions per fixture |
|---|---|
| `modelled/` | idempotent canonicalisation · PM round-trip byte-identical · `classify()` reports `modelled` |
| `verbatim/` | idempotent canonicalisation · PM round-trip byte-identical · `classify()` reports `verbatim` and names the carried node type |
| `refused/` | `classify()` reports `refused` with the expected reason code · the edit-session endpoint returns 409 for it |

The corpus classes the proposal names map onto these directories: nested lists, tables (incl. ragged alignment), fences with and without an info string, footnotes, hard breaks, entities and escapes, mixed emphasis, wiki-links (resolved, unresolved, anchored), tags, the block-anchor syntax itself, and diagram fences → `modelled/`; raw HTML block and inline, reference links, frontmatter → `verbatim/`; setext, indented code, and one non-canonical spelling per pinned option → `refused/`.

**The two grow together because `classify()` is derived from the schema, not written beside it.** `classify()` walks the mdast tree and asks the schema whether it names each node type. Adding a node to the schema moves its fixture from `refused/` to `modelled/` and the suite fails until the fixture is moved — the corpus cannot silently fall behind the schema, and the schema cannot silently outrun the corpus.

**What the guarantee cannot cover, stated plainly.** Byte-identity holds for canonical markdown whose constructs are in buckets A and B. It says nothing about non-canonical input (which is refused, or normalised on purpose), and nothing about markdown a future remark version parses differently (which the fixtures catch on the dependency bump, as a failing test rather than a rewritten document).

---

## Block identity

**The required property, first.** *An anchor must break visibly rather than move silently.* A comment or citation that ends up on the wrong block is worse than one that ends up orphaned, because the orphan is detectable and the misattribution is not. Every rule below is chosen to satisfy that property, and the threshold below is the place where it is bought.

| Concern | Mechanism |
|---|---|
| **Derived identity** | Until something references it, a block's id is `d:` + first 12 hex of `sha256(canonical block markdown)` + `#n` for the n-th identical sibling. Stable under edits above it; changes when the block itself changes, which is harmless because nothing references it |
| **Minting** | On first reference (comment, citation, explicit anchor, `[[page#^id]]`), 10 chars of Crockford base32 from `crypto.getRandomValues`, checked unique against the page's registry |
| **Persistence in markdown** | Obsidian-style trailing ` ^id` on the block's last line, produced by a micromark/mdast extension in `packages/markdown` (mdast node `blockAnchor` → block attr). `\^` is the documented escape for a literal, and both spellings are corpus fixtures. An export therefore stays self-contained |
| **Registry** | `page_blocks` — the durable record of persisted ids, their status (`active｜superseded｜tombstoned`), `superseded_by`, last content hash and a quoted excerpt. This is what Phase 3 comments will reference |
| **Index** | `page_content.block_index jsonb` — `block_id → {start, end, hash}`, **derived**, rebuilt every save, valid only for that content version. Offsets exist for highlight and chunk slicing; they are never an anchor (SPECS §3.3) |
| **Split** | Similarity, not marker position. The marker sits at the end of a block, so a split would hand it to the second half by accident. On save, each persisted id is matched against candidate new blocks by Dice coefficient over token trigrams; highest score wins, ties break toward the earlier candidate |
| **The threshold** | `τ = 0.5`. Below it, the id is **not** reassigned: it is tombstoned and the anchor breaks visibly. This is where the required property is paid for — an id never migrates onto content that is not recognisably the same text |
| **Merge** | The higher-scoring id survives on the merged block; the other is written `superseded_by = survivor` with its excerpt retained, and its marker is removed from the text. Never deleted |
| **Delete** | Tombstoned. `UNIQUE (page_id, block_id)` spans every status, so an id cannot be reused |

Matching is a pure function in `packages/markdown` (`matchBlocks(previous, next): Assignment`) with property tests over generated edit sequences: insert-above, split, merge, delete, reorder, and edit-in-place, asserting that every persisted id ends `active` on a block scoring ≥ τ or ends `superseded`/`tombstoned` — never `active` on a block below τ.

---

## Schema

Migrations `0008`–`0010`, hand-written SQL in the established idiom (`drizzle-kit generate` is never run; `migration.test.ts` asserts each object exists after `migrate()`).

`0008` first adds `ALTER TABLE nodes ADD CONSTRAINT nodes_id_ws_type_key UNIQUE (id, workspace_id, type)` — the three-column pair every content table hangs from.

| Table | Key columns | Constraints |
|---|---|---|
| `page_content` | `node_id` (PK), `workspace_id`, `node_type`, `markdown`, `rendered_html`, `block_index jsonb`, `content_hash`, `pipeline_version`, `updated_by`, `updated_at` | `node_type node_type NOT NULL DEFAULT 'page' CHECK (node_type = 'page')`; `FK (node_id, workspace_id, node_type) → nodes (id, workspace_id, type) ON DELETE CASCADE`; `UNIQUE (node_id, workspace_id)` so the pair travels onward |
| `page_blocks` | `page_id`, `workspace_id`, `block_id`, `status`, `superseded_by`, `content_hash`, `excerpt`, timestamps | PK `(page_id, block_id)`; `FK (page_id, workspace_id) → page_content (node_id, workspace_id) ON DELETE CASCADE`; `FK (page_id, superseded_by) → page_blocks (page_id, block_id)`; index `(workspace_id, page_id, status)` |
| `links` | `workspace_id`, `source_page_id`, `target_page_id`, `target_raw`, `source_block_id`, `anchor` | `FK (source_page_id, workspace_id, 'page') → nodes`; nullable `FK (target_page_id, workspace_id) → nodes (id, workspace_id) ON DELETE SET NULL` (MATCH SIMPLE, inert while unresolved); index `(workspace_id, target_page_id)` for backlinks, `(workspace_id, source_page_id)` for replacement |
| `tags` | `workspace_id`, `name` | `UNIQUE (workspace_id, name)`, `UNIQUE (id, workspace_id)` |
| `page_tags` | `page_id`, `tag_id`, `workspace_id` | PK `(page_id, tag_id)`; composite FKs into both parents |
| `page_locks` | `node_id` (PK), `workspace_id`, `holder_user_id`, `acquired_at`, `heartbeat_at`, `taken_over_from`, `taken_over_at` | `FK (node_id, workspace_id) → page_content`; no expiry column — expiry is computed |

**Why content is its own table rather than columns on `nodes`.** `nodes` is on the authorisation hot path: the resolver's recursive walk and every sidebar query touch it. Widening its rows with a `text` blob and a `jsonb` taxes queries that never want them. And only one of five node types has content, so nullable content columns on a polymorphic table invite exactly the row the three-column FK now forbids.

**`pipeline_version`** is one integer covering both the render and the chunk-boundary policy. Bumping it means "rerender and, from Phase 5 onward, reindex". A render-only change therefore forces an unnecessary reindex; that is accepted, because a version that can disagree with itself is how citations silently stop resolving.

### The save transaction

One transaction, in order: assert canonical → `UPDATE page_content … WHERE node_id = $1 AND content_hash = $expected` (zero rows → `409 stale`) → reconcile `page_blocks` from `matchBlocks` → `DELETE FROM links WHERE source_page_id = $1` then insert the fresh set → replace `page_tags` → write `rendered_html`. Derived rows are **replaced, never patched**, and no code outside this path writes `links` (a new `query-boundaries` rule enforces it, in the idiom already used for `permissions`).

---

## Read mode never reaches the ProseMirror bundle

Three layers, because two of them can be defeated by an honest mistake.

| Layer | Mechanism | Runs in |
|---|---|---|
| **1. Export map** | `packages/editor` splits its `exports`: `"."` → schema, `classify`, `fromMarkdown`, `toMarkdown` (dependencies: `@deep-wiki/markdown` only); `"./mount"` → the Milkdown surface. `src/index.ts` must never re-export `./mount` | — |
| **2. Specifier check** | `scripts/checks/bundle-isolation.ts`, using `Bun.Transpiler().scanImports()` exactly as `core-purity.ts` does: fail if the transitive closure of `packages/editor/src/index.ts` reaches `milkdown`, `@milkdown/*`, `prosemirror-*` or `@tiptap/*`; fail if any `apps/web` file statically imports `@deep-wiki/editor/mount` (only `defineAsyncComponent`/dynamic `import()` is allowed) | `bun run check`, therefore `bun run test`'s sibling and CI |
| **3. Build-output test** | After `nuxt build`, read the client manifest, walk the read route's entry chunk and its **static** `imports` (not `dynamicImports`), and assert no reached module id matches `/prosemirror｜milkdown｜tiptap/`. Asserting over the manifest rather than grepping the whole `_nuxt` directory is what keeps it true: the async edit chunk legitimately exists and must not fail the test | A dedicated CI step **after** the build step, and locally via `bun run check:bundle` after a build |

**Stated plainly, as the proposal requires.** Today `.github/workflows/ci.yml` runs `lint`, `typecheck`, `check`, `test`, then the builds. Layer 2 runs inside `check` and therefore runs today. Layer 3 cannot run inside `bun run test` (no build output exists there) and needs a new CI step placed after the build. The repository still has no remote, so "in CI" describes a workflow file that no service currently executes — the enforcing runs are the local `bun run verify` and `bun run check:bundle` until a remote exists.

**`@nuxt/ui` v4 ships a TipTap-based `UEditor`.** It is forbidden repo-wide and is on layer 2's denylist: it carries its own markdown serialiser, which is the second parser CLAUDE.md prohibits.

---

## The soft lock, coherent without presence

| Property | Mechanism |
|---|---|
| Expiry is server-side and computed | A lock is held iff `heartbeat_at > now() - LOCK_TTL`. No expiry column, no sweeper job, no client clock. A lock from a closed laptop is already expired when the next reader asks |
| A read never writes | Read mode takes no lock and issues no `UPDATE`. Stale rows are ignored, not deleted |
| Acquisition is one atomic statement | `INSERT … ON CONFLICT (node_id) DO UPDATE SET holder_user_id = $me, acquired_at = now(), heartbeat_at = now() WHERE page_locks.holder_user_id = $me OR page_locks.heartbeat_at < now() - $ttl RETURNING *`. Zero rows returned means someone else holds it — there is no read-then-write race to lose |
| Take over is explicit | The same statement without the guard, plus `taken_over_from`/`taken_over_at`. The confirmation states the consequence for the other person before it runs (UI-CHECKLIST §4.8) |
| Both exits are always offered | The 409 body carries `holder.displayName`, `acquiredAt`, and both `read_only` and `take_over`. The client renders both; a UI that shows one has failed the checklist |
| The displaced editor cannot overwrite | Its next heartbeat returns `lost`. Saving is independently guarded by `content_hash` optimistic concurrency, so even a client that ignores the signal gets `409 stale` and keeps its buffer. Phase 2 has no revisions, so this guard is what stands in for them |
| Heartbeat | `PATCH …/lock` every 20 s, `LOCK_TTL = 120 s`, both in `packages/contracts/src/env.ts` and mirrored into `env.example`. Requires `write` through `can()` |

**What Phase 3 adds, and what it does not have to redo.** Presence adds an SSE broadcast on acquire/heartbeat/takeover/release over this same row. Nothing about the lock's truth depends on that channel, because expiry is *computed at read time* rather than *announced by a client*. Phase 3 makes the lock faster to observe; it does not make it correct.

---

## Listing without disclosure

Backlinks, page mentions, user/cell mentions, tag lists and the navigation tree all answer set-shaped questions, and each can disclose the existence and title of an unreadable page. The rule: **generalise the resolver, never bypass it, never loop it.**

```
packages/core  (pure, no imports)
  decideMany(groupsByOrigin) → Map<originId, Effect>    ← same fold as decide(), applied per group

packages/db/src/permissions/     ← still the only directory allowed to touch `permissions`
  canManyResources(sql, {subjectType, subjectId, action, resourceIds})  → Set<resourceId>
  canManySubjects (sql, {resourceId,   action, subjectIds})             → Set<subjectId>
```

`canManyResources` is Phase 1's CTE with its recursive arm seeded from `unnest($resourceIds)` carrying an `origin_id` through the walk; it returns `(origin_id, effect, depth)` — **≤10 rows per candidate**, one statement, no `ORDER BY`, no `CASE`. Phase 1's D7 is preserved exactly: SQL gathers, `decide()` decides. `canManySubjects` inverts it: one resource's ancestor chain (≤5 rows) against an expanded subject set.

| Surface | Query shape |
|---|---|
| Backlinks | one `SELECT` over `links` by `(workspace_id, target_page_id)` bounded by page size → `canManyResources(read)` → project titles for survivors only. Two statements, never N+1 |
| Page mentions | title prefix search bounded at `LIMIT 50` → `canManyResources(read)` → return the first 10 survivors |
| User / cell mentions | workspace membership → `canManySubjects(read, thisPage)` → a subject who cannot read this page is not a candidate |
| Tags and tree | the same `canManyResources` filter before projection |

Three rules that close the remaining leaks:

1. **Counts are computed over the filtered set.** A "12 backlinks" badge over unfiltered rows discloses exactly what the filter removed.
2. **An outbound link to an unreadable page renders as unresolved** — identical to a link to a page that does not exist. Distinguishing "exists but forbidden" from "does not exist" *is* the leak.
3. **Nothing is read into a response object before filtering.** Tests assert this from the unauthorised subject's point of view with one shared helper, `expectNoDisclosure(response, hiddenNode)`, which scans the serialised body for the hidden node's id, slug and title.

---

## Where the pure logic lives

| Package | Holds | Must not hold |
|---|---|---|
| `packages/core` | `decideMany()`; content entity types built from primitives (`BlockId`, `BlockStatus`, `PageContentRef`); the ports a use case needs (`ContentStore`, `BlockRegistry`) | Any mdast type, any unified/remark import, any dependency at all |
| `packages/markdown` | The one pipeline; `canonicalise`, `PINNED_OPTIONS`, `classify`, `matchBlocks`, wiki-link and tag extensions, block-anchor extension, `chunk()`, `render()` — all pure functions with no I/O | I/O, persistence, ProseMirror |
| `packages/editor` | The ProseMirror schema, `fromMarkdown`/`toMarkdown`, the round-trip probe (root export); Milkdown wiring (`./mount` export only) | A private parser or serialiser |
| `packages/db`, `apps/api`, `apps/web` | Adapters | Domain rules |

**Core purity, verified rather than assumed.** `checkCorePurity()` enforces two rules: every non-relative import specifier in `packages/core/src` is an error, and `packages/core/package.json` must declare **zero** `dependencies`. `@types/mdast` is a `dependencies` entry of `packages/markdown`, so adding it to core fails the manifest rule outright, independently of whether `Bun.Transpiler().scanImports()` elides `import type` — which cannot be settled by reading the check and is therefore not something this design is willing to depend on. **Decision: no mdast type crosses into `packages/core`, ever.** Core's content entities are built from primitives, and the port speaks in those primitives.

---

## Chunking (defined here, consumed in Phase 5)

`chunk(markdown, { maxTokens }): Chunk[]` where `Chunk = { blockIds, text, ordinal }`. Boundaries follow block boundaries and never split a block; a block larger than `maxTokens` becomes its own oversized chunk rather than being cut mid-content. `workspace_id` is attached by the caller from the owning node — the function itself is pure and stores nothing in Phase 2.

Determinism is proved twice: `chunk(x)` twice returns deep-equal output, and each corpus fixture has a **golden** chunk file. A boundary change therefore cannot land without a visible golden diff in review, which is the only thing that actually prevents silent drift after Phase 5 indexes it.

---

## Data flow

```
  save                                          read
   │                                             │
   ▼                                             ▼
 canonicalise ── reject if not a fixed point   page_content.rendered_html  ── served as-is
   │                                             (sanitised at render time; no ProseMirror)
   ▼
 parse ──┬─ matchBlocks(prev, next) ─→ page_blocks   (persisted ids, superseded, tombstoned)
         ├─ block index             ─→ page_content.block_index   (derived offsets)
         ├─ wiki-links              ─→ links         (replaced wholesale)
         ├─ tags                    ─→ tags/page_tags
         ├─ render + sanitise       ─→ page_content.rendered_html
         └─ chunk()                 ─→ (Phase 5)

  edit entry
   │
   ▼
 probe: toMarkdown(fromMarkdown(md)) === md ?  lock (one atomic upsert)  :  409 + read-only / normalise
```

---

## Architecture Decisions

| # | Decision | Rationale | What would reverse it |
|---|---|---|---|
| D1 | Stored markdown is canonical by construction; the save path rejects non-canonical input | Turns "the serialiser might rewrite the user's document" into one visible, consented normalisation at an ingest boundary. It also makes GATE-2's claim precise instead of aspirational | A requirement to store byte-preserved foreign markdown, which would mean per-node spelling attrs and custom handlers for every construct |
| D2 | Three buckets — modelled, verbatim, refused — with membership decided by a per-document round-trip probe at edit entry | A schema is lossy for what it does not model, so the honest guarantee is empirical per document rather than promised per class. The probe is two pure calls on a string | A measured cost at document sizes this product does not have |
| D3 | Verbatim atoms store the **literal source text**, not offsets into the buffer | An offset is invalidated by any edit above it, which is precisely what "carried verbatim" must survive | Nothing foreseeable |
| D4 | Diagram fences are modelled as `code` nodes, not carried opaquely | Phase 4 renders from `lang`; opaque carry would have to be undone | Nothing foreseeable |
| D5 | `classify()` derives its verdict from the schema; fixtures live in `modelled/`, `verbatim/`, `refused/` directories | The corpus cannot fall behind the schema and the schema cannot outrun the corpus, because moving a node changes which directory its fixture must be in | Nothing foreseeable |
| D6 | `PINNED_OPTIONS` is exported data, with a fixture required per key | Makes "removing a pin fails a named fixture" an executable rule instead of a convention that a dependency bump quietly outlives | Nothing foreseeable |
| D7 | Block ids are lazy: derived content hashes until something references them | Eagerly stamping `^id` on every paragraph pollutes markdown the user owns and reads | A feature needing an anchor on every block before any reference exists |
| D8 | Split/merge resolved by trigram similarity with a **refusal threshold** `τ = 0.5`, not by marker position | The marker sits at the end of a block, so position hands a split to the wrong half. Below τ the id breaks visibly rather than migrating onto text it was never about | Measured mis-assignment at τ, which is a threshold change, not a mechanism change |
| D9 | Superseded ids are recorded with an excerpt; tombstoned ids are never reused | Phase 3 comments degrade to an orphan with quoted context (UI-CHECKLIST §4.7) instead of vanishing or pointing at the wrong block | Nothing foreseeable |
| D10 | `page_content` is its own table, tied by a **three-column** FK `(node_id, workspace_id, node_type)` | Extends Phase 1's D6 instead of adding a `WHERE`: content on a chapter becomes unrepresentable. Keeps the authorisation hot path's rows narrow | Nothing foreseeable |
| D11 | One `pipeline_version` covering render and chunk boundaries | A render-only change forcing a needless reindex is cheaper than two versions that can disagree and leave citations resolving to nothing | Measured reindex cost, which would split it in two |
| D12 | Raw HTML round-trips verbatim but is sanitised at **render** time with an allowlist | Content is stored faithfully and served safely. A sanitiser that ran at save time would silently alter the user's source, which is D1's whole objection | Nothing foreseeable |
| D13 | Read/edit isolation enforced by export map + specifier check + build-manifest test | A shared barrel is how this gets violated by accident, and review discipline does not survive the fourth contributor | Nothing foreseeable |
| D14 | `@nuxt/ui`'s `UEditor` and all of TipTap are denylisted | TipTap carries its own markdown serialiser; that is the second parser CLAUDE.md forbids | Nothing foreseeable |
| D15 | Lock expiry is computed on read (`heartbeat_at > now() - ttl`), never stored or swept | A lock from a closed laptop is already expired when asked about, with no job and no client clock, and Phase 3's presence layer adds broadcast without touching correctness | Nothing foreseeable |
| D16 | Save is guarded by `content_hash` optimistic concurrency, independent of the lock | Phase 2 has no revisions, so a displaced or stale editor must be stopped by the write path itself, not by a lock it may have ignored | Revisions landing in Phase 3, which make a conflict recoverable rather than merely refused |
| D17 | List endpoints use `canManyResources`/`canManySubjects`: one CTE returning ≤10 rows per candidate, folded in `core` | No N+1, no application-code filter, and Phase 1's D7 (SQL gathers, `decide()` decides) is preserved verbatim | Candidate sets large enough for the ≤10N transfer to matter, which pagination bounds |
| D18 | An unreadable link target renders identically to a non-existent one; counts are computed post-filter | The distinction between "forbidden" and "absent" *is* the disclosure | Nothing foreseeable |
| D19 | No mdast type enters `packages/core`; content entities use primitives | The purity check's manifest rule rejects `@types/mdast` outright, and whether `scanImports()` elides type-only specifiers cannot be settled by reading the check | Nothing foreseeable — the primitives cost nothing |
| D20 | `chunk()` has golden files per fixture in addition to a determinism test | Determinism alone permits a boundary change; a golden makes that change a visible diff in review | Nothing foreseeable |

---

## Testing strategy (Strict TDD, `bun run test`)

| Layer | What | Needs |
|---|---|---|
| Pure unit — `packages/markdown` | Canonicalisation idempotence, pin coverage and efficacy, wiki-link/tag/anchor extensions both directions, `matchBlocks` property tests over generated edit sequences, `chunk()` determinism + goldens, `classify()` per bucket | Nothing |
| Pure unit — `packages/editor` | **GATE-2**: byte-identical `md → PM doc → md` across `modelled/` and `verbatim/`; the probe returns `refused` with the right reason for every `refused/` fixture | Nothing |
| Pure unit — `packages/core` | `decideMany()` folds each group exactly as `decide()` folds one (differential test against the Phase 1 function) | Nothing |
| DB integration — `packages/db` | Three-column FK rejections (content on a chapter; cross-tenant link), the save transaction's atomic replacement, block reconciliation, lock acquire/expire/takeover including two concurrent acquisitions, `content_hash` conflict, `canMany*` against the Phase 1 fixture tree | Real Postgres, auto-provisioned |
| Route — `apps/api` | `app.request()` in-process: read/save behind `can()`, backlinks, mentions, tags, tree — each with an `expectNoDisclosure` assertion from the unauthorised subject's point of view | Real Postgres |
| Structural — `scripts/checks` | Bundle-isolation specifier rules against violating fixtures; the `links` write-boundary rule; the single-parser rule (no second `remark-parse`/`unified`/`@tiptap` dependency outside `packages/markdown`) | Nothing |
| Build output — `apps/web` | Read-route chunk closure contains no ProseMirror module id | A real `nuxt build`; own CI step |
| E2E — Playwright | read → edit → save round trip; permission-denied; lock contention showing both exits; mention and slash menus keyboard-only (arrows, Enter, Escape, Tab), no menu inside a code block, empty and no-results states; **caret-stability**: type below a heading and assert the caret's viewport position is unchanged after live preview renders (UI-CHECKLIST §4.6) | Full stack |

Every unit is RED first. `packages/markdown` and `packages/editor` are RED-able from the first commit because both are pure; the DB layers reuse Phase 1's provisioning harness unchanged.

**Live preview must not steal focus or reflow.** Three design rules make §4.6 testable rather than aspirational: preview is applied as ProseMirror `Decoration`s from plugin state, never by replacing nodes; no preview transaction sets a selection or is added to history (`addToHistory: false`); and any node view that mounts asynchronously reserves its height so mounting cannot reflow content under the cursor. The e2e caret assertion is what catches a regression.

---

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Executable-file / active-content classification | **Applicable** — markdown carries raw HTML verbatim (bucket B) and the rendered HTML is served to browsers | `rendered_html` is produced through `remark-rehype` + `rehype-sanitize` with an explicit allowlist; the stored markdown keeps the raw bytes. Sanitising at render, never at save (D12). URL schemes allowlisted for `link` and `image` | A fixture containing `<script>`, an `onerror` attribute, and a `javascript:` href round-trips byte-identically in markdown **and** renders inert; a sanitiser-schema change bumps `pipeline_version` and forces rerender |
| Routing — wiki-link and anchor resolution | **Applicable** — `[[target#^anchor]]` resolves user text to a node | Resolution is a lookup scoped to the source page's `workspace_id`; a target outside it is `unresolved`, never a cross-tenant hit. Anchors resolve only within the resolved page's own registry | A wiki-link naming a slug that exists in another workspace resolves to `unresolved`; an anchor naming a block on a different page does not resolve |
| Content-derived disclosure | **Applicable** — backlinks, mentions, tags, tree | Every list filters through `canManyResources`/`canManySubjects` before projection; counts post-filter; forbidden is indistinguishable from absent (D17, D18) | `expectNoDisclosure` on each list endpoint; a backlink from a readable page to a hidden one; a mention query that prefix-matches a hidden title |
| Shell / subprocess | N/A — this change spawns nothing. The Phase 1 test-provisioning harness is unchanged | — | — |
| Git repository selection, commit/push state, PR commands | N/A — no VCS automation | — | — |
| Documentation-like path traversal | N/A — no new filesystem writes; the blob store is untouched | — | — |

---

## File Changes

| Path | Action | Purpose |
|---|---|---|
| `packages/markdown/src/index.ts` | Modify | `canonicalise`, `PINNED_OPTIONS`, `render`, re-exports |
| `packages/markdown/src/{extensions/wiki-link,extensions/tag,extensions/block-anchor}.ts` | Create | Micromark + mdast extensions, both directions |
| `packages/markdown/src/{classify,match-blocks,block-index,chunk}.ts` | Create | Bucket classification, id lifecycle, derived index, chunk boundaries |
| `packages/markdown/fixtures/{modelled,verbatim,refused,pins}/` | Create | The GATE-2 corpus; the 7 existing fixtures move into `modelled/` |
| `packages/editor/src/{schema,from-markdown,to-markdown,probe}.ts` | Create | The ProseMirror schema and both legs |
| `packages/editor/src/round-trip.ts` | Modify | Becomes the real `md → PM doc → md` harness |
| `packages/editor/src/mount/*` | Create | Milkdown surface, mentions, slash commands — reachable only via `./mount` |
| `packages/editor/package.json` | Modify | Split `exports`; Milkdown/ProseMirror as dependencies of the `mount` entry |
| `packages/core/src/permissions/decide-many.ts`, `src/content/*` | Create | `decideMany()`; primitive-typed entities and ports |
| `packages/db/drizzle/0008_page_content.sql` … `0010_page_locks.sql` (+ `down/`) | Create | Migrations, each with a tested `down` |
| `packages/db/src/schema.ts` | Modify | New tables |
| `packages/db/src/content/{save-page,read-page,rebuild-derived}.ts` | Create | The save transaction; the only writer of `links`/`page_tags` |
| `packages/db/src/permissions/{can-many,readable}.ts` | Create | Set-shaped resolvers, inside the one allowed directory |
| `packages/db/src/locks/page-lock.ts` | Create | Acquire, heartbeat, take over, release |
| `packages/contracts/src/{pages,links,tags,locks}.ts` | Create | Request/response schemas |
| `packages/contracts/src/env.ts`, `env.example` | Modify | `PAGE_LOCK_TTL_SECONDS`, `PAGE_LOCK_HEARTBEAT_SECONDS` |
| `apps/api/src/routes/{pages,links,tags,locks,mentions}.ts` | Create | All behind `can()` / `canMany*` |
| `apps/web/app/pages/…` read view, edit view, tree | Create | Three human-gate screens |
| `scripts/checks/bundle-isolation.ts` (+ fixtures) | Create | Layers 2 and 3 |
| `scripts/checks/query-boundaries.ts` | Modify | `links`/`page_tags` write-boundary rule; single-parser rule |
| `package.json` | Modify | `check:bundle`; add bundle isolation to `check` |
| `.github/workflows/ci.yml` | Modify | New step after the build for the built-bundle assertion |
| `docs/TODO.md`, `docs/SPECS.md` | Modify | The pin Finding, the supported set, GATE-2 status |

---

## Work Units

Delivery is `single-pr` with `size:exception` accepted. **400-line budget risk: High**, accepted. Tests ship with the behaviour they verify; each unit leaves the repository green.

| # | Commit | Gate | Rollback boundary |
|---|---|---|---|
| 1 | `feat(markdown): canonical form with pinned spelling options and pin coverage` | — | `canonicalise` + `PINNED_OPTIONS` + `fixtures/pins/` |
| 2 | `feat(markdown): gfm, wiki-links, tags and block anchors in the one pipeline` | — | `src/extensions/` + their fixtures |
| 3 | `feat(markdown): block identity, split/merge matching and the derived index` | — | `match-blocks.ts`, `block-index.ts` |
| 4 | `feat(markdown): deterministic chunk boundaries with golden files` | — | `chunk.ts` + goldens |
| 5 | `feat(markdown): sanitised html rendering separate from canonical storage` | — | `render.ts` |
| 6 | `feat(editor): prosemirror schema with verbatim carry and bucket classification` | — | `schema.ts`, `classify` wiring |
| 7 | `feat(editor): GATE-2 — byte-identical markdown round trip across the corpus` | **GATE-2 lands here and must be green before unit 15** | `from-markdown.ts`, `to-markdown.ts`, `probe.ts` |
| 8 | `feat(db): page content and the block registry behind a page-typed foreign key` | — | migration `0008` |
| 9 | `feat(db): derived links and tags replaced wholesale inside the save transaction` | — | migration `0009`, `src/content/` |
| 10 | `feat(db): soft lock with server-evaluated expiry and explicit takeover` | — | migration `0010`, `src/locks/` |
| 11 | `feat(core,db): set-shaped permission folds for list endpoints` | — | `decide-many.ts`, `can-many.ts` |
| 12 | `feat(api): page read and save with optimistic concurrency behind can()` | — | `routes/pages.ts` |
| 13 | `feat(api): backlinks, tags and mention candidates that disclose nothing` | — | `routes/{links,tags,mentions}.ts` |
| 14 | `feat(checks): read mode can never reach the prosemirror bundle` | — | `scripts/checks/bundle-isolation.ts`, CI step |
| 15 | `feat(web): read mode served from cached html` | **Human gate** | `apps/web` read route |
| 16 | `feat(web): edit mode — milkdown, live preview, mentions and slash commands` | **Human gate**; blocked until units 7 and 14 are green | `apps/web` edit route, `packages/editor/src/mount/` |
| 17 | `feat(web): navigation tree with drag reordering` | **Human gate** | `apps/web` tree component |
| 18 | `docs: record the pipeline, the serialiser pin finding and the supported set` | — | doc diffs only |

Units 1–7 are the pipeline and the gate; no Milkdown dependency is installed before unit 16, so the sequencing constraint is enforced by the dependency graph and not only by intent.

---

## Migration / Rollout

| Migration | Up | Down |
|---|---|---|
| `0008_page_content` | `nodes` gains `UNIQUE (id, workspace_id, type)`; `page_content`; `page_blocks` | Drop both tables, then the unique constraint |
| `0009_knowledge_graph` | `links`, `tags`, `page_tags` | Drop in reverse |
| `0010_page_locks` | `page_locks` | Drop |

Rollback order is `0010 → 0009 → 0008`. Every `down` is tested by `migration.test.ts` in the established idiom.

**Only `page_content.markdown` is irreplaceable.** `rendered_html`, `block_index`, `links`, `tags` and `page_tags` are derived and rebuilt by `bun run -F @deep-wiki/db rebuild:derived`, which reparses every page. `page_blocks` is *not* derived — it carries superseded and tombstoned history that the current markdown cannot reconstruct, so it is treated as user data and any migration touching it must be additive. Any future migration touching `markdown` must be additive for the same reason.

Code rollback: reverting units 15–17 leaves read mode serving cached HTML from `page_content` — the product degrades to read-only rather than breaking. Reverting units 1–7 returns `packages/markdown` to `parse`/`stringify`; every consumer imports it through one entry point, so `bun run typecheck` finds the blast radius immediately. Dev reset is `podman compose down -v` and re-bootstrap. No production deployment exists, so the practical path is roll-forward with a corrective migration.

---

## Open Questions

- [ ] `τ = 0.5` for block reassignment is a judgement, not a measurement. It is deliberately conservative (it prefers an orphan to a misattribution) and is a one-constant change once real edit traffic exists.
- [ ] Setext headings and indented code blocks are `refused` rather than modelled. Both could move to `modelled` later with per-node spelling attrs and custom `toMarkdown` handlers; that is additive and does not invalidate any stored document.
- [ ] `pipeline_version` couples render and chunk versions. If Phase 5's reindex proves expensive, splitting it is a two-column migration.
- [ ] The build-output assertion needs a CI step this repository has no runner for — the "no remote" gap is unchanged by this design and is recorded, not solved.
- [ ] This document exceeds the 800-word design budget, as Phase 1's did. The brief required the concrete schema, the bucket rules, the block lifecycle, the disclosure queries, work units, decisions and rollback; those cannot be stated at that length without becoming unverifiable.
