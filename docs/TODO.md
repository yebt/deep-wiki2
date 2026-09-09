# deep-wiki — Execution Log

Living working document. It outlives any single milestone: the roadmap says what is
still to build, the logs say what we learned and what we repaired along the way.

## How to use this file

This file has three working sections plus a parking lot.

1. **Roadmap** — phased checkbox lists of work to build. Tick a box only when the task
   is merged and its tests pass. Do not delete completed phases; they are the record of
   what shipped and in which order.
2. **Findings** — discoveries, gotchas and constraints hit while building. A finding is
   something the codebase did not tell us and that changes a decision. Newest first.
3. **Fixes** — defects found and repaired. Newest first. A fix that revealed a
   constraint should also leave a Finding behind.
4. **Open Questions** — decisions still owed. Move an entry out of this section the
   moment it is answered, and record the answer in Findings.
5. **Known gaps carried forward** — accepted, not fixed. Do not "clean up" one of these
   without discussion; it is there deliberately.

**Entry conventions**

- Roadmap items are `- [ ]` / `- [x]` checkboxes, grouped by phase.
- Log entries (Findings, Fixes) are dated `### YYYY-MM-DD — Short title`, newest first,
  and each carries an **Impact:** line stating what changes because of it.
- Keep task text concrete and actionable. "Improve permissions" is not a task;
  "Write the recursive-CTE resolver and its truth-table tests" is.
- When a phase task turns out to be wrong, strike it and add a Finding explaining why,
  rather than silently rewriting history.

---

## Status

_Last updated 2026-09-07._

| Phase | State |
| --- | --- |
| 0 — Foundations | Complete and archived (`openspec/changes/archive/2026-09-03-bootstrap-monorepo-foundations/`) |
| 1 — Tenancy and permissions | SDD change complete — 85/85 tasks, all 18 work units. GATE-1 satisfied. Owner-reviewed and approved (`docs/UI-CHECKLIST.md` Review Log). One broader roadmap item stays open past this change: Super Root plan-authoring admin route (see the unticked bullet below) |
| 2 — Content and editor | SDD change complete — 93/93 tasks, all 19 work units (`openspec/changes/content-and-editor/`). GATE-2 satisfied. One roadmap bullet stays partially shipped past this change: `/` slash commands cover heading/list/quote/code-block/divider only, not table/diagram-fence/callout/link-to-page (see the unticked bullet above) |
| 3–9 | Not started |

`openspec/changes/tenancy-and-permissions/` is ready to archive; see that change's
`tasks.md` for the full 18-work-unit breakdown and traceability matrix.

---

## Cross-cutting gates

These are hard gates. Work that depends on them does not start until they are green.

> **GATE-1 — Permission truth table before any UI.**
> The recursive-CTE permission resolver must have an exhaustive truth-table test suite
> (subject types x resource levels x allow/deny precedence) passing before a single
> permission-aware screen is built. Permission bugs discovered after the UI exists are
> found by users, not by tests.
>
> **Status: SATISFIED (2026-09-04).** The 30-case truth table (33 tests,
> `packages/db/src/permissions/truth-table.test.ts`) is green against real Postgres.
> Alongside it, `packages/db/src/permissions/resolver.explain.test.ts` proves the cost
> claim rather than assuming it: it fails on a sequential scan over `nodes` or
> `permissions`, and it asserts `enable_seqscan` is still `on` so the proof cannot be
> made vacuous by disabling the planner's seq-scan option.

> **GATE-2 — Markdown round-trip suite before the editor ships.**
> `markdown -> ProseMirror doc -> markdown` must be byte-identical across the full
> fixture corpus, running in CI, before Milkdown is wired into a user-facing screen.
> Markdown is the source of truth; a lossy serializer silently corrupts user documents.
>
> **Status: SATISFIED (2026-09-07).** `packages/editor/src/round-trip.ts` runs the
> real `markdown -> ProseMirror doc -> markdown` path (`from-markdown.ts`/`to-markdown.ts`
> against the actual schema, not only `packages/markdown`'s mdast-level `parse`/
> `stringify`). The corpus grew to the classes the gate exists to cover — nested lists,
> tables, code fences with and without a language hint, footnotes, hard breaks, entities
> and escapes, mixed emphasis, wiki-links, tags, the block-anchor syntax, diagram fences,
> raw HTML — split across `modelled/`/`verbatim/`/`refused/`; 69 fixture-driven tests
> green (`packages/editor/src/round-trip.test.ts`). The suite runs as a named,
> independently identifiable step (`gate-2-round-trip`) in `.github/workflows/ci.yml`
> and in `bun run verify` (WU-18). This repository has no git remote, so that workflow
> file itself never executes — enforcement today is local: `bun run check` at every
> commit, `bun run verify` before tagging.

> **GATE-3 — `workspace_id` filtered inside every vector query.**
> Tenant isolation in retrieval is a security boundary, not a convenience. The filter
> belongs in the SQL `WHERE` clause of the similarity search. Post-filtering results in
> application code is a data leak across tenants and must fail review.
>
> **Phase 1 groundwork:** every tenant-scoped table carries a non-nullable
> `workspace_id` (`packages/db/src/schema.ts`), tied in by composite foreign keys rather
> than left to a `WHERE` clause to remember — see `docs/SPECS.md` §14, "Tenant isolation
> by composite foreign key". The vector-query half of this gate is still open: no
> similarity search exists yet (Phase 5).

---

## Roadmap

### Phase 0 — Foundations

Monorepo, containers, CI. Nothing user-facing.

- [x] Initialise Bun 1.4 workspace monorepo: root `package.json` with `workspaces`,
      task orchestration via `bun run -F` (explicitly **not** pnpm, **not** Turborepo —
      revisit Turborepo only when build times measurably hurt).
- [x] Scaffold `apps/landing` (Astro) — marketing surface, no app dependencies.
- [x] Scaffold `apps/web` (Nuxt 4) — the application shell.
- [x] Scaffold `apps/api` (Hono on Bun) — adapters only, no domain logic.
- [x] Create `packages/core` — domain entities and use cases. Enforce **zero framework
      imports**: no Hono, no Nuxt, no Bun-specific APIs. Add a lint rule or dependency-cruiser
      check that fails CI on a framework import inside `packages/core`.
- [x] Create `packages/markdown` — placeholder for the shared unified/remark pipeline.
- [x] Create `packages/contracts` — shared request/response schemas, the single source of
      truth for the API surface consumed by `apps/web` and `apps/api`.
- [x] Create `packages/editor` — placeholder for Milkdown/ProseMirror integration.
- [x] Create `packages/db` — schema, migrations, and the query layer.
- [x] Write `compose.yaml` that runs unchanged under `podman compose` (local dev,
      Fedora) and `docker compose` (production).
- [x] Compose service: `postgres` with the `pgvector` extension enabled in an init script.
- [x] Compose service: `mailpit` (SMTP on 1025, web UI on 8025) for local mail capture.
- [x] Compose service: `minio` for S3-compatible object storage in dev.
- [x] Compose service: `kroki` for server-side diagram rendering, plus the
      `kroki-mermaid` companion container. The base image cannot render Mermaid, and
      Mermaid is the primary diagram format, so `kroki` must set
      `KROKI_MERMAID_HOST=mermaid` or the sidecar is never routed to.
- [x] Apply SELinux `:z` labels to every bind mount in `compose.yaml` (required on
      Fedora under podman; harmless under docker).
- [x] Keep all published host ports at 1024 or above so rootless podman can bind them.
- [x] Document the local bootstrap in `README.md`: clone, `bun install`, `podman compose up`,
      migrate, seed.
- [x] Base CI pipeline: install, typecheck, lint, unit tests, on every push.
- [x] Add the `packages/core` purity check to CI.
- [x] Define the `MailSender` and `BlobStore` port interfaces in `packages/core`
      (interfaces only — adapters land in Phase 1). They give `packages/core` real
      content to test and exercise the purity check against a genuine boundary.
- [x] Workspace-wide test command covering every package and app, with at least one
      real executing test per member — a placeholder that asserts nothing does not count.
- [x] Scoped Vitest + `@nuxt/test-utils` for `apps/web` only. Nuxt component tests
      cannot run under `bun test`; see Findings. Add a structural check asserting Vitest
      appears in exactly one workspace member so the second runner cannot spread.
- [x] Wire Playwright for e2e and prove it boots `apps/web` with one smoke test.
- [x] Ensure CI exercises the build of all three apps, not only the two front-ends.
- [x] Add `env.example` (copied to `.env` locally) and typed configuration loading that
      fails fast at startup with
      an actionable message naming the missing or malformed variable.
- [x] Re-resolve `strict_tdd` to `true` in `openspec/config.yaml` once the above lands.

### Phase 1 — Tenancy and permissions

The multi-tenant skeleton and the authorisation model. This phase is where the product
lives or dies; it is deliberately front-loaded.

- [x] Design and migrate the `nodes` table: `id`, `workspace_id`, `parent_id`, `type`
      (`workspace` | `shelf` | `book` | `chapter` | `page` — five values: the workspace
      is a real `nodes` row, not an implicit ancestor; see the Findings entry below),
      `position`, and a materialised path column stored as `text` for cheap subtree
      queries.
- [x] Index the path column with `text_pattern_ops` so prefix matching stays indexed.
      Deliberately not `ltree` + GiST — see the engine-portability decision.
- [x] Migrate `workspaces` with per-workspace settings (formats, defaults, AI config
      references, theme default).
- [x] Migrate `users`, `cells` (teams), and `cell_members`.
- [x] Migrate the Super Root concept: instance-level operator identity, distinct from any
      workspace membership.
- [ ] Migrate `plans` and per-workspace plan limits (workspace count per owner, seats,
      storage, AI token budget) — authored by Super Root. The `plans` table and the
      workspace-limit check landed (`packages/db/src/schema.ts`); there is no Super Root
      authoring path yet — no admin route creates or edits a plan.
- [x] Migrate the single `permissions` table:
      `(subject_type, subject_id, resource_id, action, effect)` where `subject_type` is
      `user` | `cell` | `role` | `agent` and `effect` is `allow` | `deny`. **Amended:**
      `resource_type` is deliberately not a column — it is `nodes.type` of `resource_id`;
      see the Findings entry below and `docs/SPECS.md` §14.
- [x] Implement the resolver as one recursive CTE that walks the resource ancestor chain
      via `parent_id` (never the derived `path` cache — see Findings) and returns the
      effective grant. Precedence: `deny` wins over `allow`; the most specific resource
      level wins over ancestors.
- [x] **GATE-1**: write the permission truth-table test suite covering every
      subject-type x resource-level x precedence combination, including inherited deny
      overriding a nearer allow, and cell membership overlapping a direct user grant.
      **Satisfied 2026-09-04** — see "Cross-cutting gates" above.
- [x] Expose a single `can(subject, action, resource)` entry point in `packages/core`.
      Every read and write path — HTTP, MCP, background jobs — goes through it. Super
      Root does not bypass `can()`; instance-level operations use a separate
      `canOperateInstance()` (see `docs/SPECS.md` §14).
- [x] Implement `registration_mode` as an instance setting: `closed` | `invitation_only` |
      `open`, defaulting to `invitation_only`.
- [x] Gate `open` mode behind a verified SMTP configuration; refuse to enable it otherwise
      so invitations and password resets cannot fail silently.
- [x] Add optional `open_registration_domains` allowlist for `open` mode.
- [x] Implement the `MailSender` SMTP adapter (port interface defined in Phase 0) and
      bind Mailpit in dev.
- [x] Implement the invitation flow: create invite, send mail, accept, join workspace with
      a starting permission set.
- [x] Implement the `BlobStore` adapters (port interface defined in Phase 0): S3-compatible
      (MinIO in dev) and local filesystem, selected by environment.
- [x] Implement profile photos on top of `BlobStore`, including upload validation and
      resizing.
- [x] Authentication: sessions, password reset over the `MailSender` port.
- [x] Sign-in, invitation-accept and password-reset **screens** in `apps/web` (WU-17).
      Built on Nuxt UI's `UAuthForm` per the "check the library first" rule
      (`AuthShell.vue` + `pages/{login,forgot-password,reset-password}.vue` and
      `pages/invite/accept.vue`), covered by 12 Playwright e2e tests
      (`e2e/auth.spec.ts`). Owner-reviewed and approved against
      `docs/UI-CHECKLIST.md`/`docs/DESIGN-SYSTEM.md` — see that checklist's Review Log
      for the findings raised and fixed during the review (CIE L\* tone conversion,
      `UFormField`'s missing `required` attribute, the `UMain` vertical-overflow
      defect).

### Phase 2 — Content and editor

The markdown pipeline and the two document modes.

- [x] Add page content storage to the schema. `page_content` (WU-8): canonical
      markdown, cached `rendered_html`, `block_index`, `content_hash`, `pipeline_version`.
- [x] Build `packages/markdown` as the single unified/remark pipeline, imported by the
      editor, the API and the future indexer. No second parser anywhere in the codebase.
- [x] Implement stable block IDs: every block-level node (paragraph, heading, list item,
      code fence, table) carries a persistent identifier that survives edits above it.
- [x] Implement wiki-link parsing and a normalised link representation.
- [x] Implement tag parsing.
- [x] Implement the chunking function used later by RAG, keyed on block IDs so retrieval
      citations resolve back to a real anchor in the document.
- [x] Build the markdown -> ProseMirror doc parser and the ProseMirror doc -> markdown
      serializer in `packages/editor`.
- [x] **GATE-2**: assemble the fixture corpus (nested lists, tables, code fences with
      language hints, mixed emphasis, footnotes, wiki-links, tags, diagram fences, HTML
      passthrough) and assert byte-identical round-trips in CI. Named CI step
      `gate-2-round-trip` (WU-18); this repository has no remote, so the workflow file
      itself never executes — enforcement is local (`bun run check` per commit,
      `bun run verify` before tagging).
- [x] Implement Read mode: markdown rendered to HTML at save time, cached, served without
      booting ProseMirror. This is the default mode and carries the majority of traffic.
- [x] Implement Edit mode with a soft lock: acquire on entry, heartbeat while open,
      expire on silence. Offer "take over" and "open read-only" rather than a hard block.
- [x] Implement `@` mentions in the editor (users and cells), resolving against the
      permission model so a user cannot mention someone into a document they cannot see.
- [ ] Implement `/` slash commands in the editor (insert heading, table, diagram fence,
      callout, link to page). Partially shipped (WU-16): heading levels 1–3, bulleted and
      numbered lists, quote, code block, divider. Table, diagram fence, callout, and
      link-to-page insertion are not implemented — left unticked rather than claiming the
      full bullet.
- [x] Derive and store the `links` table on every save; replace rows rather than patching.
      The graph is a projection of content and is never user-editable directly.
- [x] Implement backlinks as an index lookup over the derived `links` table.
- [x] Implement tag listing and tag-filtered navigation.
- [x] Implement the navigation tree UI over `nodes` (shelves, books, chapters, pages) with
      drag reordering writing back to `position` (WU-17).

### Phase 3 — Versioning, diffs, comments and presence

- [ ] Migrate `page_revision`: content snapshot plus the block index at that revision.
- [ ] Migrate `changeset`: `(id, book_id, author_id, message, created_at)` — a commit-like
      group of page revisions spanning a book.
- [ ] Link every `page_revision` to its `changeset` so book-level history is one query.
- [ ] Implement block-level diff over two block sets: added, removed, modified, **moved**.
      Moved is free with stable block IDs and impossible with line diffing — do not
      fall back to a line differ.
- [ ] Build the page-level diff view.
- [ ] Build the book-level diff view answering "what changed in this book since <date>"
      via changesets.
- [ ] Migrate `comments` anchored to `(block_id, offset_within_block)` so reflow above the
      anchor does not detach the comment.
- [ ] Implement comment threads, resolution state, and mention notifications over
      `MailSender`.
- [ ] Migrate `presence`: `(user_id, page_id, mode, last_seen_at)` where `mode` is
      `viewing` | `editing`, with a short TTL.
- [ ] Implement an SSE channel per workspace broadcasting presence changes. SSE is
      sufficient for one-way fan-out and survives proxies better than WebSockets.
- [ ] Wire presence as the soft-lock signal: "Ana is editing, opened 4 minutes ago".
- [ ] Surface "what the team is working on right now" in the workspace UI.

### Phase 4 — Diagrams

- [ ] Adopt Mermaid (and D2) fenced code blocks as the primary diagram format. Diagrams
      are text: they diff, they are indexable by RAG, and the AI can author them.
- [ ] Render diagram fences client-side in Read mode.
- [ ] Render diagram fences live in Edit mode with error display for invalid syntax.
- [ ] Integrate the Kroki service for server-side SVG rendering (export, PDF, previews).
      Keep headless browsers out of the API container.
- [ ] Add a diagram-focused slash command with starter templates (flowchart, sequence,
      ER, C4-style architecture).
- [ ] Explicitly defer Excalidraw. Record the tradeoff: freehand scenes do not diff and
      are not RAG-indexable, so they are an escape hatch, never the default.

### Phase 5 — AI layer

Multi-provider inference, retrieval, and the idea-to-design-document flow.

- [ ] Integrate the Vercel AI SDK as the single inference abstraction.
- [ ] Wire providers: Anthropic, OpenAI, Google Gemini, DeepSeek, OpenRouter.
- [ ] Build a per-model **capability registry**: tool calling, structured output, prompt
      caching, vision, context window, embedding support. Providers are not interchangeable
      and the app must degrade deliberately rather than fail at runtime.
- [ ] Implement BYOK per workspace: envelope encryption at rest, decryption server-side
      only, credentials never serialised to the client under any code path.
- [ ] Validate a credential when it is saved (cheap models-list call) and store the
      validation result so misconfiguration surfaces at settings time, not mid-generation.
- [ ] **Separate `chat_provider` from `embedding_provider` in configuration.** They are
      independent settings with independent credentials. Do not assume a workspace's chat
      provider can produce embeddings.
- [ ] Verify embedding support per provider before wiring it, and record the outcome as a
      Finding.
- [ ] Provide a local embedding fallback so an operator holding only a chat credential
      still gets working retrieval.
- [ ] Store `embedding_model` and `dimensions` on every chunk row.
- [ ] Reject writes that would mix embedding models or dimensions within one index.
- [ ] Implement reindexing as an explicit, tracked, resumable job with progress reporting —
      changing the embedding model invalidates the entire vector index.
- [ ] Implement pgvector similarity search with **GATE-3**: `workspace_id` in the SQL
      `WHERE`, never a post-filter.
- [ ] Return citations that resolve to `(page_id, block_id)` so every RAG answer links
      back into the document.
- [ ] Build the idea -> interrogation -> design-document flow: the model generates
      clarifying questions, surfaces gaps, challenges assumptions, and converges on a
      structured design document with modules and phases.
- [ ] Use `generateObject` structured output for the design-document schema so the result
      is parseable rather than prose to be scraped.
- [ ] Implement AI actions scoped to a selection: expand, summarise, critique, convert to
      diagram, extract tasks — anchored on block ranges.
- [ ] Land every AI edit as a **pending revision** reviewed through the diff view, never a
      direct write.
- [ ] Order every prompt for cache reuse: stable prefix first (tools, then resolved rule
      packs and system instructions), volatile content last (document body, user question).
- [ ] Implement per-workspace token and cost accounting: log provider, model, input and
      output tokens, and cost for every call.
- [ ] Enforce plan limits from the accounting ledger, with clear user-facing messaging when
      a workspace hits its budget.

### Phase 6 — Team rule packs

Shared working context: stacks, tools, conventions, corrections, skills. The feature that
makes conventions portable across projects.

- [ ] Model a rule pack as a **first-class entity with its own identity**, authored as
      markdown, not as a settings blob nested under a book. It versions, diffs, and is
      commented on like any other document.
- [ ] Allow one rule pack to be attached to N books (and to shelves, cells and workspaces).
- [ ] Implement the resolution cascade: Workspace -> Cell/Team -> Shelf -> Book -> Page,
      collecting applicable packs in precedence order with deduplication.
- [ ] Define override semantics when two packs disagree; the more specific attachment wins.
- [ ] Implement `resolveContext(page_id)` returning the ordered, deduplicated rule set.
- [ ] Enforce a token budget cap on the resolved rule set, with a visible warning in the UI
      when a workspace's attachments exceed it.
- [ ] Inject the resolved rule set into every AI interaction on a document, positioned in
      the cacheable prefix.
- [ ] Include the resolved rule set when exporting a book or document, so the export is
      self-contained for an external team or agent.
- [ ] Expose the resolved rule set through MCP as `get_team_rules`.
- [ ] Build the rule pack authoring and attachment UI.
- [ ] Add rule pack templates for common cases (stack conventions, review checklist,
      naming and commit conventions, testing policy).

### Phase 7 — MCP and agent surface

- [ ] Implement the MCP server as a **remote, multi-tenant Streamable HTTP** transport.
      Not stdio — this is a hosted service consumed by many clients.
- [ ] Add `agent` as a `subject_type` in the permission model so an agent can be granted
      access to exactly one book.
- [ ] Implement scoped access tokens for agents, issued per workspace, revocable, audited.
- [ ] Route every MCP call through the **same** `can()` resolver used by the HTTP API.
      There is no separate read path for agents.
- [ ] Build **one** shared tool layer consumed by both the MCP transport and the in-app AI
      panel. Retrieval is implemented once.
- [ ] Tool: `search_workspace` — RAG search with citations.
- [ ] Tool: `get_page` — fetch a page with block IDs intact.
- [ ] Tool: `list_tree` — navigate shelves, books, chapters, pages.
- [ ] Tool: `get_backlinks` — inbound links for a page.
- [ ] Tool: `get_diff` — page or book diff between revisions or changesets.
- [ ] Tool: `get_team_rules` — the resolved rule set for a scope.
- [ ] Tool: `propose_edit` — creates a **pending revision only**. Agents never commit
      directly. This is the prompt-injection mitigation: the corpus contains user-authored
      text, so an agent reading a poisoned page cannot silently rewrite the source of truth.
- [ ] Gate write tools separately from read tools in the permission model.
- [ ] Audit-log every agent tool call with the token identity, workspace and resource.
- [ ] Document the client setup (connect an external coding agent to a workspace).

### Phase 8 — UI

- [ ] Adopt Nuxt UI as the component library across `apps/web`.
- [ ] Implement user-selectable themes as CSS-variable blocks, in the spirit of DaisyUI:
      each theme is a token set, not a rebuild.
- [ ] Persist theme as a workspace default with a per-user override.
- [ ] Implement icon-pack selection via `@nuxt/icon` + Iconify: store the collection prefix
      (`lucide`, `heroicons`, `tabler`) and resolve icon names against it.
- [ ] Bundle the supported collections locally via `@iconify-json/*` packages so
      air-gapped self-hosted instances render icons without reaching the Iconify API.
- [ ] Constrain icon names to a known allowlist per pack so dynamic resolution does not
      defeat build-time tree-shaking.
- [ ] Build the AI panel: chat over the document, selection-scoped actions, pending-revision
      review, all against the shared tool layer.
- [ ] Accessibility pass: keyboard navigation through the tree, editor and diff views.
- [ ] Responsive pass for the reading experience.

### Phase 9 — Export, and the deferred backlog

- [ ] Implement book and document export bundling the resolved rule packs.
- [ ] Export targets: markdown bundle (with assets), single-file HTML, PDF.
- [ ] Render diagrams through Kroki during export so PDFs carry real vector images.
- [ ] Include revision or changeset metadata in the export header for traceability.

**Deferred — not scheduled, tracked so the decision is not re-litigated:**

- [ ] Real-time multiplayer editing (Yjs/CRDT hub). Candidate for extraction as a stateless
      Go satellite service speaking only CRDT updates, never touching the domain.
- [ ] Embedding and indexing worker. Candidate for extraction as a second Go satellite once
      indexing volume justifies it; it consumes pre-chunked blocks and needs no markdown
      semantics.
- [ ] Excalidraw as a freehand escape hatch alongside Mermaid.

---

## Findings

Discoveries and constraints. Newest first.

### 2026-09-09 — Ten copies of one type guard, in four spellings, four of them wrong

Four screens — the workspace list, the page tree, the edit session and the save path — sat on
their loading skeleton forever whenever the API was unreachable. Reported as "no me carga
nada": no list, no error notice, no way forward, and nothing in the console naming a cause.

Each composable decided whether an HTTP response had arrived by asking only whether the key was
there:

```ts
typeof error === 'object' && error !== null && 'response' in error
```

`ofetch` **always defines** `response` on the error it throws, setting it to `undefined` when
nothing came back at all — connection refused, DNS failure, the API simply not running. So the
guard passed, and the next line — `error.response.status` — threw `Cannot read properties of
undefined` **inside the catch block**, before any status had been assigned. The composable's
`status` ref never left `'loading'`, and `'loading'` is the state that renders an `aria-hidden`
skeleton, so a dead API rendered as a page that is still loading and always will be. The catch
block was the thing that failed, which is why nothing downstream of it reported anything.

That one fact about one library was written out by hand **ten times** across
`app/composables/`, in four different spellings. Four of the ten spelled the check correctly,
with an explicit `response !== undefined`. Four spelled it as key-presence alone and then read
`error.response.status` — those are the four screens that hung. The remaining two spelled it
just as loosely and survived only by accident, reading `response?.status` with an optional
chain that swallowed the same `undefined`.

**Impact:** fixed in `742600b` by centralising it into `apps/web/app/utils/fetch-error.ts` —
`serverResponded`, `httpStatusOf`, `responseBodyOf` — with a test that fails the build if an
eleventh hand-rolled copy of the guard appears anywhere under `app/`. The rule worth carrying
is not "know this about ofetch". It is that this is the repository's own named defect — *the
same fact written in two places with nothing comparing them* — found at a scale nobody had
counted, in the layer we had not thought to count it in: not configuration, not two files, but
ten copies of a three-clause expression. And the four correct copies are why it survived so
long, not despite them: any reader who happened to check one of those concluded the pattern was
fine and stopped looking. A duplicated fact is not made safe by most of its copies being right;
it is made *harder to find*. The test that pins it forbids divergence rather than pinning the
expression, because divergence was the defect.

### 2026-09-09 — The sign-in button worked before the page did, and its native POST looked like a rejected password

Second, independent cause of "signed in and bounced back to sign-in" — unrelated to the CORS
one below, and reproducible in a real browser against a live stack.

`/login` is server-rendered, so its `<form>` and its `<button type="submit">` exist and are
fully operable before any JavaScript has run. Press the button in that window and the browser
does exactly what the markup says: a native submit to the page's own URL. The server answers
with the same screen, the fields empty, and nothing logged on either side — which is
indistinguishable from a password that was rejected. Nothing guarded it: no disabled state, no
pending state, no indication that the page was not ready.

Measured on the dev server, cold hydration of `/login` took **8–17 seconds**. Chromium hit the
window on every attempt; Firefox hydrated fast enough to escape it, which is why it read as
browser-specific for a while. A production build closes most of the window, and "most" is not
a guard.

The same shape existed on all four auth screens, and the worst one to lose is `/invite/accept`:
its token is single-use, so a submit that appears to fail leaves the invitee unable to tell
whether their one link was spent.

**Impact:** `apps/web/app/components/AuthSubmit.vue` — one component, used by all four screens
(docs/UI-CHECKLIST.md §4.1), which until it is mounted renders `type="button"` instead of
`type="submit"`. A form with no submit control cannot be submitted natively, by the button or
by Enter in a field, and that is true of the markup itself rather than of anything that has to
run first. The control keeps the tab order and carries `aria-disabled` rather than the
`disabled` attribute (§5), and its reason is its own label — "Preparing the form…" — so the
explanation §3 requires needs neither a hover nor a tooltip that could not exist yet. The box
does not change: same element, same classes, one word swapped inside a `block` button whose
height `app.config.ts` pins at `min-h-10`. A `<noscript>` line distinguishes "not hydrated
yet" from "will never hydrate", because those two render identically and only one of them ever
resolves.

Two things worth recording about the *test*. A test that mounts the component cannot observe
this defect at all — it starts after the window closes, and it passes just as happily against
the broken version. `AuthSubmit.test.ts` therefore reproduces the timeline instead: it renders
the component through `vue/server-renderer`, puts those exact bytes in the document, asserts
against that DOM, then hydrates the same nodes and asserts what changed. What it cannot hold
is geometry — happy-dom has no layout engine, so "no layout shift" is asserted as far as a DOM
can carry it (same node, same classes across hydration) and the measured version belongs to
`e2e/auth-layout.spec.ts`, which is named in a comment so nobody reads the green unit test as
proof of it. The four page suites gained only a *wiring* check, and each says so in a comment:
after mount a guarded control and an unguarded one are byte-identical, so a page-level test
can only assert that the guard is still plugged in.

### 2026-09-09 — `Secure` on `http://localhost` was suspected and refuted; both browsers store and resend the cookie

Recorded because it cost investigation time and would cost it again. While chasing the bounce
back to sign-in, the session cookie's `Secure` attribute was the leading suspect: the dev stack
is plain `http://`, and `Secure` is documented as restricting a cookie to secure transports.

It is not the cause. `localhost` is a **trustworthy origin** in both engines — Chromium's
secure-context rules and Firefox's both treat `http://localhost` as potentially trustworthy —
so a `Secure` cookie set over plain HTTP on localhost is stored, and resent on the next
request. Verified in both browsers, in the running stack, by inspecting the cookie jar and the
subsequent request headers.

**Impact:** none in the code — nothing needed changing. The value of the entry is the dead end
itself. Do not spend the afternoon on `Secure` again; the two real causes are the CORS entry
below and the pre-hydration entry above.

One gap in the evidence, recorded rather than glossed: **WebKit could not be tested on this
host.** Playwright's WebKit build refuses to launch here for missing `libicu74`,
`libjpeg-turbo8` and `gstreamer1.0-libav`. So "both browsers" above means Chromium and Firefox,
measured; Safari's behaviour on `http://localhost` is unverified by us.

### 2026-09-09 — A wrong `APP_URL` fails loudly and misleadingly, not silently; three files said otherwise

The 2026-09-08 entry below, `scripts/checks/env-consistency.ts`, `docs/RUNNING.md` §3 and
`apps/web/nuxt.config.ts` all tell the same story about a mismatched `APP_URL`: that nothing
reports an error, that login returns 200, and that the browser quietly drops the session
cookie. Measured 2026-09-09 against a live stack with `APP_URL` deliberately mismatched, that
story is wrong on both counts.

What actually happens: the API allows exactly one origin through CORS with credentials, and
when that is not the origin the page was served from the browser rejects the credentialed
exchange before the page sees any response at all. Chromium reports `net::ERR_FAILED`, Firefox
`NS_ERROR_DOM_BAD_URI`, the `fetch` rejects, no cookie is stored, and the sign-in screen shows
its own network-error state: "Could not reach the server. Check your connection and try again."
There is no 200 to read, because the request is refused rather than answered.

So the failure is visible — and that is not the good news it sounds like. The screen blames the
connection, the connection is fine, and neither server logs anything about CORS. A developer
who believes the old comment goes looking for a silent 200 that does not exist, and a developer
who reads the screen goes looking for a network fault that does not exist either.

**Impact:** `env.example`'s `APP_URL` comment is rewritten to say what was measured, names both
browsers' error codes and the exact sentence the screen shows, and says out loud that it used
to claim the opposite. The same correction is still owed to `scripts/checks/env-consistency.ts`
(its file header and `SESSION_SYMPTOM`, whose text is what a failing `bun run env:check`
prints), `docs/RUNNING.md` §3 and the `devServer` comment in `apps/web/nuxt.config.ts` — all
three outside this batch's owned paths, and all three still telling the reader to expect
silence. The check itself is correct and needs no change; only its prose is wrong.

**Paid off later the same day:** all three are corrected. `SESSION_SYMPTOM` — the sentence a
failing `bun run env:check` actually prints — now names both browsers' error codes and quotes
the sentence the sign-in form shows, and its test asserts that the message can never again
promise silence or a 200. `docs/RUNNING.md` §3 and §6 trap 2 and the `devServer` comment in
`apps/web/nuxt.config.ts` say what was measured. The check's logic is untouched, including the
deliberate rule that `APP_URL` is not compared against `PORT`.

### 2026-09-09 — `env.example` ships a port an unrelated project on this host already owns, and the app connects to it anyway

On this machine, ports **5432, 1025, 8025, 9000 and 9001** belong to an unrelated `menukap`
compose project. `env.example` ships `POSTGRES_HOST_PORT=5432` and
`DATABASE_URL=…@localhost:5432/deepwiki`, so a developer who copies the template as instructed
gets a working connection — to somebody else's Postgres.

The two halves fail differently, and only one of them fails usefully. `podman compose up`
refuses to start on a collision, loudly, before any service comes up. The *application* does
not: `DATABASE_URL` names `localhost:5432` and something is listening there, so the connection
succeeds. The symptom is not a refused connection but wrong or missing data, which reads as a
bug in deep-wiki. This project has already lost time to that exact class twice — the 2026-09-04
entries below on the dev stack competing with the test harness, and on an error message naming
"a database and a role the developer had never heard of".

**A port check cannot catch this.** The port is open; it is the wrong server answering.
`scripts/checks/env-consistency.ts` compares `POSTGRES_HOST_PORT` against the port inside
`DATABASE_URL` — the same fact written twice — and both would be `5432` here and agree. Its
job is that the two halves of one configuration match, not that the thing at the other end is
ours, and it is a static text check that opens no sockets: giving it a live database
connection would put network I/O into a script that runs from the pre-commit hook.

**Decision: do not move the default, and add an identity probe instead.** Moving
`POSTGRES_HOST_PORT` to an uncontended range would help exactly one machine and is forbidden
in writing — `docs/RUNNING.md` §6 trap 4 rules that `env.example` keeps the conventional ports
(5432, 1025, 3000) even where the host cannot use them, because the file is a template every
developer copies, and that "a port like 25432 in this file is somebody's laptop, and should be
reverted rather than accommodated". It has leaked twice already that way. So the template keeps
5432 and now says loudly, next to `DATABASE_URL`, what that leaves open and where to move your
own ports (`.env`, which is gitignored and exists for it).

The probe is the part that actually detects it, and it belongs in `packages/db` rather than in
a check script: on the first connection, ask the database whether it is deep-wiki's — a schema
question such as `to_regclass('public.workspaces')`, or the presence of
`drizzle.__drizzle_migrations` — and fail with a message that names the collision ("connected
to localhost:5432, but that database has no deep-wiki schema; something else on this machine
is probably listening on that port") instead of letting the app run against a stranger's rows.
`createDb` is the single place every consumer goes through, and `postgres.js` connects lazily
there, so the probe has to hang off the first query rather than off the factory. Not
implemented here — `packages/db` is outside this batch's owned paths.

### 2026-09-08 — `APP_URL` had nothing to be checked against, and shipped naming the e2e harness's port

The session was lost on every login and nothing caught it. `apps/api` installs
`cors({ origin: APP_URL, credentials: true })`, and a cross-origin response only carries its
`Set-Cookie` into the browser when the API named that **exact** origin. So a wrong `APP_URL`
does not fail: login returns 200, the browser discards the cookie, the next request is
anonymous, and the user is returned to sign-in — with no error on either side.

Two separate things were wrong, and the second is the one that matters.

`env.example` shipped `APP_URL=http://localhost:4173` while `nuxt dev` listened on Nuxt's
default 3000. 4173 is Vite's preview port, and it is also `MAIN_CHECKOUT_PORTS.web` in
`packages/db/testing/worktree.ts` — the **e2e harness's** web port for the main checkout. It
had never been the dev server's. It appeared to work only because `docs/RUNNING.md` on `main`
told the reader to type `--port 4173` by hand, so the value was correct exactly as long as
someone remembered a flag. This worktree's `.env` had gone one step further and carried
`APP_URL=http://localhost:13150`, which is *this worktree's* derived e2e web port.

The deeper fault: `scripts/checks/env-consistency.ts` tied `POSTGRES_HOST_PORT`↔`DATABASE_URL`,
`MAILPIT_SMTP_HOST_PORT`↔`SMTP_PORT` and `PORT`↔`NUXT_PUBLIC_API_BASE_URL`, and deliberately
did *not* tie `APP_URL` to `PORT` — correctly, because `APP_URL` is the web origin and not the
API's. But it was then tied to **nothing**. The variable most able to fail silently was the one
variable with no counterpart in the check.

**Impact:** `apps/web/nuxt.config.ts` now declares `devServer.port`, which makes the web port a
fact in the repository instead of a flag in a shell history, and gives `APP_URL` something to
be checked against. `env-consistency.ts` reads that number straight out of the config file's
text (never executing it) and requires `APP_URL` to name the same port, with a message that
states the symptom — "you will be returned to sign-in" — rather than only the mismatch. It also
requires the declared web port to differ from `PORT`: Nuxt's default was 3000 and so is the
API's, so whichever process started second was silently moved by the dev server's own port
fallback, and `APP_URL` then named whichever one lost. The web port is now 3001, which is the
value that fallback was already producing.

The check now reads `env.example` **as well as** `.env`, and always: the template is committed,
every developer copies it, and the shipped default is where this bug came from — so a clone with
no `.env` at all must still be able to fail. It stays out of `bun run check` and the pre-commit
hook for the reason it always did: `.env` is local developer state.

Two things this does not fix. `APP_URL` and `devServer.port` are still the same fact written
twice — the check compares them rather than deriving one from the other, which is the same
shape of debt the `DATABASE_URL` pair carries. And an `APP_URL` naming no port at all (a
deployed `https://wiki.example.com`) is deliberately out of scope, because a reverse proxy in
front of both apps is a legitimate arrangement the check cannot second-guess.

### 2026-09-08 — The error screen asserted the visitor was signed out, and could not have known

The owner reached `apps/web/app/error.vue` from `/workspaces/` while signed in and was offered
"Go to sign-in", and nothing else. The recovery action read the address for a workspace or page
id, found neither, and fell through to sign-in as its default.

That is worse than an unhelpful action. It is a claim about the visitor that was false, on the
one screen whose whole job is to be trustworthy about what just happened.

It cannot be fixed by guessing better. The session cookie is `httpOnly`
(`apps/api/src/middleware/session.ts`), so the browser cannot read it; the API has no session
or `/me` endpoint to ask; and this screen must render when the server itself is what failed, so
making it depend on a network round trip would break the branch that needs it most.

**Impact:** the screen now names a **destination** and never a state. `/workspaces/…` with no
valid id — the address the owner actually landed on — offers the workspaces list rather than
falling past both patterns into sign-in. Sign-in stays on the screen, as a demoted second door
that is never the only one, because every destination in this product needs a session and the
screen genuinely cannot tell which of the two doors this visitor needs. A test asserts that
sign-in is never the sole exit and never the first.

Unchanged, and asserted by the two tests that already held them: the 404 branch is still
selected by status code alone, and no field of the error object reaches the DOM, so a denied
resource and a missing one remain byte-identical.

### 2026-09-08 — `verify` now needs more memory than the machine had, and was killed

A single end-to-end `bun run verify` was killed by the operating system under memory pressure.
It was not a test failure: it completed the ten structural checks, `lint`, `typecheck` and the
full unit suite (1409 tests, zero failures) before dying, and a separate `bun run e2e` run
passed 30/30 the same day.

The cause is what `verify` now contains. Wiring the e2e suite into it — the right fix for a
suite that no committed command reached — stacked Playwright's browser, a Nuxt production
build and the disposable Postgres containers on top of a run that already provisions a database
for `packages/db`. Peak memory is now the sum of all of it.

**Impact:** a gate that cannot finish is a gate people stop running, which is the same failure
as a gate everyone routes around. Two directions worth weighing before the next milestone tag:
run the e2e stage in a separate process rather than the same one, or accept that `verify` is a
two-command ritual and say so in `CLAUDE.md` rather than leaving the owner to discover it as a
kill. The parts are individually cheap; only their sum is not.

**Not yet decided.** Recorded now because the failure mode is environmental and will not
reproduce on a larger machine, which is exactly how a gate quietly becomes optional for whoever
has the smaller one.

### 2026-09-08 — A geometry assertion outlived the DOM it named, and reported a layout defect that was not there

`e2e/auth-layout.spec.ts`'s "the sign-in block is centred in the space between header and
footer" failed at `436`, against a tolerance of `2`, on all four auth screens. Read as written
it said the block was top-aligned with the whole of the free space dumped underneath it, and it
pointed straight at `AppShell` — whose own doc comment names `flex min-h-0 flex-1 flex-col` on
`UMain` as the thing `my-auto` depends on, while the template states no class at all.

It was not the layout. Measured on the running app at 1280x900: `UContainer`'s resolved margins
were **97.5px top and 97.5px bottom**, and the block ran 217.5 → 689.5 inside a `main` of 56 →
851 — `161.5px` of space above it and `161.5px` below. Centred to the pixel, in both themes. The
class the comment names *is* applied, centrally, as `main: { base: 'flex min-h-0 flex-1
flex-col' }` in `app.config.ts` — the template is deliberately bare because the override is only
correct inside that column, and `tv`'s `extend` merge drops `UMain`'s own
`min-h-[calc(100vh-var(--ui-header-height))]` on the way through. The rendered `<main>` carries
exactly the four classes and nothing else.

Cause: the test named the block as `document.querySelector('main h1').parentElement`, with the
comment "the heading and the card are one block". That was true when it was written — the `h1`
sat directly inside the column `div` that also held the card. Extracting `PageHeading` (e5a4a50)
wrapped the `h1` in `div.mb-8.max-w-measure`, after which `parentElement` was the heading alone.
The assertion then compared the gap above the block with the gap below the *heading*, and the
difference was the card's height plus the 32px under it — **404 + 32 = 436**, the number
reported.

The test now walks *up* from the heading to `main`'s grandchild, so a wrapper introduced between
the two cannot narrow it again, and asserts `blockHeight > headingHeight` first — the guard whose
absence let a measurement silently stop measuring what it names. Mutation-checked both ways:
dropping `center` from `AuthShell` reds it at `195`, and the corrected selector greens against
the unchanged shell.

**Impact:** this is the mirror image of the family recorded above (the pgvector `CHECK` test, the
block-merge fixture, the wiki-link non-disclosure test, the self-writing golden) — **a test that
failed for the wrong reason**. The two are the same defect: a test whose result does not depend
on the behaviour it claims to protect. The red direction is the more expensive one, because a red
test is believed. The rule that catches it is the same one — break the thing on purpose and check
the *reason* — plus its corollary for a failing test: **before fixing the code a red test accuses,
reproduce its measurement independently.** Ten minutes of `getBoundingClientRect()` in the running
app separated "the auth screens are broken" from "the ruler moved".

Companion: `AppShell.test.ts` asserted `my-auto` and passed while the e2e was red, because
happy-dom has no layout engine and the class is not the effect. The class assertion is kept and
its limit is now stated in the file, pointing at the e2e as the recorded owner of the guarantee;
a second test holds the other half of the mechanism — that `main` is the flex column giving
`my-auto` free space, and that `UMain`'s viewport-minus-header base is gone rather than merely
accompanied. That half was asserted nowhere, in either file, and is where a reader looking for a
broken centring goes first.

### 2026-09-08 — One unreproduced api-suite failure, recorded rather than closed

While closing the comment-route mutation audit, a single combined run reported the
`@deep-wiki/api` suite at `105 pass, 1 fail`. The failing test's name was not captured. It has
not recurred in **eleven** subsequent full runs — eight by the agent that saw it, three more
afterwards, all exit 0 at 1340 tests.

The leading hypothesis is container or port contention in the disposable-Postgres provisioning
(`packages/db/testing/provision.ts`), which `packages/db/testing/worktree.ts` already derives
per worktree precisely because `podman-compose` proved unsafe under concurrent invocation
against one compose project. **That hypothesis is unproven.**

**Impact:** recorded here because an intermittent failure is worse than a consistent one — a
consistent failure gets fixed, an intermittent one teaches a team to re-run. If it returns,
capture the test name and the provisioning log before doing anything else; a second sighting
with a name is worth more than any amount of speculation now.

### 2026-09-08 — Looking a page up before calling `can()` turns every route into an existence oracle

A mutation audit of `apps/api/src/routes/comments.ts` found the indicators endpoint answering
**404** for a page that does not exist and **403** for a page the caller may not read. A caller with
no grant could therefore probe for page existence — the exact class the password-reset response and
wiki-link rendering already close. The shape is structural, not local: every route in this app looks
the node up first and consults `can()` second, so the same oracle existed in `POST /pages/:id/comments`,
`PATCH /comments/:threadId/resolved`, `GET /pages/:id/backlinks`, and — in the `200`/`404` form rather
than the `403`/`404` one — `GET /pages/:id/mentions/:userId/check`, which never consulted the caller's
own grant at all.

The rule now applied to those five: **`read` is the first gate, and absence and denial-of-read return
the same response from the same call site.** Denial of a *stronger* action (`comment` on a page the
caller can already read) still answers `403`, because that caller can see the page and learns nothing.
This is the singular analogue of what `can-many.ts`/`readable.ts` already do for sets, where an
unreadable id is dropped from the result rather than reported as denied.

**Deliberately not changed:** `apps/api/src/routes/pages.ts` has the same shape, and
`docs/UI-CHECKLIST.md` records it as a reviewed decision — a direct URL request gets a real `403`,
and the not-found screen is built to render `403` and `404` byte-identically so the ambiguity is the
*client's* to choose. `PATCH /nodes/:id/position` (tree.ts) still answers `403` to a subject with no
read; it is a node-position mutation rather than an answer about a page, and it is left as a recorded
follow-up rather than changed under a comment-route audit.

**Impact:** "look the row up, then authorise it" reads as the obvious order and is wrong by default
whenever the row's *existence* is itself privileged. Any new route that takes an id in its path
should be written with the read gate first.

### 2026-09-08 — Five tests that could not fail: the audit's own findings

The same audit applied 15 mutations across `resolve-changeset.ts` and `comments.ts`; five stayed
green. Each one is a different way for a test to pass without depending on the behaviour it names:

- **A parameter nobody varied.** Every `resolveChangeset` case used `windowMinutes: 30` with an
  activity either seconds or an hour old, so hardcoding a 1-minute window passed. Two cases against
  the *same* 45-minute-old activity — joining at 60, retiring at 30 — is what makes the parameter
  load-bearing.
- **A fixture too shallow for the code path.** The only `resolveBookId` fixture parented its page
  directly under the book, so a one-hop parent lookup passed and the recursive CTE was never
  exercised. Related: `LIMIT 1` over a recursive CTE has no inherent order, so "the nearest book
  wins" was true only by Postgres's incidental `UNION ALL` evaluation; it now says `ORDER BY depth`.
- **A scope that only one fixture could ever exercise.** One book in one workspace cannot detect an
  implementation that joins by `author_id` alone. Worth noting: the two `workspace_id` filters in the
  ancestor walk are each individually sufficient, so removing *either* alone is undetectable —
  only removing both is observable. That is defence in depth, not redundancy to delete.
- **An assertion weaker than the docstring.** `expect(closed.closed_at).not.toBeNull()` passes for
  `now()`, though retirement is specified to stamp the last activity. Assert against the value the
  test itself wrote.
- **Concurrency asserted in a comment.** Two saves slept the same amount and were started with
  `Promise.all`, but every assertion would have held had they run sequentially. The overlap is now
  asserted: each transaction records `clock_timestamp()` either side of its own call and the two
  intervals must intersect.
- **A recipient nobody named.** The mention tests counted notifications without asserting `to`, so
  sending one to `attacker@example.invalid` stayed green — and the "readable recipient" fixture
  mentioned the comment's own author, which a route mailing the wrong person also satisfies.
- **An assertion that could not fail independently.** `expect(sent.map(s => s.to)).not.toContain(x)`
  sat immediately after `expect(sent).toHaveLength(0)`. It is now the load-bearing half of a
  mixed-recipient case where one notification really is sent.
- **A status line that swallowed every distinct failure.** Every way of breaking anchor minting also
  trips `comments_block_fk` and returns 500, so the test died on `expect(res.status).toBe(201)` and
  could not tell "anchor not minted" from "route crashed". Storage is now read first.

**Impact:** all of these are the family already recorded here — *tests that pass for the wrong
reason*. The counter-practice is unchanged and still the only thing that catches them: break the
behaviour on purpose and watch the test go red **for an assertion reason**.

### 2026-09-08 — A non-disclosure helper that reads only the body leaves the headers open

`apps/api/testing/expect-no-disclosure.ts` scanned `JSON.stringify(body)` and nothing else, so a
route that put a hidden id — or a comment count — in a response header passed every non-disclosure
test in the repository. Headers are now scanned too, **names as well as values** (`x-page-<id>: 1`
leaks as surely as `x-node-id: <id>`), and `HiddenNode` takes a `values` list for anything that is
not an id, slug or title.

The `headers` argument is **required**, not optional: an optional channel is one a call site can
silently skip, which is the same defect class as the leak the helper exists to catch. All five
existing call sites were updated and none of them broke — nothing in this app sets a response header
carrying node data today.

### 2026-09-07 — A green GATE-2 was measuring a third of what its number claimed

GATE-2 reported "69/69 byte-identical round trips". It called `roundTrip()` at three call sites:
22 `modelled/` + 5 `verbatim/` + 1 pin regression = **28** byte comparisons. The other 41 cases were
probe accept/refuse assertions and two meta-tests — real tests, but not byte-identity tests. The
count was published in the verify report and the archive report and repeated downstream, including
by me to the project owner.

What the missing coverage was hiding, found the moment the assertions were added:

- **`listItem` dropped `checked` and `spread`.** `- [ ] todo` came back from the editor as `- todo`;
  GFM task lists silently lost their checkbox, and a multi-block list item lost its second block.
  No fixture contained a task list, so the gate stayed green over a live data-loss path.
- **The canonical verdict was inverted for definitions.** `[a]: /a\n[b]: /b` (canonical) was refused
  by the probe while the spaced, non-canonical form was accepted. `definition` travelled as an
  opaque node and `mdast-util-to-markdown`'s join rule keys on `node.type`. A committed comment
  asserted the opposite behaviour and was simply false.
- **"Insertions undo as one step" was defended by a comment, not a test.** `grep undo` across every
  `.test.ts` returned zero. The first undo restored the paragraph and left the `/quote` trigger
  deleted — two steps. `prosemirror-history` groups adjacent transactions only when `isAdjacentTo`
  also holds, and a block transform changes ranges at the block's boundaries, not at the caret.

**Impact:** a test-count is not a coverage measure, and a gate that reports one invites the
substitution. GATE-2 now tags every `describe` with what it measures — `[byte identity]`,
`[byte inequality]`, `[invariant]`, `[probe accept]`, `[corpus shape]`, `[regression]` — so the
number cannot be read as something it is not. Byte comparisons went 28/69 → 58/162, and a new
corpus-wide invariant states the thing the buckets only implied: **if the probe accepts a document,
canonicalising it must not change it.** Edit mode must never open what the save path would rewrite.

### 2026-09-07 — The coverage gate measured workspace members, so one assertion covered an app

`test-coverage.ts` required each workspace *member* to hold at least one test file with at least one
`expect(`. A single assertion anywhere in `apps/web` satisfied the gate for the entire application.
That is how `EditorSurface.vue` — carrying three spec requirements, including the menu repositioning
and the `aria-activedescendant` wiring — shipped with no test of any kind while `bun run check`
stayed green, along with every other component in the app.

The gate now measures **per source file**. A file is covered when a test imports it, imports one of
its exported bindings *by name* through a pure barrel or a workspace entry, or has a named sibling
test. A wildcard `import * as` credits the barrel and nothing behind it: a barrel is transparent,
never absorbent, and crediting everything it re-exports is the member-level hole in file-level
clothing.

Exemptions are mechanical rather than by name — a file is exempt when it **erases to nothing at
runtime**, measured with `Bun.Transpiler().transformSync(code).trim().length === 0`. A `types.ts`
earns the exemption by containing no runtime code and loses it the moment someone adds a `const`.
Two anti-decay rules keep it honest: a test with zero assertions is an error in its own right and
credits nothing, and an `ALLOW_LIST` entry that names a missing or now-covered file is also an
error, so the list can only shrink without a deliberate edit.

**Impact:** this is the fourth structural check in this repository found to have a hole — after
`core-purity` (missed devDependencies), `single-parser` (missed a second pipeline inside an allowed
package) and `routes-mounted` (accepts a bare textual mention). The pattern is stable enough to
state as a rule: **when you write a gate, the acceptance criterion is not that it passes — it is
that you watched it fail against real uncovered code and it named the right files.** This one was
proven against a clean `git archive HEAD` export, where it exited 1 naming seven files with no false
positives.

Its honest ceiling is documented in the file: it is static, so it proves a test *names* a file, not
that it exercises a line. Real instrumentation cannot live in `bun run check`, which runs in the
commit hook and must not require the Postgres half the suite provisions.

### 2026-09-07 — A golden test that writes its own expectation cannot fail the first time

`chunk-golden.test.ts` auto-wrote a golden JSON file whenever one was missing. The point of a golden
is that a human read it once and committed it; a self-writing golden converts "the output changed"
into "the output is whatever the code just produced". Six new fixtures had just been added, so the
next ordinary run would have manufactured six expectations nobody reviewed.

The write gate now lives inside `golden.ts` rather than at the call site, so "the ordinary run never
writes a golden" is a property of the module instead of a convention every caller must remember.
Regeneration is a deliberate act: `bun run -F @deep-wiki/markdown goldens:update`. Stale goldens —
one outliving the fixture that produced it — were undetectable in the other direction and now fail a
named test.

**Impact:** this is the same family as the pgvector `CHECK` test, the block-merge fixture and the
wiki-link non-disclosure test — **tests that passed for the wrong reason**. The common shape is a
test whose green state does not depend on the behaviour it claims to protect. The counter-practice
that keeps catching these is cheap and non-negotiable: **break the thing on purpose and watch the
test go red for an assertion reason.** Every test added in this batch was mutation-checked that way.

### 2026-09-07 — A markdown option pin splits into efficacious and defensive, and only one kind is testable by removal

`PINNED_OPTIONS` freezes 11 `remark-stringify` options so canonical serialisation cannot drift. The
spec says "removing a pin fails a named fixture", and the obvious reading — delete the key, watch
bytes change — only works for **5** of them (`bullet`, `emphasis`, `resourceLink`, `strong`,
`tightDefinitions`), whose pinned value differs from the library's default. The other **6**
(`bulletOrdered`, `fence`, `fences`, `listItemIndent`, `rule`, `setext`) pin a value that *is*
remark's default, so removal is a byte no-op no matter what the fixture contains. They are defensive
pins: they exist so a future library default change cannot silently rewrite the corpus.

**Impact:** the protection a defensive pin needs is an assertion on its **presence and value**, not
on its effect. All 11 keys now carry three named tests each, plus a parity test so a new pin without
a case fails. Group membership is machine-checked via `PIN_CASES.differsWhenRemoved` rather than
maintained as a third hand-written list — the repository's standing rule against writing the same
fact twice and trusting a comment.

### 2026-09-06 — Route modules shipped unreachable, twice

In Phase 1, `admin`, `invitations` and `uploads` were fully implemented and unit-tested while
`apps/api`'s composition root wired only `createAuthRoutes`. Every test passed; no browser could
reach any of them. It was found only when the UI tried to call one. In Phase 5 the same thing
happened to `ai-credentials`, in a track that had the Phase 1 incident recorded in its own briefing.

Neither typecheck nor the test suite can see it. Unit tests invoke the route factory directly and
never traverse the running server, and an unmounted module is still a perfectly valid module. The
only signal is a request that never arrives, which surfaces later as "the API is down".

**Impact:** `scripts/checks/routes-mounted.ts` fails the build when a route module exports a
`create*Routes` factory that `apps/api/src/index.ts` never references. The first occurrence was
fixed by hand; a second occurrence in a track that knew about the first is the evidence that a
manual fix was never going to hold. This is the fourth time this session the same shape has
appeared — **a rule enforced by memory is enforced by nobody.**

### 2026-09-06 — Two parallel changes both claim migration numbers 0008-0010

`content-and-editor` and `ai-provider-foundation` were designed concurrently and each planned its
migrations as `0008`-`0010`. Migrations `0000`-`0007` exist. Whichever change applies second must
renumber from `packages/db/drizzle/meta/_journal.json` rather than from its own design document.

**Impact:** this is the predictable cost of parallel planning, and it is cheap to pay as long as it
is paid deliberately. The rule for any future parallel track: **a design may fix a migration's
name, never its number.** The number is repository state, not a design decision, and it is only
knowable at apply time.

### 2026-09-06 — A secret-field denylist that fires on legitimate fields gets suppressed

Surfaced while designing the AI credential guard. `query-boundaries.ts` protects secrets by field
name, and the obvious rule — flag anything ending in `Token` — collides head-on with the
`inputTokens` and `outputTokens` counters the usage-accounting tables need. A guard that cries wolf
on legitimate fields does not get fixed; it gets an exception, then a broader exception, then it is
noise. The denylist has to name credential shapes precisely rather than pattern-match a suffix.

### 2026-09-06 — Two structural checks had holes that only lined up together

Phase 2's task breakdown found both, and both are now closed.

`core-purity.ts` inspected only `dependencies`. Separately, `Bun.Transpiler().scanImports()` was
measured to **elide type-only imports**. Either hole alone is survivable; together they compose: a
framework reached for as `import type` is invisible to the AST scan, and if it were declared under
`devDependencies` the manifest rule never saw it either. `packages/core`'s framework-free
guarantee — the invariant `CLAUDE.md` calls machine-enforced — had a path straight through it.
The check now counts `dependencies`, `devDependencies` and `peerDependencies`, and the manifest
rule is a pure function so it can be tested without a filesystem.

`single-parser.ts`, written an hour earlier in this same session, did not list `milkdown` — the
very ProseMirror editor Phase 2 is about to build on. It is legitimate inside `packages/editor`
and nowhere else, since it carries its own markdown serialiser. A stray import would have passed
the check written specifically to prevent exactly that.

**Impact:** the lesson is not either bug. It is that **a check is only as good as its list, and a
list written from memory is a guess.** Both were closed by another agent reading the checks
against the work about to be done, not by the checks failing. Structural checks need the same
adversarial reading as the code they guard.

### 2026-09-06 — Fourth instance: the e2e harness told the browser the wrong API port

Changing `apps/web`'s compiled `apiBaseUrl` default from 4000 to 3000 broke the e2e suite, because
`e2e/global-setup.ts` starts `apps/api` on a hardcoded 4000 and nothing told the dev server about
it. Seven auth tests failed with "Could not reach the server" while nothing about the application
was wrong. The suite only passed for whoever set `NUXT_PUBLIC_API_BASE_URL` by hand.

This is the **fourth** instance of one shape in two days — after `POSTGRES_HOST_PORT`/`DATABASE_URL`,
`MAILPIT_SMTP_HOST_PORT`/`SMTP_PORT`, and `PORT`/`NUXT_PUBLIC_API_BASE_URL`. Each time the same
fact lived in two places and nothing compared them; each time the failure pointed somewhere other
than the cause.

**Impact:** `e2e/ports.ts` holds `API_PORT` and `WEB_PORT` once, `global-setup.ts` and
`playwright.config.ts` both import them, and the Playwright `webServer` passes
`NUXT_PUBLIC_API_BASE_URL` through so the browser is told rather than left to guess. Verified: 22/22
pass with no manual override. The pattern is now frequent enough to state as a rule for later
phases — **when a value must agree with another value, import it; when it cannot be imported,
check it; never write it twice and trust a comment.**

### 2026-09-06 — Unreproducible: `podman compose --wait`

A subagent reported that `podman-compose` 1.6.0 rejects `--wait`, causing `provision.ts` to exit
125. Tested directly on this machine: `podman compose up -d --wait postgres` returned **exit 0**.
Not reproduced, so not fixed. Recorded because it may be conditional on a cold start rather than a
container already running — worth re-checking if provisioning fails on a clean machine.

### 2026-09-06 — Nuxt UI ships a second markdown parser, one import away

`CLAUDE.md` calls the single-parser rule non-negotiable, and until now it lived only in prose.
Verified: `@nuxt/ui` 4.11.0 ships a TipTap-based editor surface — `UEditor`, `useEditorMenu`,
`runtime/utils/editor` — and TipTap is in its own dependencies. It is already in this
repository's tree. **A one-line `<UEditor />` in any component would have introduced a second
markdown serialiser**, and nothing would have failed: not typecheck, not lint, not the tests.
The divergence would appear later, on exactly the edge cases GATE-2 exists to pin down.

**Impact:** `scripts/checks/single-parser.ts` fails the build on any import of a competing
markdown library, and on any use of the Nuxt UI editor surface, outside `packages/markdown` and
`packages/editor` which own the pipeline. It excludes its own source and tests, following the
precedent `query-boundaries.ts` set when it flagged itself for the same reason — a check that
describes forbidden patterns necessarily contains them.

The general point, and the third time this session it has come up: **a rule with no mechanism is
advice.** It was written in the most emphatic prose available to this repository and was still
one import away from being broken silently.

### 2026-09-06 — `scanImports()` elides type-only imports

Measured directly: `Bun.Transpiler().scanImports()` returns nothing for
`import type { Root } from 'mdast'` while reporting a value import in the same file. This settles
an open question the Phase 2 design left unresolved.

**Impact:** `core-purity.ts` is built on `scanImports()`, so it has a blind spot for type-only
imports into `packages/core`. That is defensible — a type-only import creates no runtime
dependency — and the check's separate manifest rule still rejects a declared dependency. But the
blind spot should be known rather than discovered: a type-only import from a framework would
pass the purity check today.

### 2026-09-06 — The auth inputs violated three rows of the project's own text-field table

The owner said the inputs looked wrong. Measured against `docs/DESIGN-SYSTEM.md` §9.5, which this
project wrote and the screens were reviewed under:

| §9.5 requires | Shipped |
| --- | --- |
| `body-large` — 16px, **non-negotiable** | 14px |
| `corner-extra-small` — 4px | 12px |
| M3 text field height — 56dp | 32px |
| label `body-large` | 14px |

Nobody applied the table; Nuxt UI's defaults were left in place. The 16px row is the one that
matters beyond taste: **below 16px, iOS Safari zooms the viewport when a field takes focus**, and
§9.5 records that explicitly. A desktop review cannot see it, which is exactly why the rule was
written down rather than left to judgement.

A second trap sat underneath: Nuxt UI applies its **size variant after** an `app.config.ts` slot
override, so `text-base` written on the `base` slot silently loses. The size has to be *chosen*
(`defaultVariants: { size: 'xl' }`), not overridden. The first fix attempt corrected radius,
height and label but left the font at 14px, and only measuring caught it.

**Impact:** fixed centrally so every future form inherits it, and `docs/DESIGN-SYSTEM.md` §9.5 now
carries the concrete `app.config.ts` block plus the variant-ordering warning. The wider lesson:
a design system that states a rule but not how to express it in the stack gets read as advice.

### 2026-09-06 — `/health` bypassed CORS because Hono applies middleware only to later routes

`/health` was registered at module scope, while the CORS middleware was installed further down
inside the entry-point block. Hono's `app.use()` applies only to routes registered **after** it, so
`/health` answered 200 with no `Access-Control-Allow-Origin` and the browser refused to read the
response — while every other route, registered after the middleware, worked normally. The symptom
is deceptive: a 200 in the network tab next to a CORS error in the console.

The existing test could not catch it. It imported the module-level `app` and called `/health`
directly, which never executes the `import.meta.main` block where the middleware was installed —
so the test exercised an app that had no CORS at all and passed.

**Impact:** `createApp({ appUrl })` now builds the application in one place with the middleware
installed before any route, and the test asserts `/health` carries `Access-Control-Allow-Origin`
and rejects a foreign origin. The general rule: when middleware order is load-bearing, express it
as construction order in a factory rather than as statement order in a module, or a later edit
reintroduces the bug silently.

### 2026-09-06 — Killing `bun run -F <pkg> start` leaves the real server running

While verifying the CORS fix, a live request kept returning the pre-fix response. The cause was
not the fix: `bun run --filter` spawns a child that runs the actual entry point, and killing the
wrapper leaves that child holding the port. The next run then binds nothing and every request
reaches the stale process.

**Impact:** worth knowing during any manual verification — check `ss -ltnp | grep :<port>` and kill
the listed pid, not the shell job. A measurement taken against a stale server looks exactly like a
fix that did not work, which is the most expensive kind of false negative.

### 2026-09-06 — `APP_URL` is the web origin, and treating it as the API's broke CORS

`APP_URL` feeds three things, and all three are the browser's view of **apps/web**: the single
origin the API allows through CORS with credentials, and the host of the `/reset-password` and
`/invite/accept` links mailed to users — both of which are Nuxt pages.

`env.example` documented it beside `PORT` with the same value, which reads as though it were the
API's own address. That is wrong in development, where the Nuxt dev server runs on a different
port entirely, and it produced a CORS allowlist naming an origin no browser ever sends. A
consistency check comparing `PORT` against `APP_URL` was briefly added and made the error
mandatory before being removed.

**Impact:** `APP_URL` now defaults to the Nuxt dev server and both `env.example` and the zod
schema say what it means. `env-consistency.ts` compares `PORT` only against
`NUXT_PUBLIC_API_BASE_URL`, and a test asserts that `APP_URL` is deliberately *not* tied to `PORT`,
so the mistake cannot be reintroduced as a well-meaning fix. The wider lesson: a variable used by
three call sites needs its meaning written where it is defined. "URL of the app" is ambiguous the
moment an app is two deployables.

### 2026-09-06 — apps/web looked for the API on a port nothing listens on

`apps/web/nuxt.config.ts` hardcoded `apiBaseUrl: 'http://localhost:4000'` with a comment claiming
it tracked "apps/api's default PORT". `env.example` documents `PORT=3000`. The comment and the
value had drifted apart, and neither was reachable on a machine where 3000 already belongs to
another project — so the browser called a port with nothing behind it and the sign-in screen
reported the API as unreachable.

This is the third instance of one pattern in two days: **the same fact written in two places with
nothing comparing them.** First `POSTGRES_HOST_PORT` against `DATABASE_URL`, then
`MAILPIT_SMTP_HOST_PORT` against `SMTP_PORT`, now `PORT` against both `APP_URL` and the base URL
the browser is handed.

**Impact:** the default now tracks `env.example`'s `PORT`, `NUXT_PUBLIC_API_BASE_URL` is documented
as the override (Nuxt maps `NUXT_PUBLIC_*` onto `runtimeConfig.public` automatically), and
`env-consistency.ts` compares both new pairs. The pattern is worth naming for future phases: any
value that must agree with another value belongs in one place, and where duplication is
unavoidable, a check must compare them — a comment asserting they agree is not a mechanism.

### 2026-09-06 — A malformed DATABASE_URL failed with a parser stack instead of a cause

`createDb` passed the value straight to `postgres.js`, which threw `ERR_INVALID_URL` with a stack
rooted in its own `parseUrl`. Nothing in that output named the variable, the file it came from, or
what was wrong with the text — the developer sees fifteen frames of library internals for what is
a typo in a config line.

The specific case that triggered it: a `.env` does **not** interpolate. Writing
`DATABASE_URL=postgres://u:p@localhost:${POSTGRES_HOST_PORT}/deepwiki` passes `${POSTGRES_HOST_PORT}`
through literally, and that is not a port. This is an easy mistake to make immediately after being
told to move the port, because the variable is right there in the same file.

**Impact:** `packages/db/src/database-url.ts` names the cause before `postgres.js` sees the value —
unset, empty, quoted, missing scheme, unexpanded `${VAR}` or `$VAR`, non-numeric port, unparseable.
It deliberately never echoes the URL back, because it carries a password; a test asserts that.
The general rule this is an instance of: when a library's error names only its own internals, the
adapter that owns the boundary should validate first and fail with the cause.

### 2026-09-04 — Two env vars held the same fact and nothing checked they agreed

Making the compose host ports configurable fixed one problem and created another. `.env` now
carries the same fact twice: `POSTGRES_HOST_PORT` tells compose where to publish, the port inside
`DATABASE_URL` tells the app where to connect.

The failure mode is confusing rather than merely wrong. The app connects successfully to whatever
unrelated service owns the old port, so the error that comes back is *that server's* — naming a
database and a role the developer never configured. The owner hit exactly this:
`POSTGRES_HOST_PORT=25432` with `DATABASE_URL` still on 5432, which on that machine is another
project's Postgres. The same trap sits between `MAILPIT_SMTP_HOST_PORT` and `SMTP_PORT`.

**Impact:** `scripts/checks/env-consistency.ts` compares the pairs and names both values when they
disagree. It runs in `bun run verify` and as `bun run env:check`, deliberately **not** in the
pre-commit hook — `.env` is local developer state, and blocking a docs commit over a local
misconfiguration is over-reach. The deeper fix is to derive `DATABASE_URL` from its parts so the
fact is written once; that is larger and is not done.

### 2026-09-04 — The dev stack and the test harness compete for ports

Bringing the documented stack up on a working machine failed twice for the same reason in two
different ways. First, all six conventional ports (5432, 1025, 8025, 9000, 9001, 8000) were held
by unrelated projects. Then, after shifting them, mailpit and minio failed again — this time
against `deep-wiki-api-test_mailpit_1` and `deep-wiki-api-test_minio_1`, containers **this
project's own test harness** had left running for fifteen hours.

**Impact:** the published host ports now come from the environment with the conventional
defaults (`${VAR:-5432}` rather than a literal), so a fresh clone is unchanged and a busy machine
can move them in `.env` without editing a tracked file. Documented in `README.md`. The deeper
issue is unresolved: the test harness reuses long-lived containers deliberately, but nothing
tells a developer they are there, and its ports are not derived from the same variables as the
dev stack. A `podman compose up` that fails on a port the same repository is holding is a
confusing first-run experience.

### 2026-09-04 — `bun run db:migrate` applied the schema and then hung forever

Found by running the documented bootstrap sequence end to end for the first time rather than
reading it. `migrate.ts` created the client, applied all 11 tables successfully, printed
`migrate: done` — and never exited. `postgres.js` keeps its connection pool open, and nothing
closed it.

**Impact:** anyone following `README.md`'s bootstrap would see a terminal sitting still after a
success message, read it as a failure, and kill a run that had already worked. Fixed by closing
the pool in a `finally`. The lesson generalises: an entry point that a human runs by hand needs
its exit path tested, and no unit test covers "the process terminates".

### 2026-09-04 — The compose stack cannot start on a machine already running other projects

`compose.yaml` publishes postgres on 5432, mailpit on 1025/8025 and minio on 9000. On this
development machine all four are already taken by unrelated containers, so `podman compose up`
fails on port binding before anything starts.

**Impact:** not a defect in the compose file — those are the conventional ports and a fresh
machine works. But the documented bootstrap assumes an empty host, and a developer running more
than one project cannot follow it as written. Either the published ports move into environment
variables with those defaults, or `README.md` documents a `compose.override.yaml`. Until then the
first-run experience on a busy machine is a failure with no explanation.

### 2026-09-04 — `packages/db/src/schema.ts` has no page-content storage

After Phase 1, the schema holds 11 tables (`plans`, `users`, `workspaces`, `nodes`,
`cells`, `cell_members`, `permissions`, `sessions`, `password_resets`,
`instance_settings`, `invitations`) and every one of them is tenancy or authentication.
`nodes` models the tree structure (id, `workspace_id`, `parent_id`, `type`, `position`,
path) but carries no column for a page's markdown body.

**Impact:** the Phase 2 roadmap did not previously name content storage as its own
task, leaving a hole between "the tree exists" and "the editor can persist a document" —
added as an explicit Phase 2 task above so the gap is closed in the plan, not just
noted.

### 2026-09-04 — The `remark-stringify` list/emphasis pin has no Findings entry

`packages/markdown/src/index.ts` pins the serialiser with
`unified().use(remarkStringify, { bullet: '-', emphasis: '_' })`. This is load-bearing:
remark's own defaults silently renormalise `-` list markers to `*` and `_` emphasis
markers to `*`, which would make any byte-identical round-trip guarantee impossible.
Until now the constraint existed only as a code comment and in Phase 0's archived
`tasks.md` (line 96) — not discoverable here.

**Impact:** serialiser options must be pinned and asserted by test, never left to
remark's defaults, and GATE-2's eventual byte-identical guarantee depends on this
pin holding. A constraint that lives only in a code comment is not findable by whoever
needs it once Phase 2 grows the fixture corpus — hence this entry.

### 2026-09-04 — Nuxt UI's `required` prop sets no `required` attribute on the input

Found while removing the redundant red asterisks from the auth forms. `UFormField`'s `required`
prop in Nuxt UI v4 renders an `after:content-['*']` glyph and nothing else: `UAuthForm`'s
`omitFieldProps` strips `required` before the field props reach the input component, so
`input.required` is `false` and `aria-required` is `null`. This was already the case before the
asterisks were touched — removing them changed the visuals, not the semantics.

**Impact:** every form in this product needs the required semantics asserted explicitly rather
than assumed from the prop. A screen reader is currently not told which fields are required on
the auth screens. This is an accessibility floor item (§5, "every form input has a
programmatically associated label" and its neighbours) and it is open, not fixed. Any form work
in a later phase must set the attribute itself and cover it with a test, because the library's
prop name promises something it does not deliver.

### 2026-09-04 — Login and password-reset have no rate limiting

The non-disclosure response on both routes (Phase 1, `apps/api/src/routes/auth.ts`)
already closes the account-enumeration oracle: a failed login and a request for a
non-existent account return the same shape. It does nothing against online brute force
— an attacker can still hammer the endpoint with password guesses.

**Impact:** deliberately deferred, not an oversight. Tracked as a known gap (see "Known
gaps carried forward") that must be closed before any public deployment. Do not treat
its absence here as something to silently fix; it needs a real rate-limiting design
(per-account and per-IP, with a store that survives a restart), not a quick patch.

### 2026-09-04 — `role` reserved as a `subject_kind` with no Phase 1 producer

`subject_kind` was defined as `user` | `cell` | `role` | `agent` (`packages/db/drizzle/0001_tenancy.sql`)
even though nothing in Phase 1 ever grants a `role`-typed permission — there is no
producer for it yet.

**Impact:** deliberate, not scope creep. Adding a Postgres enum value later is a cheap
`ALTER TYPE … ADD VALUE`; removing one is not, so the value is committed now while the
enum is still young rather than deferred and paid for at a worse time. The reasoning is
recorded as a SQL comment on the enum declaration itself, so it survives independently
of this file.

### 2026-09-04 — `packages/contracts` was not carrying the API contract

Phase 0 defined `packages/contracts` as "shared request/response schemas, the single source of
truth for the API surface consumed by `apps/web` and `apps/api`". After Phase 1 work units 9-16
it held only the environment schema, and **no route imported it**: the login, password-reset,
registration, invitation and upload routes each declared inline TypeScript interfaces instead.

Nothing failed, which is the problem. A package can quietly stop doing its job while every gate
stays green, because "is this package fulfilling its stated purpose" is not something typecheck,
lint or tests can ask.

**Impact:** caught before the UI work unit rather than after. Had it shipped, `apps/web` would
have hand-written a second copy of every request and response shape, and the two would drift the
first time a field was renamed — the API would change, the web app would keep compiling against
the stale shape, and the failure would surface at runtime in production rather than in the build.
The request and response schemas move into `packages/contracts` as zod, both apps consume them,
and the UI is built on the shared types from its first line.

### 2026-09-03 — Spec and design disagreed on whether the workspace is a row

`sdd-spec` and `sdd-design` ran in parallel on Phase 1 and reached opposite conclusions about
the same structure. The spec followed `docs/SPECS.md` §3.1 literally and made the workspace an
implicit ancestor that is never materialised. The design added a fifth `node_type` so the
workspace is a real row.

The disagreement exposed that `docs/SPECS.md` was already self-contradictory: line 134 declared
`node_type` with four values while line 234 used that same enum listing five. Neither agent was
wrong about the document; the document was wrong.

**Impact:** the design's position is adopted. The workspace is a real `nodes` row, because a
special case inside the authorisation query is precisely where an isolation bug hides, and one
extra row per workspace is a trivial price. Two related rulings adopted with it: authorisation
walks `parent_id` rather than the derived `path` cache, since a stale cache would grant or deny
silently; and `resource_type` is not stored on `permissions` at all, because a duplicated value
that can disagree with the tree is an authorisation bug waiting to happen. `docs/SPECS.md` §3
and §14 and the delta spec are reconciled.

The general lesson is worth keeping: running spec and design in parallel is cheap and it
surfaces contradictions in the source documents that a sequential run would have inherited
silently, because the second phase would simply have followed the first.

### 2026-09-03 — The appliance question is answered: Postgres, door left ajar

`docs/TODO.md` carried an Open Question — whether "download one binary, run it, no Postgres"
is a distribution goal — that explicitly demanded an answer before Phase 1 hardened the
persistence layer. Phase 1 is that hardening, so `sdd-propose` stopped and surfaced it rather
than deciding it.

**Answer: no appliance, but do not close the door.** The deciding argument is that deep-wiki
already requires five services — Kroki renders diagrams, MinIO stores blobs, Mailpit relays
mail. None of those fit in a binary. Swapping the database for SQLite would therefore not buy
the one-click install that motivates an appliance; it would only cost `pgvector`.

**Impact:** the rule is a cost test, not a purity test. Avoid a Postgres-only feature when the
portable equivalent is nearly as good; accept one when it buys something the product needs.
Concretely: the `nodes` materialised path is `text` with a `text_pattern_ops` index, **not**
`ltree` with GiST — the portable form is barely worse and `ltree` would have been a third hard
lock-in for little gain. Recursive CTEs stay, because SQLite supports them and they cost no
portability at all. `pgvector` stays and is accepted as a real lock-in, because RAG over the
corpus is core and has no equivalent-maturity alternative. The Bun + Hono backend decision
stands unchanged.

A related defect surfaced while verifying this: `infra/postgres/init/01-extensions.sql` lives
in `/docker-entrypoint-initdb.d`, which Postgres runs **only against a fresh data directory**.
Any developer with an existing `pgdata` volume would silently never receive a new extension.
Extension creation therefore belongs in a migration; the init script covers fresh bootstraps
only.

### 2026-09-03 — The CI pipeline had no way to run

`.github/workflows/ci.yml` targets GitHub Actions runners, but this repository has no git
remote configured at all. The `ci-pipeline` capability was therefore declared in the baseline
specs while nothing actually enforced it: the four gates passed only when run by hand.
This was originally logged as "CI has never run on Actions", which understated it — it was
not unverified, it was unenforceable.

**Impact:** enforcement is local until a remote exists. `.githooks/pre-commit` runs
`bun run check` on every commit (0.3s — the structural gates that catch a framework import in
`packages/core`, an uncovered package, a drifted env template, a non-portable compose file),
and `bun run verify` runs all four gates before tagging a milestone. The workflow file is
kept and stays correct for the day a remote is added. The slow gates stay out of the commit
hook deliberately: a hook costing over a minute gets bypassed with `--no-verify`, and a
bypassed gate is worse than an honest manual one.

### 2026-09-03 — `podman compose` (podman-compose 1.6.0) supports `:?` and `service_healthy`

Verified directly on this machine rather than assumed: `podman compose config -q` against
`compose.yaml`'s `${POSTGRES_USER:?message}`-style interpolation exits `0`, and a throwaway
two-service probe file using `depends_on: { a: { condition: service_healthy } }` also exits
`0` under `config -q`. Both were open questions in design.md's fallback ladder.

**Impact:** `compose.yaml` keeps fail-fast `${VAR:?message}` interpolation exactly as
originally designed — no fallback to plain `${VAR}` defaults was needed. Also confirmed
`podman compose` here delegates to an external `podman-compose` provider (not a Go-native
`podman compose`), which is why the compose file must stay strictly on Compose-specification
syntax: `container_name`, `develop.watch`, and any other Docker-specific extension are
rejected by `scripts/checks/compose.ts`, not merely discouraged by convention.

### 2026-09-03 — Nuxt component testing requires Vitest; `bun test` cannot do it

Verified against the official Nuxt 4 testing documentation, which states that `@nuxt/test-utils`
"currently only has support for vitest". The blocker is not Vue SFC compilation — it is the Nuxt
runtime environment. A Nuxt component resolves virtual modules such as `#app`, `#imports` and
`#components`, which exist only inside a Nuxt-built environment. A Bun SFC loader would compile
the file and still fail to resolve those specifiers, which is worse than not solving it because
it looks like it works. The same docs confirm Jest, Cucumber and Playwright are supported for
end-to-end testing only.

**Impact:** `apps/web` gets a scoped Vitest + `@nuxt/test-utils` adapter; every other workspace
member stays on `bun test`. Node is a development-only prerequisite for that runner — `nuxt build`
still runs under Bun, so self-hosters are unaffected. `bun run --filter '*' test` propagates any
non-zero child exit, so two runners still report as a single CI gate. A structural check asserts
Vitest appears in exactly one workspace member, so the second runner cannot spread silently.
The rejected alternative was TypeScript-only tests for `apps/web`, which would have made the
red-green loop for any component a full Playwright run against a booted server — too slow to
drive design, leaving the entire UI phase structurally exempt from Strict TDD.

### 2026-09-03 — The base Kroki image cannot render Mermaid

Verified against the official Kroki installation documentation: the `yuzutech/kroki` image does
not render Mermaid by itself, and additional diagram libraries require companion containers.
Mermaid needs `yuzutech/kroki-mermaid`.

**Impact:** the container stack carries five services, not four. This is not optional — `docs/SPECS.md`
section 6 makes Mermaid the primary diagram format, so a Kroki deployment without its Mermaid
companion cannot render the project's main diagram type. Discovering this during Phase 4 is
precisely the late failure Phase 0 exists to prevent. The sidecar's compose service is named
`mermaid` (not `kroki-mermaid`, which is only the image name) because `KROKI_MERMAID_HOST`
must resolve as a hostname on the compose network — `kroki` sets `KROKI_MERMAID_HOST=mermaid`,
and verified end to end (not just "the container starts"): a real Mermaid diagram POSTed to
`kroki`'s `/mermaid/svg` endpoint returns a rendered SVG (`scripts/checks/compose-smoke.ts`).

### 2026-09-03 — An open-by-default self-hosted instance gets spam-registered

A publicly reachable instance with open registration is discovered and abused within days,
and the operator attributes the failure to the software.

**Impact:** `registration_mode` defaults to `invitation_only`. `open` additionally requires
a verified SMTP configuration, because open registration without working mail produces
silent invitation and password-reset failures that are undebuggable from the outside.

### 2026-09-03 — Self-hosters will not run MinIO

MinIO is the right dev dependency and the wrong production assumption. A single-VPS operator
will not stand up an object store to run a wiki.

**Impact:** `BlobStore` is a port in `packages/core` with two adapters — S3-compatible and
local filesystem — selected by environment. The same pattern applies to `MailSender`:
plain SMTP must remain a first-class option, so no SaaS mail provider gets hard-coded.

### 2026-09-03 — Dynamic icon names defeat `@nuxt/icon` tree-shaking

Letting users choose an icon pack at runtime means icon names are not statically analysable,
which breaks build-time tree-shaking. Separately, an air-gapped instance cannot reach the
Iconify API at runtime.

**Impact:** bundle the supported collections locally via `@iconify-json/*` and constrain
icon names to a per-pack allowlist rather than allowing arbitrary dynamic resolution.

### 2026-09-03 — Fedora podman imposes two constraints docker does not

Bind mounts under SELinux need `:z` (shared) or `:Z` (private) labels or the container gets
permission denied. Rootless podman cannot bind host ports below 1024.

**Impact:** every bind mount in `compose.yaml` carries `:z` (ignored harmlessly by docker in
production), and all published host ports stay at 1024 or above, with the reverse proxy
owning 80/443 in production. One spec-compliant compose file serves both runtimes; no
docker-specific extensions.

### 2026-09-03 — Character offsets into markdown break on edit

Comments anchored to character positions detach as soon as anyone types above them. The same
problem breaks AI selection ranges and produces unreadable diffs.

**Impact:** stable block IDs are the anchor primitive across the whole product. Comments
anchor to `(block_id, offset_within_block)`, AI selections reference block ranges, RAG chunks
key on block IDs so citations resolve, and diffs compare block sets — which makes "moved"
detectable, something a line differ cannot express.

### 2026-09-03 — Embeddings are not swappable after indexing

Changing the embedding model changes the vector space and usually the dimension count.
Mixing two models in one index silently corrupts retrieval rather than raising an error.

**Impact:** `embedding_model` and `dimensions` are stored on every chunk row, mixed writes
are rejected, and switching models requires an explicit, tracked, resumable reindex job.

### 2026-09-03 — Chat providers and embedding providers are not the same set

Provider coverage for embeddings differs from coverage for chat, and the gap is not uniform
across Anthropic, OpenAI, Gemini, DeepSeek and OpenRouter. Assuming a workspace's chat
credential can also produce embeddings will break RAG for some configurations.

**Impact:** `chat_provider` and `embedding_provider` are independent configuration entries
with independent credentials. Each provider's embedding support must be verified before it
is wired, and the result recorded here. A local embedding fallback ships so an operator
holding only a chat credential still gets working retrieval.

### 2026-09-03 — Two markdown parsers would be a permanent bug class

The editor is ProseMirror-based and therefore TypeScript. If the server parsed the same
markdown with a different implementation (goldmark in Go versus unified/remark in TS), the
two would disagree on edge cases. The failure mode is subtle: backlinks the server indexed
that the editor does not render, chunk boundaries that do not match visible blocks, comment
anchors pointing at blocks the server split differently. Reconciling them would require a
conformance suite maintained indefinitely.

**Impact:** the backend is Bun + Hono rather than Go, so `packages/markdown` is imported by
the editor, the API and the indexer alike. Go remains the right choice for stateless
satellites that need no markdown semantics — the future CRDT hub and the indexing worker —
but not for the document pipeline.

---

## Fixes

Defects found and repaired. Newest first.

**Entry format**

```
### YYYY-MM-DD — Short title

Symptom: what was observed.
Cause: the actual root cause, not the first suspicion.
Fix: what changed, with the commit or PR reference.
Impact: what else this touches, or "contained".
```

### 2026-09-09 — A dev machine could connect to another project's Postgres and read it as a deep-wiki bug

Symptom: twice. Once the owner saw "a workspace and no pages" and the seed was chased; once an
e2e server's database was browsed while debugging the dev one. Both times the connection
succeeded — the wrong data is what was wrong.
Cause: `env.example` ships the conventional `localhost:5432`, and on this host that port (with
1025, 8025, 9000 and 9001) belongs to an unrelated `menukap` compose project. A port check
cannot see this: the port is open, it is simply the wrong server, and both halves of the
configuration agree on 5432, so `scripts/checks/env-consistency.ts` is the wrong home for it.
Fix: `packages/db/src/database-identity.ts`. `guardDatabaseIdentity(sql)` wraps a `postgres.js`
client and, on the **first query only**, asks one round trip whether `public.workspaces` and
`public.cell_members` are there. Identity is that pair: `workspaces` alone is too common a table
name, and `drizzle.__drizzle_migrations` identifies any Drizzle project. Applied to the one
long-lived application client in `apps/api/src/index.ts`. Not applied to `createDb`, whose only
consumer is the migrator — a migrator must be able to run against a database without our schema.
Impact: three distinct messages, because "somebody else's database" and "our own database
before migrations have run" must never read the same — the second is the normal state on first
setup. The seam is `postgres.js`'s per-query `handler`, which is internal to the driver; the
real-database tests in `database-identity.test.ts` are what would catch a driver upgrade moving
it. `env.example` keeps 5432 — `docs/RUNNING.md` §6's ruling stands, the probe is the fix and
the default was never the problem.

### 2026-09-04 — `setRegistrationMode` reconciled SMTP verification only on the way to `open`

Symptom: none observed in use — found by reading the reconciliation path while auditing
registration policy.
Cause: `setRegistrationMode` called the reconciling read only when the target mode was `open`,
on the assumption that a stale SMTP verification only matters where `open` depends on it. It
also matters everywhere else, because the stale value stays readable and the next caller that
does depend on it inherits it.
Fix: the reconciling `getInstanceSettings` call is now unconditional, so a verification
invalidated by an SMTP config change is cleared regardless of which mode is being set. Note
that the clear is keyed to a config-hash change, not to the mode switch itself — an unchanged
SMTP configuration keeps its verification, which is correct.
Impact: contained to `packages/db/src/auth/instance-settings.ts`.


### 2026-09-04 — `permissions` unique key could not represent an allow and a deny together

Symptom: truth-table cases B1–B4 (a subject must hold both an allow and a deny row on
the same resource and action, for `decide()` to have anything to arbitrate) were
structurally unrepresentable — inserting the second row conflicted with the first.
Cause: the migration's unique constraint was `(workspace_id, subject_type, subject_id,
resource_id, action)`, one column short.
Fix: `effect` added to `permissions_unique_grant`
(`packages/db/drizzle/0003_permissions.sql`). Caught by writing the truth-table tests
before the migration, per Strict TDD — the RED test could not even seed its fixture.
Impact: contained to the migration; nothing else depended on the narrower key.

### 2026-09-04 — Allow/deny action filters were crossed backwards in the resolver's query layer

Symptom: the action lattice comparison in `resolveGrants` used
`impliedAllowActions`/`impliedDenyActions` uncrossed against the requested action, which
would have widened the effective grant beyond what a stored row actually authorises.
Cause: `impliedAllowActions(action)`/`impliedDenyActions(action)` describe the lattice
from the *stored row's* point of view; applying them directly to the *requested* action
instead of swapping them mixes up which stored rows qualify as a covering allow versus a
blocking deny.
Fix: `packages/db/src/permissions/queries.ts` crosses them —
`allowActions: impliedDenyActions(query.action)`, `denyActions:
impliedAllowActions(query.action)` — with the reasoning kept as a code comment so the
crossing survives the next reader.
Impact: caught by the GATE-1 truth table before merge; no production exposure.

### 2026-09-04 — `substring(text FROM <untyped number>)` resolved to postgres.js's regex overload

Symptom: reparenting a node risked silently producing a NULL `path` for the moved
subtree.
Cause: `postgres.js` resolves an untyped numeric bind parameter in
`substring(path FROM $1)` to the TEXT/regex overload instead of the integer-position
overload, so the position argument was treated as a pattern rather than an offset.
Fix: explicit `::int` cast on the bind parameter
(`packages/db/src/nodes/subtree.ts`, `rewriteDescendantPaths`). Verified directly
against this `postgres.js` version and this Postgres.
Impact: contained to that one query.

### 2026-09-04 — Fresh-clone install could not resolve `happy-dom` under Bun's isolated linker

Symptom: `git clone` + `bun install --frozen-lockfile` failed `apps/web`'s component
tests with "Could not resolve happy-dom imported by @nuxt/test-utils", even though
`happy-dom` was correctly listed in `apps/web`'s own `devDependencies`.
Cause: Bun's default isolated linker gives every dependent its own private
`node_modules` tree; it does not reliably create a resolvable symlink for
`@nuxt/test-utils`'s optional peer dependency on `happy-dom`.
Fix: `bunfig.toml` sets `install.linker = "hoisted"`. Verified this does not
reintroduce the Nuxt/Astro divergent-Vite-major conflict the isolated linker was
originally relied on to avoid.
Impact: contained to install configuration; the reasoning is documented in
`bunfig.toml` itself.

### 2026-09-04 — `getInstanceSettings` clobbered an explicit `closed` mode on SMTP config drift

Symptom: reconciling a changed SMTP configuration reverted `registration_mode` to
`invitation_only` unconditionally on any hash mismatch, even when an operator had
explicitly chosen `closed`.
Cause: the revert branch always wrote `invitation_only` without first checking what
mode was actually in effect.
Fix: `packages/db/src/auth/instance-settings.ts` now reverts only when the current mode
is `open`; an explicit `closed` (or `invitation_only`) passes through unchanged.
Impact: contained to `getInstanceSettings`.

### 2026-09-06 — Block-match threshold τ = 0.5 is a judgement, not a measurement

`packages/markdown/src/match-blocks.ts`'s `MATCH_THRESHOLD` decides whether a
persisted block ID (design.md §"Block identity", docs/SPECS.md §3.3) follows a
split or merged block, or is tombstoned instead. Below τ, an ID is never
reassigned onto content the matcher is not confident is recognisably the same
text.

**The bias:** an orphaned anchor is preferred over a misattributed one. A
comment or citation silently landing on the wrong block is worse than one that
visibly breaks, because the orphan is detectable (its excerpt is retained,
UI-CHECKLIST §4.7) and the misattribution is not.

**The reversal criterion:** τ = 0.5 is deliberately conservative and has no
measurement behind it yet. It should move only when a measured mis-assignment
rate at this threshold, taken from real edit traffic once Phase 3's comments
ship, shows it is costing more orphans than the misattributions it is
preventing. Until then this is a one-constant change, not a mechanism change
(design.md D8).

Impact: `packages/markdown/src/match-blocks.ts` only; `packages/db`'s save
transaction (a later phase) calls `matchBlocks` but does not itself decide τ.

### 2026-09-06 — `render()` does not yet hyperlink wiki-links, which is why non-disclosure holds today "for free"

`packages/markdown/src/render.ts` runs an unextended `remark-parse` pipeline
(WU-5's own deferred gap): a `[[Target]]` wiki-link is not a custom node to
this pipeline, so it renders as literal bracketed text, never as an `<a>`.
knowledge-graph's "Unresolved-Link Rendering Does Not Disclose Existence"
(a resolved and an unresolved wiki-link must render identically) is
therefore satisfied today by construction — `render()` has no channel to
receive a link's resolution status at all, since that status lives only in
`packages/db`, resolved per save against the workspace's pages.

**The real gap this masks.** `page_content.rendered_html` is cached once
per save and served to every viewer identically (page-content spec: Read
Mode Serves Pre-Rendered HTML Without Reparsing). Once `render()` is
extended to actually hyperlink a *resolved* wiki-link, that cached HTML
cannot safely bake in "resolved -> `<a href>`" at save time: a viewer who
cannot read the target must still see it exactly as unresolved, but
permissions are per-viewer and the cache is per-page. Closing this
properly needs one of: (a) a per-request rewrite pass over the cached HTML
that re-checks each embedded link's target against the current viewer via
`canManyResources` before serving, or (b) rendering every wiki-link as an
inert placeholder resolved client-side through the same non-disclosing
endpoint mention/backlink autocomplete already use. Whichever is chosen
must preserve the identical-treatment property this Finding currently gets
for free — it will not survive naively wiring in `<a href="/pages/{id}">` at
save time.

Impact: `packages/markdown/src/render.ts` (wiki-link hyperlinking, not yet
implemented); `apps/api/src/routes/pages.ts`'s read route, whichever
approach above is chosen, once this is picked up.

### 2026-09-06 — Bundle-isolation's three layers do not all run in the same place yet

design.md "Read mode never reaches the ProseMirror bundle" names three
enforcement layers. Stated plainly, since the gap does not close itself:

- **Layer 1** (the `packages/editor` export-map split) is static
  `package.json`/`src/index.ts` shape, not something that "runs" at all.
- **Layer 2** (`scripts/checks/bundle-isolation.ts`, the specifier check)
  runs today, inside `bun run check` — and therefore inside `bun run test`'s
  sibling and any CI workflow that calls either.
- **Layer 3** (the build-manifest test asserting the read route's chunk
  closure) needs real `nuxt build` output to inspect and cannot run inside
  `bun run test`. It lands in WU-15 as `bun run check:bundle` after a local
  build, and as a dedicated CI step placed after the build step. This
  repository has no remote, so "in CI" today describes a workflow file
  nothing executes — the actually-enforcing run is the local one.

Also fixed in this pass, not merely recorded: layer 2's own denylist could
not be `prosemirror-*` read literally, because the `"."` export's real
ProseMirror schema needs `prosemirror-model` — design D21 scopes the
denylist to exclude that one package while keeping every ProseMirror
view/editing package (and Milkdown, and TipTap) forbidden.

Impact: `scripts/checks/bundle-isolation.ts` (exists, enforced locally
today); `apps/web`'s build-output test and its CI step (WU-15, not yet
created); `.github/workflows/ci.yml` (WU-18 adds GATE-2 as a named step
under this same "no remote executes it yet" constraint).

### 2026-09-07 — `pipeline_version` couples render and chunk versions as an accepted cost

`page_content.pipeline_version` (design.md, `page_content` schema; D11) is
one integer covering both the render pipeline and the chunk-boundary
policy. Bumping it means "rerender and, from Phase 5 onward, reindex" — a
render-only change therefore forces an unneeded reindex, which is accepted
as cheaper than two independently-tracked versions that can silently
disagree and leave a citation resolving to nothing.

**What a two-column split would take**, if a measured reindex cost from
real Phase 5 traffic later shows the coupling is expensive (design.md D11's
own reversal criterion): a migration adding the second column backfilled
from the current `pipeline_version`; splitting the "bump on pipeline
change" call site so a render-only change stops touching the
chunk-boundary version; and Phase 5's reindex job keying off its own column
instead of the shared one.

**Cross-references, not restated here** (recorded in full where task 3.6
and task 14.5 landed them, to avoid duplicating a Finding): the block-match
threshold `τ = 0.5` is a judgement, not a measurement — see "2026-09-06 —
Block-match threshold τ = 0.5 is a judgement, not a measurement," above.
The bundle-isolation CI gap — layer 2 runs today inside `bun run check`,
layer 3 needs a CI step this repository's remote-less state cannot
execute — see "2026-09-06 — Bundle-isolation's three layers do not all run
in the same place yet," above.

Impact: `packages/db/src/schema.ts` (`pipeline_version`, unchanged by this
entry — documentation only); no code change.

### 2026-09-07 — A slash command that could not apply still ate the user's typed text

Symptom: type `/quote` inside a table cell, press Enter — the six characters
disappear, no blockquote appears, and the keypress is reported as handled so
nothing else runs either.

Cause: `confirmSlashCommand` discarded `command.run`'s boolean. A ProseMirror
`Command` returns `false` *without calling dispatch* when it cannot apply, but
the transaction had already been built with the trigger-text `delete` in it,
and the sole call site dispatched it unconditionally. Reachable because
`schema.ts` gives `tableCell` the content `inline*`, so it can host no block at
all and `wrapIn`/`setBlockType`/`wrapInList` all refuse there — while
`trigger.ts`'s `isInsideCodeBlock` is the only content-context guard on trigger
activation and does not exclude inline-only containers.

A second defect of the same shape sat beside it: the `divider` command called
`dispatch` unconditionally after `replaceSelectionWith` and always reported
success. `Transform.replaceRange` escalates depth until the slice fits, so
inside a table cell it did not no-op — it walked out of the whole table and
appended the horizontal rule *after* it, leaving `/divider` sitting in the cell.

Fix: `SlashCommand.run` now takes an OPTIONAL dispatch, which is the real
ProseMirror `Command` contract and makes `run(state)` a dry run;
`confirmSlashCommand` returns `Transaction | null` and returns `null` unless the
command both reported success and actually dispatched; `divider` checks
`canInsertAtCaret` (the caret's own container only, unlike
prosemirror-example-setup's `canInsert`, which walks up ancestors and would call
the escalated placement legal); and the menu no longer *offers* a command that
cannot run where the caret is (`applicableSlashCommandIds` +
`filterSlashCommands(query, applicable)`), so a table cell shows the existing
no-results state instead of eight dead entries.

Impact: `confirmSlashCommand`'s return type is a public API change within
`packages/editor` (exported through `src/mount/index.ts`); its only call site is
the plugin's own `handleKeyDown`. `packages/editor/src/mount/insertions.test.ts`
now exercises all eight commands in an inapplicable context — it previously
tested them only against a bare single-paragraph document, which is exactly why
this shipped.

### 2026-09-07 — The coverage gate credited type-only imports and commented-out assertions

Symptom: none observed — found by adversarial review of the commit that
introduced per-file coverage. A file full of untested runtime logic passed
`bun run check` as soon as any test imported one of its exported *types*, or as
soon as a test file carried a commented-out `expect(`.

Cause: three independent holes in `scripts/checks/test-coverage.ts`.
`NAMED_IMPORT` matched `import type { X } from` exactly as it matched a value
import, and `BARE_FROM` credited the specifier of *any* `from '…'` besides —
so a type-only statement earned E1 credit even with no names taken from it. A
type-only import erases at compile time and cannot exercise a line; crediting it
is the mirror image of the hole `core-purity.ts` already documents, where
`Bun.Transpiler().scanImports()` elides exactly these and a raw scan had to be
added to see them. Separately, `hasAssertion` ran its regex over the raw bytes,
so `// TODO: expect(bar(1)).toBe(2)` both certified a module and hid the
placeholder test carrying it from the assertion-free rule — the gate broke its
own invariant twice in one line, while `stripComments()` sat unused two
functions above it. Finally `CONFIG_FILE_PATTERN` matched on the basename alone,
so a hypothetical `packages/core/src/retry.config.ts` holding real logic was
exempt, in a file whose header promises exemptions are mechanical rather than by
name.

Fix: one `blankNonCode` scanner now answers "which bytes of this file are code"
once — comments always, string and template contents on request, with regex
literals recognised so `/["']/` neither opens a string nor eats a line —
and `stripComments`/`stripCommentsAndStrings` are two questions asked of it
rather than two implementations. `scanImportRecords` drops type-only statements
entirely (no names *and* no bare specifier) in every spelling: whole-clause,
inline `{ type X, y }` where `y` still counts, `import type X from` (default),
and `export type { X } from`; `scanReExports` leaves type-only re-exports out of
the map `credit()` walks a barrel by, so a type name is never carried through
one. X3 keeps the `<tool>.config.<ext>` name test and adds the structural half
that makes it mechanical: a tool loads its config by path, so no module imports
it — a `*.config.ts` something imports is a module.

One more defect surfaced while running the corrected gate across the repository
to check for lost credit: `checkTestCoverage` did not normalise its root
argument, and `resolveSpecifier` always produces absolute paths while `walk`
inherits whatever shape the root was given. Under a relative root E1/E2
therefore credited nothing, and `bun run scripts/checks/test-coverage.ts .`
reported nine files that the same check with no argument does not. Fixed with a
`resolve()` and a test asserting the two spellings agree.

Impact: **no real file in this repository loses coverage credit** — the gate's
output over the whole tree is byte-identical before and after, and green. The
holes were real and reachable (repo test files carry 14 whole-clause type-only
import statements and 48 inline `type X` specifiers) but none was load-bearing:
every target is also reached by a genuine value import or a sibling test. All
six `*.config.*` files keep X3, including `apps/web/app/app.config.ts`, which
sits under `app/` rather than at the member root and which nothing imports.
Fixtures kept permanently at `scripts/checks/__fixtures__/test-coverage/`:
`type-only-import`, `commented-assertion`, `nested-config`.

---

## Open Questions

Decisions still owed. Move an entry out of this section once answered and record the answer
in Findings.

- **What a bodyless 409 should mean.** `useSavePage` and `useEditSession` both do
  `responseBodyOf(error) as {…}` on a 409 and then read a field off the result — `body.canonical`
  and `body.reason`. `responseBodyOf` returns `undefined` when the response carried no body, so a
  409 with an empty body throws inside the catch block and the `status` ref never leaves
  `'loading'`: the identical blank-skeleton hang the 2026-09-09 finding repaired, through a door
  that finding did not close. It is not reachable from our own API today, which always sends a
  body on the 409s it raises; it is reachable from a proxy, a gateway, or the next endpoint
  someone writes.
  Left unchanged deliberately, and that was the right call. `?? {}` would stop the throw by
  **inventing a classification**: an empty object reads as `stale` in `useSavePage` ("Someone
  else saved a newer version") and as `refused` with no reason in `useEditSession`, and a screen
  that states a cause the server never gave is a worse failure than a visible one. The decision
  owed is which honest answer to take — fail loudly on a bodyless 409, surfacing it as an error
  state that names the malformed response, or classify it as an explicit unknown state the UI
  can render as such. Both are defensible; guessing between them in a `??` is not.

- **Two canonical constructs the editor cannot round trip.** Both fail closed at the probe, so no
  saved document is corrupted — edit mode simply refuses to open them — but neither fits an existing
  fixture bucket, because `modelled/` requires a byte-identical round trip and `refused/` requires
  the source to be non-canonical. These are canonical markdown that the editor cannot represent.
  1. **Inline images.** `![alt](url)` throws `UnsupportedConstructError`; `image` is in neither the
     ProseMirror schema nor `VERBATIM_INLINE_TYPES`. Reference-style images work.
  2. **Mark nesting is fixed by declaration rank.** `~~removed __bold__~~` serialises to the
     corrupted `~~removed ~~__~~bold~~__`, and `[__bold link__](url)` inverts to
     `__[bold link](url)__`. `schema.ts` documents this for `strong`/`emphasis` only; it applies to
     `delete` and `link` too.
  The decision owed is whether the editor gains real support (a schema node for images, nesting-aware
  mark serialisation) or whether refusal becomes the documented product behaviour with a message
  telling the author why. Refusing silently on a construct as ordinary as an inline image is not a
  stable answer.
- **The mention menu's ARIA ownership is incomplete on a screen the owner already passed.** The
  editor `div` sets `aria-activedescendant` to an option id that is **not its descendant**, carries
  no `aria-controls`/`aria-owns`, no `role="combobox"` and no `aria-expanded`, and the options sit
  inside a plain `<ul>` between the `role="listbox"` and its `role="option"` children. Under the
  ARIA spec both break listbox ownership, so most screen readers will announce nothing as the arrow
  keys move the highlight — even though the `aria-activedescendant` value itself is correct and
  tested. Fixing it is a markup change to a surface reviewed and passed on 2026-09-07, so it needs
  the owner's review rather than a silent in-batch edit (UI-CHECKLIST §1). Until then the keyboard
  path works visually and is untrustworthy assistively.

- **Rule pack sharing scope.** Are rule packs shareable only across books within a single
  workspace, or across workspaces entirely? Cross-workspace sharing requires packs to carry
  their own ownership and permission model rather than inheriting a workspace's. A related
  question: is a public rule-pack registry (importable convention sets) a product goal?
  This is architecturally decisive and blocks the Phase 6 data model.
- ~~**Embedding provider and model to standardise on.**~~ **Answered 2026-09-04: 1536 dimensions.**
  `text-embedding-3-small` native; `text-embedding-3-large` reachable via OpenAI's `dimensions`
  parameter. The open part that remains is narrower and belongs to Phase 5: **find a local embedding
  model that emits exactly 1536 dimensions, or record that self-hosted air-gapped RAG is unavailable.**
  bge-m3 and e5-large emit 1024 and cannot fill the role. See `docs/SPECS.md` §14.
  Superseded original text follows.
- **Embedding provider and model to standardise on.** Drives the default `dimensions`, the
  pgvector column definition, index sizing, and what the local fallback must match. Needs
  the per-provider embedding-support verification from Phase 5 first.
- **`packages/ai-tools` discrepancy between `docs/SPECS.md` §13 and the roadmap.** §13's
  repository layout lists `packages/ai-tools` as already part of the tree; the roadmap
  does not create it until Phase 7 (MCP and agent surface). Flagged as a known doc
  discrepancy in `openspec/changes/tenancy-and-permissions/proposal.md` and in Phase 0's
  archive report; deliberately left unresolved so it does not pull Phase 7 scope forward.
  Reconcile the two documents when Phase 7 actually creates the package.
- ~~**Single-binary + SQLite appliance distribution.**~~ **Answered 2026-09-03: no, but do
  not close the door.** Postgres is the engine. The Bun-versus-Go backend decision stands.
  Engine-specific features are avoided where the cost of avoiding them is low, and accepted
  where they buy something the product genuinely needs — see the Findings entry for the
  reasoning and the exact line between the two.

---

## Known gaps carried forward

Accepted, not fixed. Do not "clean up" one of these without discussion.

- **No rate limiting on login or password reset.** The non-disclosure response closes
  the account-enumeration oracle but not online brute force. Deferred deliberately; see
  the Findings entry above. Must be addressed before any public deployment.
- **CI cannot run.** There is no git remote, so `.github/workflows/ci.yml` never
  executes. Enforcement is local: `.githooks/pre-commit` runs `bun run check` on every
  commit, and `bun run verify` runs all four gates before tagging.
- **Icon rendering verified with only the `lucide` collection.** The UI checklist's
  two-icon-pack requirement (`docs/UI-CHECKLIST.md` §11.1) is untested; carried forward
  from Phase 0's archive report.
- **The live-region screen-reader announcement was verified structurally, not with a
  real screen reader.** ARIA (`role="status" aria-live="polite"`) is present and
  correct; no screen-reader tooling (NVDA, JAWS, VoiceOver) has confirmed it is actually
  announced. Carried forward from Phase 0's archive report.
