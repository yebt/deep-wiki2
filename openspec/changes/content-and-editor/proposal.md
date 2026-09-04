# Proposal: Content and the Editor (Phase 2)

## Intent

Phase 1 built the `nodes` tree and the authorisation path that guards it. The tree is empty: no table stores a page's markdown, nothing parses it, and `packages/markdown` is a two-function placeholder (`parse`/`stringify`). Phase 2 fills the tree with content and gives the product its writing surface.

Two commitments make this phase the highest-risk area of the codebase (SPECS §5.1):

- **Markdown is the source of truth.** The ProseMirror document is an in-memory view, never persisted.
- **One parser.** `packages/markdown` is imported by the editor, the API and the future indexer. A second parser is a permanent bug class (CLAUDE.md; SPECS §14).

**Headline sequencing requirement — GATE-2**: the `markdown → ProseMirror doc → markdown` byte-identity suite is green across the full fixture corpus **before Milkdown is wired into any user-facing screen**. This is an ordering constraint on the work, exactly as GATE-1 was for Phase 1, not an aspiration. A lossy serialiser does not fail loudly; it quietly rewrites documents the user owns.

## Scope

### In Scope

| Deliverable | Constraint |
|---|---|
| `packages/markdown` as the single unified/remark pipeline: parse, stable block IDs, wiki-links, tags, chunk boundaries | No second parser anywhere. Serialiser options pinned and asserted, not assumed |
| Page content storage: canonical markdown, cached render, block index | No such column exists today (`packages/db/src/schema.ts`). Revisions stay Phase 3 |
| **GATE-2** corpus + byte-identity suite + unrepresentable-content policy | Precedes the editor UI |
| `packages/editor`: markdown → ProseMirror doc parser, doc → markdown serializer | Reuses `packages/markdown` for both legs; no private parser |
| Milkdown editor: Typora-like live preview, `@` mentions, `/` slash commands | Mentions resolve through `can()` — never mention someone into a document they cannot see |
| Read mode: HTML rendered at save time, cached, served without booting ProseMirror | Bundle isolation is asserted by a test, not by discipline |
| Edit mode: soft lock, acquired on entry, heartbeat while open, expiring on silence | "Take over" and "open read-only" always both visible |
| Derived `links` table + backlinks; `tags`, `page_tags`, tag-filtered navigation | Rows replaced on every save; never user-editable (SPECS §3.2) |
| Navigation tree UI over `nodes`, drag reordering writing back to `position` | Human-gate screen |

### Out of Scope

Revisions, changesets, diffs, comments and presence (Phase 3); diagrams and Kroki (Phase 4) — a diagram fence is treated as an opaque code fence here and must round-trip as one; the AI layer, embeddings and retrieval (Phase 5); team rule packs (Phase 6); MCP and `packages/ai-tools` (Phase 7). Real-time multiplayer stays deferred.

## GATE-2 — the corpus is the guarantee

The suite is only worth what the corpus covers. Today it covers 7 fixtures (heading, paragraph, list, ordered-list, code-fence, blockquote, link) and exercises **md → mdast → md only**: `packages/editor/src/round-trip.ts` currently calls `parse`/`stringify` back to back. It proves the serialiser options; it does not yet prove anything about a ProseMirror schema. Treat GATE-2 as unstarted.

| Corpus class | Why it must be there |
|---|---|
| Nested lists (mixed markers, loose vs tight, indentation) | The most common silent renormalisation |
| Tables, incl. ragged alignment rows | Needs `remark-gfm`; the serialiser reflows column padding |
| Code fences with **and without** a language hint | Fence character and info-string preservation |
| Footnotes | GFM extension; definition ordering and placement |
| Raw HTML blocks and inline HTML | The classic thing a rich-text schema cannot model |
| Hard line breaks (two-space and backslash forms) | Two source spellings, one node — a serialiser must not pick for the user |
| Character entities and escapes | `&amp;` vs `&`, escaped `\*` |
| Mixed and nested emphasis / strong | The `_` vs `*` trap below |
| Wiki-links, incl. unresolved and anchored forms | Custom syntax extension, both directions |
| Tags | Custom syntax extension |
| **The block-ID anchor syntax itself** | It is markdown we write; if it does not round-trip, the anchor primitive corrupts documents |
| Diagram fences (Mermaid, D2) | Phase 4 renders them; Phase 2 must not mangle them |

**The pinned-options rule.** `remark-stringify`'s defaults renormalise `-` bullets to `*` and `_` emphasis to `*`. Phase 0 pinned `{ bullet: '-', emphasis: '_' }` in `packages/markdown/src/index.ts` for exactly this reason. Every option that decides a *spelling* rather than a *meaning* MUST be pinned explicitly and covered by a fixture that fails if the pin is removed. An unpinned option is a silent document rewrite waiting for the next dependency bump.

> Correction to the brief: this pinning is recorded in `packages/markdown/src/index.ts` and in Phase 0's archived `tasks.md` (5.1), **not** in the `docs/TODO.md` Findings log. Phase 2's docs work unit should add the Finding, since that log is where the next reader will look.

**What the guarantee can and cannot cover — stated honestly.** A ProseMirror schema is lossy by construction for anything it does not model. Byte-identity can therefore only be guaranteed for constructs the schema models. The rule this change adopts:

1. Every corpus class above is either **modelled** by the schema, or **carried verbatim** as an opaque leaf node that serialises back byte-for-byte.
2. Content that is neither modelled nor carriable MUST fail closed: the editor refuses to open the document in edit mode and says why, offering read-only. It MUST NOT open, drop the construct, and save.
3. A construct that round-trips lossily is a **bug**, never an accepted tolerance. The corpus is the definition of "supported", and the supported set is documented for users.

## Block IDs — assignment, split and merge

Block IDs are the anchor primitive for comments, AI selections, diffs and RAG citations (SPECS §3.3). Their lifecycle rules belong in this phase because everything downstream inherits them.

- **Assignment**: lazily. A block gets a persisted ID when something references it (a comment, a citation, an explicit anchor); until then it carries a derived, in-index identity only. Rationale: eagerly stamping every paragraph with an anchor pollutes markdown the user owns and reads.
- **Persistence**: the block index (`block_id → {start, end, hash}`, SPECS §3.4) is the mapping; persisted anchors additionally appear in the markdown so an export stays self-contained. Both directions are corpus-covered.
- **Split**: the original ID stays with the fragment that best matches the original content; the new fragment gets a fresh ID. Rationale: a comment must stay on the text it was about, not on whichever half happens to be first.
- **Merge**: the surviving block keeps one ID; the absorbed ID is recorded as superseded, never silently deleted, so a Phase 3 comment anchored to it degrades to an orphan with quoted context rather than vanishing (UI-CHECKLIST §4.7).
- **Delete**: the ID is tombstoned, not reused.

`sdd-design` owns the exact matching heuristic and the persisted-anchor syntax; this proposal fixes the properties they must satisfy.

## Capabilities

### New Capabilities

- `markdown-pipeline`: the single unified/remark pipeline — parse, block-ID assignment and lifecycle, wiki-link normalisation, tag parsing, chunk boundaries
- `markdown-round-trip`: GATE-2 — the fixture corpus, byte-identity, pinned serialiser options, fail-closed on unrepresentable content
- `page-content`: canonical markdown storage, the save pipeline, the cached render, the block index
- `document-editor`: the Milkdown/ProseMirror surface, live preview, `@` mentions, `/` slash commands
- `document-modes`: read mode with bundle isolation; edit mode with the soft lock and heartbeat
- `knowledge-graph`: the derived `links` table, backlinks, tags and tag-filtered navigation
- `navigation-tree`: the tree UI over `nodes` with drag reordering

### Modified Capabilities

- `ci-pipeline`: GATE-2 becomes a **named blocking gate**, not merely one test among many. A generic "run the tests" requirement cannot express "green before the editor ships"

## Approach

**Pipeline first, gate second, editor third, UI last.** No Milkdown wiring starts until GATE-2 is green.

**Hexagonal placement.** `packages/core` stays framework-free and is the one place that must not learn about remark: it holds the domain entities and any port a use case needs (for example, "give me this page's blocks"), never a unified import. `packages/markdown` is not the domain package and may depend on unified/remark; its pure logic — block-ID lifecycle rules, link normalisation, chunk-boundary policy — lives there as pure functions with no I/O, which is what makes it cheaply testable. Adapters live outside both: ProseMirror/Milkdown wiring in `packages/editor`, HTTP in `apps/api`, persistence in `packages/db`.

**Chunking for GATE-3.** Chunk boundaries follow block boundaries and carry their block IDs, so a Phase 5 citation resolves to a real, highlightable region. Getting this wrong is expensive later: changing chunk boundaries after indexing invalidates the entire vector index.

**Read/edit separation is a build-time concern, not a runtime one.** The ProseMirror bundle must be reachable only through a dynamically imported edit-mode entry point. A shared `index.ts` barrel that re-exports both is exactly how this gets violated by accident.

**Soft lock without presence.** Presence is Phase 3, so Phase 2 must make the lock coherent on its own: an explicit lock record with holder identity, acquisition time and a heartbeat timestamp; expiry evaluated server-side on read, so a lock from a closed laptop is already expired when the next user asks; "take over" as an explicit, consequence-stating action; and read-only entry that takes no lock at all. Phase 3 then adds live broadcast on top of a lock that already tells the truth without it.

## Cross-cutting gates

| Gate | Assessment |
|---|---|
| **GATE-2 — markdown round-trip** | **Owned by this change.** Unstarted: the existing harness proves the serialiser pin, not a ProseMirror schema. Green across the full corpus before Milkdown reaches a screen |
| **GATE-1 — permissions** | Satisfied (2026-09-04) and must not regress. It regresses if this change reads or writes content outside `can()`: a save path, a backlink query, a mention autocomplete, a tag listing or a tree endpoint that filters in application code instead of going through the resolver. Backlinks and mentions are the sharp edges — both can disclose the *existence* and *title* of a page the viewer cannot read |
| **GATE-3 — vector tenant isolation** | Later (Phase 5), but this change defines the chunk boundaries it will index. Chunks MUST carry `workspace_id` from the owning node and their block IDs, and the chunking function MUST be deterministic for identical input — a non-deterministic boundary makes reindexing produce citations that no longer resolve |

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `packages/markdown/src/` | Modified | Placeholder becomes the real pipeline; GFM + custom syntax extensions |
| `packages/markdown/fixtures/` | Modified | 7 fixtures grow into the GATE-2 corpus |
| `packages/editor/src/` | Modified | Real ProseMirror schema, both round-trip legs, Milkdown setup |
| `packages/db/src/schema.ts`, `packages/db/drizzle/` | Modified | Page content, block index, `links`, `tags`, `page_tags`, the lock table |
| `packages/core/src/` | Modified | Content entities and ports only — no unified import |
| `packages/contracts/src/` | Modified | Page read/save, link, tag and lock schemas |
| `apps/api/src/routes/` | New | Content, backlink, tag and lock routes, all behind `can()` |
| `apps/web` | New | Read view, edit view, navigation tree — each a human-gate screen |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The round-trip cannot be lossless for everything ProseMirror does not model | High | Accepted and designed for, not wished away: model it, carry it opaquely, or refuse to edit. Never open-and-drop. The corpus defines the supported set |
| An unpinned serialiser option silently rewrites documents after a dependency bump | High | Every spelling-level option pinned and covered by a fixture that fails when the pin is removed. The `-`/`_` trap is the known instance, not the only one |
| Read mode accidentally pulls in the ProseMirror bundle via a shared import | Med | Asserted by a build-output test on the read-mode entry, not by review discipline. UI-CHECKLIST §4.5 makes it a pass/fail item |
| Block IDs drift on split/merge, detaching Phase 3 comments and Phase 5 citations | Med | Lifecycle rules fixed here with property tests over edit sequences; superseded IDs recorded, never silently dropped |
| Custom wiki-link and tag syntax extensions break CommonMark edge cases | Med | Both directions corpus-covered; extensions must not alter parsing of text that was valid before them |
| Backlinks or mention autocomplete leak the existence of unreadable pages | Med | Every graph and mention query resolves through `can()`; covered by tests written from the unauthorised subject's point of view |
| "In CI" is not enforceable — the repo has no remote (known gap) | High | GATE-2 lands in `bun run test` and in `.github/workflows/ci.yml`, and is added to `bun run verify`. State plainly which of those actually runs today |
| `packages/core` purity check may reject even a type-only `@types/mdast` import | Med | Verify against `scripts/checks/core-purity.ts` before designing any core-side content entity; if it rejects, keep mdast types entirely inside `packages/markdown` |
| Chunk boundaries change after Phase 5 indexes them | Med | Determinism is a Phase 2 requirement with its own test, and boundaries are versioned so a change is an explicit reindex, not a silent drift |

## Rollback Plan

1. **Editor**: revert the Milkdown work units. Read mode is independent by construction and continues to serve cached HTML; the product degrades to read-only rather than breaking.
2. **Pipeline**: `packages/markdown` reverts to `parse`/`stringify`. Every consumer imports it through a single entry point, so the blast radius is import-level and typecheck finds it immediately.
3. **Schema**: every migration ships a tested `down`, applied in reverse (`links`/`page_tags`/`tags` → lock table → block index → page content). Derived tables (`links`, `tags`, `page_tags`) are rebuildable from markdown by reparsing, so dropping them loses no user data.
4. **Content**: page markdown is the only irreplaceable artefact. Any migration touching it must be additive; the cached render and block index are derived and regenerable.
5. **Dev reset**: `podman compose down -v` and re-bootstrap.
6. No production deployment exists, so the practical path is roll-forward with a corrective migration.

## Dependencies

- Phase 1 merged: the `nodes` tree, `can()`, and `workspace_id` on every tenant-scoped table. Phase 2 hangs content off that tree.
- `remark-gfm` (tables, footnotes) and custom micromark/mdast extensions for wiki-links and tags.
- Milkdown and its ProseMirror peers, currently absent from `packages/editor`.
- **Sequencing**: GATE-2 green before any editor UI work unit starts.

## Success Criteria

- [ ] GATE-2 is green across the full corpus, and no Milkdown code reached a user-facing screen before it was
- [ ] Every corpus class is either modelled or carried verbatim; unrepresentable content refuses edit mode with a stated reason rather than opening and dropping it
- [ ] Removing any pinned serialiser option makes a named fixture fail
- [ ] Exactly one markdown parser exists in the repository; the editor, the API and the chunker all import `packages/markdown`
- [ ] A read-mode page view loads no ProseMirror bundle, proven by a test over build output
- [ ] Block IDs survive edits above, splits and merges, with superseded IDs recorded rather than dropped
- [ ] The soft lock expires on silence without any presence channel, and both "take over" and "open read-only" are always offered
- [ ] `links` is rebuilt (replaced, not patched) on every save and is never written outside the parser
- [ ] Backlinks, mentions, tags and the tree disclose nothing about pages the subject cannot read
- [ ] Chunking is deterministic and every chunk carries `workspace_id` and its block IDs
- [ ] Each new screen passed the owner's UI review against `docs/UI-CHECKLIST.md` and `docs/DESIGN-SYSTEM.md`
- [ ] `bun run check`, `bun run test`, `bun run typecheck`, `bun run lint` all green
