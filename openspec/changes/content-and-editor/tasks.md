# Tasks: Content and the Editor (Phase 2)

> This artifact exceeds the nominal size budget by explicit necessity, the same
> justification `design.md` already recorded: 62 requirements across 7 capabilities
> plus a `ci-pipeline` delta, a 19-block-anchor lifecycle, GATE-2's byte-identity
> corpus, and a strict-RED/GREEN breakdown cannot stay traceable at a shorter length
> without becoming unverifiable.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | High — first content schema (3 migrations, 5 tables), a real ProseMirror schema + Milkdown wiring, the markdown pipeline's extensions/classifier/chunker, 2 new structural checks, 3 human-gate UI screens, and the GATE-2 corpus |
| 400-line budget risk | High |
| Chained PRs recommended | No — `delivery_strategy: single-pr` explicitly forbids chained/stacked PRs |
| Suggested split | Single PR, 19 ordered commits (work units below), `size:exception` |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High
```

`openspec/config.yaml` sets `review.budget_lines: unlimited` with
`accepted_exception: "size:exception"` already recorded, and the session config
confirms it is accepted up front. No further decision gate blocks `sdd-apply`;
`design.md`'s Work Units table already treats the High risk as accepted under this
strategy.

### Suggested Work Units

| # | Goal | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| 1 | Canonical form + pin coverage/efficacy | `bun run -F @deep-wiki/markdown test` | N/A — pure functions | `canonicalise` + `PINNED_OPTIONS` + `fixtures/pins/` |
| 2 | GFM + wiki-link/tag/block-anchor extensions | `bun run -F @deep-wiki/markdown test` | N/A | `src/extensions/` + corpus fixtures |
| 3 | Block identity, split/merge, derived index | `bun run -F @deep-wiki/markdown test` | N/A | `match-blocks.ts`, `block-index.ts` |
| 4 | Deterministic chunk boundaries + goldens | `bun run -F @deep-wiki/markdown test` | N/A | `chunk.ts` + goldens |
| 5 | Sanitised HTML render, separate from storage | `bun run -F @deep-wiki/markdown test` | N/A | `render.ts` |
| 6 | ProseMirror schema + bucket classification | `bun run -F @deep-wiki/editor test` | N/A | `schema.ts`, `classify.ts` |
| 7 | **GATE-2** — byte-identical PM round trip | `bun run -F @deep-wiki/editor test` | N/A — pure functions | `from-markdown.ts`, `to-markdown.ts`, `probe.ts` |
| 8 | Page content + block registry behind typed FK | `bun run -F @deep-wiki/db test content` | Real Postgres (auto-provisioned) | migration `0008` + `packages/core/src/content/` |
| 9 | Derived `links`/tags replaced wholesale on save | `bun run -F @deep-wiki/db test content` | Real Postgres | migration `0009`, `src/content/` |
| 10 | Soft lock, server-evaluated expiry, takeover | `bun run -F @deep-wiki/db test locks` | Real Postgres | migration `0010`, `src/locks/` |
| 11 | Set-shaped permission folds for list endpoints | `bun run -F @deep-wiki/db test permissions/can-many` | Real Postgres | `decide-many.ts`, `can-many.ts` |
| 12 | Page read/save behind `can()`, optimistic lock | `bun run -F @deep-wiki/api test routes/pages` | Real Postgres | `routes/pages.ts` |
| 13 | Backlinks/tags/mentions that disclose nothing | `bun run -F @deep-wiki/api test routes` | Real Postgres | `routes/{links,tags,mentions}.ts` |
| 14 | Bundle isolation + parser denylist extension | `bun test scripts/checks` | N/A — static analysis | `scripts/checks/bundle-isolation.ts`, `single-parser.ts` edit |
| 15 | **Human gate** — read mode from cached HTML | `bun run -F @deep-wiki/web test` + `playwright test e2e/read.spec.ts` | Full stack (Playwright) + real `nuxt build` | `apps/web` read route |
| 16 | **Human gate** — Milkdown edit mode | `bun run -F @deep-wiki/web test` + `playwright test e2e/editor.spec.ts` | Full stack (Playwright) | `apps/web` edit route, `packages/editor/src/mount/` |
| 17 | **Human gate** — navigation tree | `bun run -F @deep-wiki/web test` + `playwright test e2e/tree.spec.ts` | Full stack (Playwright) | `apps/web` tree component |
| 18 | GATE-2 as a named CI step | `bun test scripts/checks` (workflow shape) | N/A — CI config, unexecuted locally (no remote) | `.github/workflows/ci.yml` |
| 19 | Docs sync | N/A — docs only | N/A | doc diffs only |

---

## GATE-2 — binding sequencing

`docs/TODO.md` and the proposal mark GATE-2 as a hard gate: **the byte-identity
suite through the real ProseMirror schema (WU-7) must be green before any Milkdown
code reaches a screen.** Per `design.md`'s own Work Units table this reads even
stricter: **WU-7 must be green before WU-15 begins** — "pipeline first, gate second,
editor third, UI last" gates the *entire* web surface, not only the editor screen,
because the read route also serves content produced by this pipeline. WU-16 is
additionally blocked on WU-14 (bundle isolation) being green. No Milkdown dependency
is installed before WU-16, so the sequencing constraint is enforced by the
dependency graph, not only by intent.

---

## Phase 1 (WU-1) — `feat(markdown): canonical form with pinned spelling options and pin coverage`

- [x] 1.1 RED — `packages/markdown/src/index.test.ts`: `canonicalise(md)` is idempotent
      across every corpus fixture, including deliberately non-canonical ones.
- [x] 1.2 RED — `packages/markdown/fixtures/pins/pin-<k>.md` coverage test: a fixture
      must exist for every key in `PINNED_OPTIONS` (`bullet`, `emphasis`,
      `bulletOrdered`, `fence`, `fences`, `listItemIndent`, `rule`, `strong`,
      `tightDefinitions`, `resourceLink`, `setext`); reads the object's keys so it
      cannot drift. *(markdown-round-trip: Pinned Serialiser Options Are
      Test-Enforced — coverage half)*
- [x] 1.3 RED — pin-efficacy test: removing the bullet-marker pin makes
      `pin-bullet.md` fail, naming it as the cause. *(markdown-round-trip: Removing
      a pin fails a named fixture)*
- [x] 1.4 GREEN — implement `packages/markdown/src/index.ts`: export the grown
      `PINNED_OPTIONS`, `canonicalise()`.

## Phase 2 (WU-2) — `feat(markdown): gfm, wiki-links, tags and block anchors in the one pipeline`

- [x] 2.1 RED — `src/extensions/wiki-link.test.ts`: plain/aliased/anchored forms;
      resolved target carries page identity, unresolved retains raw text.
      *(markdown-pipeline: Wiki-Link Parsing And Normalisation, both scenarios)*
- [x] 2.2 RED — `src/extensions/tag.test.ts`: `#tag` distinguished from a `#`
      heading and from code content. *(markdown-pipeline: Tag Parsing)*
- [x] 2.3 RED — `src/extensions/block-anchor.test.ts`: trailing ` ^id` parses to a
      `blockAnchor` mdast node; `\^` escape preserved; both spellings fixture-covered.
- [x] 2.4 RED — `remark-gfm` wiring test: table syntax parses with rows/alignment;
      `[text](url)` still parses as a standard link with the wiki-link extension
      enabled. *(markdown-pipeline: GFM And Custom Syntax Extensions, both scenarios)*
- [x] 2.5 GREEN — implement `src/extensions/{wiki-link,tag,block-anchor}.ts`; wire
      `remark-gfm` into `src/index.ts`.
- [x] 2.6 Corpus — create `packages/markdown/fixtures/{modelled,verbatim,refused}/`;
      move the existing 7 fixtures into `modelled/`; add nested-list (mixed marker,
      loose/tight), ragged table, fence with/without a language hint, footnote
      (placement/ordering), hard break (both spellings), entity+escape, mixed/nested
      emphasis+strong, wiki-link (resolved/unresolved/anchored), tag-adjacent-heading,
      block-anchor, and Mermaid/D2 diagram-fence fixtures to `modelled/`; raw HTML
      block+inline, reference link/image, and YAML frontmatter to `verbatim/`; setext
      heading, indented code block, and one non-canonical spelling per pinned option
      to `refused/`.
- [x] 2.7 RED — mdast-level round-trip regression (`canonicalise` is a fixed point)
      across the grown corpus; superseded by WU-7's ProseMirror-level suite but
      catches a pipeline-only regression earlier.

## Phase 3 (WU-3) — `feat(markdown): block identity, split/merge matching and the derived index`

- [x] 3.1 RED — `src/match-blocks.test.ts`: property tests over generated edit
      sequences (insert-above, split, merge, delete, reorder, edit-in-place); a
      persisted id ends `active` on a block scoring ≥ τ, or ends
      `superseded`/`tombstoned` — never `active` below τ. *(markdown-pipeline: Block
      Split Assigns The Original ID, Block Merge Keeps One ID x2, Block Delete
      Tombstones The ID)*
- [x] 3.2 RED — derived-identity test: an unreferenced document assigns no persisted
      IDs; `d:` + 12-hex-`sha256` + `#n` is stable under edits above the block.
      *(markdown-pipeline: Block IDs Are Assigned Lazily, scenario 1)*
- [x] 3.3 RED — minting test: first reference mints a 10-char Crockford base32 id
      from `crypto.getRandomValues`, checked unique against the page's registry.
      *(markdown-pipeline: Block IDs Are Assigned Lazily, scenario 2)*
- [x] 3.4 RED — `src/block-index.test.ts`: the index reflects every persisted anchor,
      and every persisted anchor appears in the index, both directions.
      *(markdown-pipeline: Block Index And In-Text Anchors Stay In Sync)*
- [x] 3.5 GREEN — implement `src/{match-blocks,block-index}.ts`.
- [x] 3.6 **Decision task** — record `τ = 0.5` as a judgement, not a measurement, in
      a code comment on the constant in `match-blocks.ts` and a `docs/TODO.md`
      Finding: state the bias (an orphan is preferred over a misattribution) and the
      reversal criterion — a measured mis-assignment rate at τ from real edit
      traffic, per `design.md` D8's "What would reverse it".

## Phase 4 (WU-4) — `feat(markdown): deterministic chunk boundaries with golden files`

- [x] 4.1 RED — `src/chunk.test.ts`: `chunk(x)` run twice is deep-equal; no chunk
      boundary falls inside a block; an oversized block becomes its own chunk rather
      than being cut mid-content. *(markdown-pipeline: Deterministic Chunk
      Boundaries, both scenarios)*
- [x] 4.2 RED — one golden chunk file per corpus fixture; a boundary change must
      produce a visible golden diff in review.
- [x] 4.3 GREEN — implement `src/chunk.ts`.

## Phase 5 (WU-5) — `feat(markdown): sanitised html rendering separate from canonical storage`

- [x] 5.1 RED (executable-file/active-content threat matrix) — `src/render.test.ts`:
      a fixture containing `<script>`, an `onerror` attribute, and a `javascript:`
      href round-trips byte-identical in Markdown **and** renders inert HTML.
- [x] 5.2 RED — URL-scheme allowlist test for `link` and `image` targets.
- [x] 5.3 GREEN — implement `src/render.ts` (`remark-rehype` + `rehype-sanitize`,
      explicit allowlist; sanitising at render time only, never at save — D12).

## Phase 6 (WU-6) — `feat(editor): prosemirror schema with verbatim carry and bucket classification`

- [x] 6.1 RED — `packages/editor/src/schema.test.ts`: bucket-A node/mark shapes
      (paragraph, heading, blockquote, list/listItem, code, thematicBreak, table
      family, footnote family, break, marks, `wikiLink`, `tag`; `blockAnchor` as a
      block attr) and the bucket-B `verbatim`/`verbatimInline` atoms (`raw: string`,
      `atom: true`, `selectable: true`, `contentEditable=false`).
- [x] 6.2 RED — `src/classify.test.ts`: `classify()` walks the mdast tree and asks
      the schema whether it names each node type — moving a node's schema membership
      must move which fixture directory it belongs in.
- [x] 6.3 GREEN — implement `src/schema.ts`, `src/classify.ts`.

## Phase 7 (WU-7) — `feat(editor): GATE-2 — byte-identical markdown round trip across the corpus`

> **GATE-2 lands here.** Must be green before WU-15 begins (see "GATE-2 — binding
> sequencing" above).

- [x] 7.1 RED — `src/round-trip.ts` becomes the real `md → PM doc → md` harness,
      calling `packages/editor`'s `fromMarkdown`/`toMarkdown` (which reuse
      `packages/markdown` for their Markdown-side work), not only
      `packages/markdown`'s `parse`/`stringify`; a footnote fixture that a naive
      mdast-only round trip would pass but the schema does not yet model must fail
      the suite. *(markdown-round-trip: Round Trip Exercises The ProseMirror Schema,
      both scenarios)*
- [x] 7.2 RED — every `modelled/` fixture round-trips byte-identical through the PM
      doc: nested lists (mixed marker + loose/tight), ragged GFM tables, fences
      with/without a language hint (fence character preserved), footnotes (placement
      preserved), hard breaks (both spellings preserved distinctly), entities and
      escapes (kept distinct), mixed/nested emphasis and strong (pinned delimiters at
      every level), wiki-links (anchored, unresolved, alias), tags (adjacent to a
      heading), the block-anchor syntax itself, and diagram fences (Mermaid/D2,
      untouched). *(markdown-round-trip: the 12 corpus-class preservation
      requirements, table-driven over `modelled/`)*
- [x] 7.3 RED — every `verbatim/` fixture (raw HTML block/inline, reference
      links/images, YAML frontmatter) round-trips byte-identical and `classify()`
      reports `verbatim` naming the carried node type. *(markdown-round-trip: Raw
      HTML Preservation, scenario 1)*
- [x] 7.4 RED — every `refused/` fixture (setext heading, indented code block, one
      non-canonical spelling per pin) makes the probe return `refused` with the
      expected reason code. *(markdown-round-trip: Unsupported HTML refuses edit
      mode; Unrepresentable Content Fails Closed, both scenarios)*
- [x] 7.5 RED — pin-removal regression at the PM level: removing the bullet-marker
      pin fails the same named fixture through the full editor round trip, not only
      WU-1's mdast-level test.
- [x] 7.6 GREEN — implement `src/{from-markdown,to-markdown,probe}.ts`; finish the
      `round-trip.ts` rewrite from 7.1.
- [x] 7.7 Verify — 7.1–7.5 fully green across `modelled/`, `verbatim/`, `refused/`.
      **GATE-2 complete; unlocks WU-15 and WU-16.**

## Phase 8 (WU-8) — `feat(db): page content and the block registry behind a page-typed foreign key`

- [x] 8.0 RED/GREEN (structural, precedes any core content entity) — close the
      core-purity type-import elision gap: a scratch fixture with
      `import type { Node } from 'mdast'` inside `packages/core/src` currently
      passes both `scripts/checks/core-purity.ts`'s `scanImports()` sweep (which
      elides type-only imports) and its manifest zero-`dependencies` check (an
      `@types/mdast` devDependency isn't scanned, and a hoisted workspace
      `node_modules` can resolve the type with no manifest entry at all). Extend
      `core-purity.ts` with a supplementary regex sweep over `import type …
      from`/`export type … from` specifiers so the fixture fails, then delete the
      fixture. This is what makes D19 ("no mdast type crosses into core") verified
      rather than assumed.
- [x] 8.1 RED — `packages/core/src/content/*.test.ts`: `BlockId`, `BlockStatus`,
      `PageContentRef` primitives; `ContentStore`/`BlockRegistry` port-contract tests
      against stub implementations — no mdast type anywhere.
- [x] 8.2 GREEN — implement `packages/core/src/content/*.ts`; export from index;
      `core-purity` and `single-parser` stay green.
- [x] 8.3 RED — `packages/db/src/schema.test.ts` additions: `nodes` gains
      `UNIQUE (id, workspace_id, type)`; content on a non-`page` node type is
      rejected by the three-column FK; `page_blocks`
      `UNIQUE (page_id, block_id)` spans every status so a tombstoned id cannot be
      reused. *(page-content: Row without a workspace rejected; design D10)*
- [x] 8.4 GREEN — `packages/db/drizzle/0008_page_content.sql` (+ tested `down`): the
      unique constraint, `page_content`, `page_blocks`; `migration.test.ts` asserts
      both tables and the FK exist after `migrate()`.
- [x] 8.5 RED — `save-page.test.ts`: saving persists the submitted Markdown
      unchanged; re-saving overwrites with no historical row; save regenerates
      `rendered_html` and `block_index` from the new content, never accepted as
      client-supplied input. *(page-content: Saving persists unchanged; Single
      Current Row; Save Regenerates Render/Index, both scenarios)*
- [x] 8.6 RED — `read-page.test.ts`: a read-mode request returns cached HTML without
      invoking the parser; an edit-mode request returns canonical Markdown.
      *(page-content: Read Mode And Edit Mode Read Different Representations, both
      scenarios)*
- [x] 8.7 GREEN — implement `packages/db/src/content/{save-page,read-page}.ts`.

## Phase 9 (WU-9) — `feat(db): derived links and tags replaced wholesale inside the save transaction`

- [x] 9.1 RED — save-transaction test: `links` rows sourced from a page are fully
      replaced (not patched) on save, including full removal when a link is dropped;
      an unresolved wiki-link does not fail the save and records no resolved target.
      *(knowledge-graph: Links Are Rebuilt Not Patched, both scenarios; Wiki-Link To
      A Non-Existent Page Resolves As Unresolved)*
- [x] 9.2 RED — tags/`page_tags` replaced wholesale on save: a new tag is created; a
      removed tag drops its association. *(knowledge-graph: Tags And Page-Tag
      Associations Are Rebuilt On Save, both scenarios)*
- [x] 9.3 RED — a direct write to `links` outside the save pipeline is rejected by
      the extended `scripts/checks/query-boundaries.ts` rule. *(knowledge-graph:
      Links Are Never User-Editable Directly)*
- [x] 9.4 GREEN — `packages/db/drizzle/0009_knowledge_graph.sql` (+ tested `down`):
      `links`, `tags`, `page_tags`; extend `src/content/{save-page,rebuild-derived}.ts`
      to reconcile `page_blocks` via `matchBlocks`, replace `links`/`page_tags`, and
      write `rendered_html`, all in one transaction.
- [x] 9.5 GREEN — extend `scripts/checks/query-boundaries.ts`: a `links`/`page_tags`
      write-boundary rule (only `packages/db/src/content/` may write them), in the
      idiom already used for `permissions`.

## Phase 10 (WU-10) — `feat(db): soft lock with server-evaluated expiry and explicit takeover`

- [ ] 10.1 RED — `page-lock.test.ts`: first entry with no active lock creates one
      naming the holder; a second user cannot silently seize an active lock; a
      heartbeat before expiry extends the window; a lock heartbeated past TTL is
      reported expired on the next read with no sweeper job, and this holds even
      with no presence channel running. *(document-modes: Acquires A Soft Lock On
      Entry, both scenarios; Heartbeat Keeps The Lock Alive; Lock Expiry Is
      Evaluated Server-Side On Read, both scenarios)*
- [ ] 10.2 RED — take-over transfers the holder; the prior holder's next heartbeat
      returns `lost`; read-only entry takes no lock and leaves an existing lock's
      holder/heartbeat unchanged. *(document-modes: "Take Over" transfers the lock;
      Read-Only Entry Takes No Lock)*
- [ ] 10.3 RED — two concurrent acquisitions: the atomic
      `INSERT … ON CONFLICT … RETURNING` guard returns zero rows for the loser —
      no read-then-write race.
- [ ] 10.4 GREEN — `packages/db/drizzle/0010_page_locks.sql` (+ tested `down`);
      `packages/db/src/locks/page-lock.ts`.
- [ ] 10.5 RED — `packages/contracts/src/env.test.ts`: `PAGE_LOCK_TTL_SECONDS`,
      `PAGE_LOCK_HEARTBEAT_SECONDS` parse with sane defaults.
- [ ] 10.6 GREEN — extend `env.ts` + `env.example`; `bun run scripts/checks/env-example.ts`
      green.

## Phase 11 (WU-11) — `feat(core,db): set-shaped permission folds for list endpoints`

- [ ] 11.1 RED — `decide-many.test.ts`, differential against Phase 1's `decide()`:
      `decideMany()` folds each group exactly as `decide()` folds one, for
      identical inputs.
- [ ] 11.2 GREEN — `packages/core/src/permissions/decide-many.ts`.
- [ ] 11.3 RED — `can-many.test.ts`: `canManyResources` returns ≤10
      `(origin_id, effect, depth)` rows per candidate from one recursive CTE seeded
      from `unnest($resourceIds)`; `canManySubjects` inverts it (≤5 rows per
      resource's ancestor chain); exactly one SQL statement is issued (no N+1).
- [ ] 11.4 GREEN — `packages/db/src/permissions/{can-many,readable}.ts`.

## Phase 12 (WU-12) — `feat(api): page read and save with optimistic concurrency behind can()`

- [ ] 12.1 RED — `routes/pages.test.ts` (`app.request()`): read without a `read`
      grant returns no content; save without a `write` grant leaves storage
      unchanged; a stale `content_hash` returns `409` without writing. *(page-content:
      Content Access Goes Through can(), both scenarios; design D16)*
- [ ] 12.2 RED — `GET /pages/:id/edit-session`: returns the doc when
      `toMarkdown(fromMarkdown(md)) === md`, else `409 { reason, construct, line,
      offeredExits }`; the lock is acquired atomically together with the probe
      check, in the same request. *(markdown-round-trip: Refusal states a reason;
      Read-only remains available)*
- [ ] 12.3 GREEN — implement `apps/api/src/routes/pages.ts`.

## Phase 13 (WU-13) — `feat(api): backlinks, tags and mention candidates that disclose nothing`

- [ ] 13.1 RED — `routes/links.test.ts`: backlinks filtered through
      `canManyResources(read)`; an unreadable source page is absent with no title or
      existence leaked; counts are computed post-filter. *(knowledge-graph:
      Backlinks Resolve Through can(), both scenarios)*
- [ ] 13.2 RED — `routes/mentions.test.ts`: page/user/cell mention candidates
      filtered through `can()`; a query matching only an unreadable page or user
      returns nothing, checked with `expectNoDisclosure` from the unauthorised
      subject's point of view. *(document-editor: Mention Autocomplete Is Filtered
      By can(); knowledge-graph: Link And Mention Autocomplete Never Discloses)*
- [ ] 13.3 RED — `routes/tags.test.ts`: tag-filtered listing excludes an unreadable
      tagged page. *(knowledge-graph: Tag-Filtered Navigation Resolves Through
      can())*
- [ ] 13.4 RED — an unreadable link target renders identically to a non-existent
      one. *(knowledge-graph: Unresolved-Link Rendering Does Not Disclose Existence)*
- [ ] 13.5 RED — mentioning a user with no read access surfaces the mismatch rather
      than completing silently; mentioning a user with access proceeds normally.
      *(document-editor: Mentioning A User Does Not Silently Grant Them Access, both
      scenarios)*
- [ ] 13.6 GREEN — implement `apps/api/src/routes/{links,tags,mentions}.ts`.

## Phase 14 (WU-14) — `feat(checks): read mode can never reach the prosemirror bundle`

- [ ] 14.1 RED — `bundle-isolation.test.ts` against violating fixtures: the
      transitive closure of `packages/editor/src/index.ts` reaching `milkdown`,
      `@milkdown/*`, `prosemirror-*`, or `@tiptap/*`; an eager static import of
      `@deep-wiki/editor/mount` from `apps/web` (only dynamic `import()` allowed).
      *(document-modes: An eager shared import fails the test)*
- [ ] 14.2 GREEN — `scripts/checks/bundle-isolation.ts`; add it to `bun run check`
      and a `check:bundle` script.
- [ ] 14.3 GREEN — extend `scripts/checks/single-parser.ts`'s `FORBIDDEN_SPECIFIERS`
      with `milkdown`/`@milkdown/` before any Milkdown package is installed
      (`packages/editor/` stays the sole owner via the existing `PARSER_OWNERS`
      list). This closes a real gap distinct from D14's existing `@tiptap`/`@nuxt/ui`
      denylist: nothing today stops a stray `milkdown` import outside
      `packages/editor` from passing `single-parser.ts`.
- [ ] 14.4 GREEN — split `packages/editor/package.json` `exports`: `"."` → schema,
      `classify`, `fromMarkdown`, `toMarkdown` (deps: `@deep-wiki/markdown` only);
      `"./mount"` → the Milkdown surface; `src/index.ts` must never re-export
      `./mount`.
- [ ] 14.5 Record — `docs/TODO.md` Finding: layer 2 (this specifier check) runs
      today inside `bun run check`; layer 3 (the build-manifest test, WU-15.3) needs
      a CI step this repository's remote-less state cannot execute — enforcement is
      local `bun run check` at every commit and `bun run verify` before tagging,
      stated plainly rather than implied.

## Phase 15 (WU-15) — `feat(web): read mode served from cached html`

> **Human gate (new UI).** GATE-2 (WU-7) must be green before this unit starts.

- [ ] 15.1 Read `docs/UI-CHECKLIST.md` and `docs/DESIGN-SYSTEM.md` in full before
      writing any markup, per `CLAUDE.md`.
- [ ] 15.2 RED — Vitest + `@nuxt/test-utils` + Playwright (`e2e/read.spec.ts`): the
      read route renders cached HTML with the parser not invoked; required states,
      accessibility floor, and responsive behaviour per checklist §4.5.
      *(document-modes: Read Mode Serves Pre-Rendered HTML Without Reparsing;
      page-content: Read mode request returns cached HTML)*
- [ ] 15.3 RED — build-output test: after a real `nuxt build`, the read route's
      client-manifest entry chunk and its **static** `imports` (not
      `dynamicImports`) contain no module id matching `/prosemirror|milkdown|tiptap/`.
      *(document-modes: ProseMirror Bundle Isolation Is Verified By Build Output)*
- [ ] 15.4 GREEN — implement the read route in `apps/web`; add the build-output
      check as a CI step after the `nuxt build` step in `.github/workflows/ci.yml`
      and as `bun run check:bundle` locally — the only place this assertion
      actually runs today, per 14.5.
- [ ] 15.5 **Owner-review checkpoint** — stop; do not proceed to WU-16 until the
      owner reviews the read-mode screen against `docs/UI-CHECKLIST.md` and
      `docs/DESIGN-SYSTEM.md`.

## Phase 16 (WU-16) — `feat(web): edit mode — milkdown, live preview, mentions and slash commands`

> **Human gate (new UI); blocked until WU-7 and WU-14 are green.**

- [ ] 16.1 Read `docs/UI-CHECKLIST.md` §4.6 and `docs/DESIGN-SYSTEM.md` in full
      before writing any markup.
- [ ] 16.2 RED — component + `e2e/editor.spec.ts`: live preview renders inline with
      no separate pane; typing does not steal focus or reflow (preview as
      `Decoration`s only, `addToHistory: false`, async node views reserve height);
      a caret-stability assertion — type below a heading, caret viewport position
      unchanged after the live-preview re-render. *(document-editor: Live Preview
      Renders In Place; Live Preview Does Not Steal Focus Or Reflow Content)*
- [ ] 16.3 RED — mention/slash menus: arrow-key navigation, Enter selects, Escape
      dismisses and restores focus/cursor position; a visible selected state
      distinct from hover; reposition near viewport edges; inert inside a code
      block; distinct empty-query and no-results states; undo removes a whole
      mention/slash insertion as one step. *(document-editor: the remaining 6
      requirements)*
- [ ] 16.4 RED — lock-contention e2e: entering edit mode while another holder is
      active shows both "take over" and "open read-only" simultaneously before the
      editor opens; take over states its consequence for the other person before it
      is confirmed. *(document-modes: "Take Over" And "Open Read-Only" Are Always
      Both Offered, both scenarios; UI-CHECKLIST §4.8)*
- [ ] 16.5 RED — refusal UI: the `edit-session` `409` from 12.2 renders the reason,
      the named construct and line, and both `read_only`/`normalise` exits — this is
      the in-product surfacing of the refused set (setext headings, indented code
      blocks) the proposal requires, not only a design-document list.
- [ ] 16.6 GREEN — implement `packages/editor/src/mount/*` (Milkdown surface,
      mention/slash plugins) and the `apps/web` edit route wired to WU-12's routes.
- [ ] 16.7 **Owner-review checkpoint** — stop; do not proceed to WU-17 until the
      owner reviews the edit-mode screen, menus, and refusal UI against the
      checklist and design system.

## Phase 17 (WU-17) — `feat(web): navigation tree with drag reordering`

> **Human gate (new UI).**

- [ ] 17.1 Read the checklist and design system in full before writing markup.
- [ ] 17.2 RED — component + `e2e/tree.spec.ts`: the tree includes only readable
      nodes (an unreadable chapter and its pages are absent); drag-reorder persists
      distinct sibling `position` values; a cross-workspace drag target is rejected
      without changing `workspace_id`; a read-only subject cannot reorder (no
      `position` change). *(navigation-tree: all 3 requirements, 4 scenarios)*
- [ ] 17.3 GREEN — implement the tree UI in `apps/web`, backed by a
      `can()`-filtered tree endpoint.
- [ ] 17.4 **Owner-review checkpoint** — stop; do not proceed to WU-18 until the
      owner reviews the tree screen against the checklist and design system.

## Phase 18 (WU-18) — `feat(ci): GATE-2 as a named, independently identifiable gate`

- [ ] 18.1 RED — a workflow-shape assertion (or script test over
      `.github/workflows/ci.yml`) confirming the GATE-2 suite runs as a distinctly
      named step, separate from the general test command's pass/fail signal.
      *(ci-pipeline: GATE-2 Is A Named, Independently Identifiable Gate, both
      scenarios)*
- [ ] 18.2 GREEN — `.github/workflows/ci.yml`: add a named `gate-2-round-trip` step
      running WU-7's suite explicitly, ordered so a change wiring Milkdown while
      GATE-2 is red fails the overall run citing GATE-2; add GATE-2 to
      `bun run verify`. *(ci-pipeline: GATE-2 Precedes Editor UI Delivery)*

## Phase 19 (WU-19) — `docs: record the pipeline, the pin finding, the supported set and the accepted costs`

- [ ] 19.1 `docs/TODO.md` Findings: add the `remark-stringify` list/emphasis pin
      entry (per the proposal's correction — recorded in code and in Phase 0's
      archived tasks, but not yet in this log).
- [ ] 19.2 `docs/TODO.md` Findings: cross-reference the τ = 0.5 judgement (3.6);
      record `pipeline_version` coupling render and chunk versions as an accepted
      cost, and what a two-column split would take (design D11); record the
      bundle-isolation CI gap plainly — layer 2 runs today, layer 3 needs a step
      this repository's remote-less state cannot execute (cross-ref 14.5).
- [ ] 19.3 `docs/SPECS.md`: update the GATE-2 status line to SATISFIED with date;
      document the supported/refused construct set (§3.3/§5.1) as the user-facing
      reference the WU-16.5 refusal UI links to.
- [ ] 19.4 `docs/TODO.md`: tick Phase 2's roadmap bullets against what shipped.
- [ ] 19.5 Run `bun run verify` (`check && lint && typecheck && test`) green on the
      full branch before requesting owner review.

---

## Traceability Matrix (62 requirements → tasks)

| Capability | Requirement | Task(s) |
|---|---|---|
| markdown-round-trip | Round Trip Exercises The ProseMirror Schema | 7.1 |
| markdown-round-trip | Nested List Preservation | 7.2 |
| markdown-round-trip | GFM Table Preservation | 7.2 |
| markdown-round-trip | Code Fence Language Hint Preservation | 7.2 |
| markdown-round-trip | Footnote Preservation | 7.2 |
| markdown-round-trip | Raw HTML Preservation Or Fail-Closed Refusal | 7.3, 7.4 |
| markdown-round-trip | Hard Line Break Spelling Preservation | 7.2 |
| markdown-round-trip | Character Entity and Escape Preservation | 7.2 |
| markdown-round-trip | Emphasis and Strong Marker Preservation | 7.2 |
| markdown-round-trip | Wiki-Link Round Trip, Resolved and Unresolved | 7.2 |
| markdown-round-trip | Tag Round Trip | 7.2 |
| markdown-round-trip | Block-ID Anchor Syntax Round Trip | 2.3, 7.2 |
| markdown-round-trip | Diagram Fence Passthrough | 7.2 |
| markdown-round-trip | Pinned Serialiser Options Are Test-Enforced | 1.2, 1.3, 7.5 |
| markdown-round-trip | Unrepresentable Content Fails Closed | 7.4, 12.2 |
| markdown-round-trip | GATE-2 Precedes Editor UI Exposure | 7.7, GATE-2 note |
| markdown-pipeline | Single Markdown Parser Across The Repository | 2.5, 14.3 |
| markdown-pipeline | GFM/Custom Syntax Extensions Do Not Break CommonMark | 2.4 |
| markdown-pipeline | Block IDs Are Assigned Lazily | 3.2, 3.3 |
| markdown-pipeline | Block Index And In-Text Anchors Stay In Sync | 3.4 |
| markdown-pipeline | Block Split Assigns The Original ID | 3.1 |
| markdown-pipeline | Block Merge Keeps One ID And Supersedes | 3.1 |
| markdown-pipeline | Block Delete Tombstones The ID | 3.1 |
| markdown-pipeline | Wiki-Link Parsing And Normalisation | 2.1 |
| markdown-pipeline | Tag Parsing | 2.2 |
| markdown-pipeline | Deterministic Chunk Boundaries Carrying Block IDs | 4.1, 4.2 |
| page-content | Page Content Table Stores Canonical Markdown | 8.3, 8.5 |
| page-content | Single Current Row Per Page | 8.5 |
| page-content | Save Regenerates The Cached Render And Block Index | 8.5 |
| page-content | Read Mode And Edit Mode Read Different Representations | 8.6, 15.2 |
| page-content | Content Access Goes Through can() | 12.1 |
| document-editor | Live Preview Renders In Place | 16.2 |
| document-editor | Live Preview Does Not Steal Focus Or Reflow | 16.2 |
| document-editor | Mention And Slash Menus Are Keyboard-First | 16.3 |
| document-editor | No Menu Inside A Code Block | 16.3 |
| document-editor | Empty And No-Results States | 16.3 |
| document-editor | Menus Reposition To Stay In The Viewport | 16.3 |
| document-editor | Mention Autocomplete Is Filtered By can() | 13.2 |
| document-editor | Mentioning A User Does Not Silently Grant Access | 13.5 |
| document-editor | Mention And Slash Insertions Undo As One Step | 16.3 |
| document-modes | Read Mode Serves Pre-Rendered HTML Without Reparsing | 15.2 |
| document-modes | ProseMirror Bundle Isolation Verified By Build Output | 14.1, 15.3 |
| document-modes | Edit Mode Acquires A Soft Lock On Entry | 10.1 |
| document-modes | Heartbeat Keeps The Lock Alive | 10.1 |
| document-modes | Lock Expiry Is Evaluated Server-Side On Read | 10.1 |
| document-modes | "Take Over"/"Open Read-Only" Are Always Both Offered | 10.2, 16.4 |
| document-modes | Read-Only Entry Takes No Lock | 10.2 |
| knowledge-graph | Links Are Rebuilt, Not Patched, On Every Save | 9.1 |
| knowledge-graph | Links Are Never User-Editable Directly | 9.3 |
| knowledge-graph | Wiki-Link To A Non-Existent Page Resolves As Unresolved | 9.1 |
| knowledge-graph | Backlinks Resolve Through can() | 13.1 |
| knowledge-graph | Link And Mention Autocomplete Never Discloses | 13.2 |
| knowledge-graph | Unresolved-Link Rendering Does Not Disclose Existence | 13.4 |
| knowledge-graph | Tags And Page-Tag Associations Are Rebuilt On Save | 9.2 |
| knowledge-graph | Tag-Filtered Navigation Resolves Through can() | 13.3 |
| navigation-tree | Tree Displays Only Readable Nodes | 17.2 |
| navigation-tree | Drag Reorder Writes Back To Position | 17.2 |
| navigation-tree | Reordering Requires Write Or Manage Permission | 17.2 |
| ci-pipeline | GATE-2 Is A Named, Independently Identifiable Gate | 18.1, 18.2 |
| ci-pipeline | GATE-2 Precedes Editor UI Delivery | 18.2 |

## Open Items Resolved Into This Checklist

- `τ = 0.5`: recorded as a judgement with its bias and reversal criterion (3.6),
  not deferred as an unrecorded assumption.
- Refused-construct list (setext, indented code): surfaced in-product via the
  refusal UI (16.5), not only in `design.md`; the supported/refused set is also
  published in `docs/SPECS.md` (19.3).
- `pipeline_version` coupling render and chunk versions: accepted cost recorded,
  with the two-column split path stated (19.2).
- Bundle-isolation build-output assertion has no CI runner (no remote): enforcement
  is local `bun run check` per commit and `bun run verify` before tagging, recorded
  where it actually runs (14.5, 15.4, 19.2).
- Core-purity's `scanImports()` type-import elision: confirmed to be a real gap
  (not merely a theoretical one) and closed with a supplementary regex sweep (8.0),
  rather than left as an unverified assumption behind D19.
- `single-parser.ts`'s denylist: extended for `milkdown`/`@milkdown/` before
  installation (14.3); D14's existing `@tiptap`/`@nuxt/ui` denylist is not
  rescheduled, only extended.
