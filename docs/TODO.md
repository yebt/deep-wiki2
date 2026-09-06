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

_Last updated 2026-09-04 — HEAD `60521d8`, 63 commits._

| Phase | State |
| --- | --- |
| 0 — Foundations | Complete and archived (`openspec/changes/archive/2026-09-03-bootstrap-monorepo-foundations/`) |
| 1 — Tenancy and permissions | SDD change complete — 85/85 tasks, all 18 work units. GATE-1 satisfied. Owner-reviewed and approved (`docs/UI-CHECKLIST.md` Review Log). One broader roadmap item stays open past this change: Super Root plan-authoring admin route (see the unticked bullet below) |
| 2 — Content and editor | Not started |
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
> **Status: UNSTARTED.** `packages/editor/src/round-trip.ts` today is
> `stringify(parse(markdown))` — markdown to mdast and back through `packages/markdown`
> on both legs, proving the `remark-stringify` pin holds (see the Findings entry) but
> nothing about a ProseMirror schema, which does not exist yet. Its 7-fixture corpus
> contains none of the classes that would make the guarantee meaningful (nested lists,
> tables, code fences, footnotes, HTML blocks, hard breaks, entities, mixed emphasis).
> Only the serialiser half of this gate exists.

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

- [ ] Add page content storage to the schema. After Phase 1, `packages/db/src/schema.ts`
      holds 11 tables and every one of them is tenancy or auth (`plans`, `users`,
      `workspaces`, `nodes`, `cells`, `cell_members`, `permissions`, `sessions`,
      `password_resets`, `instance_settings`, `invitations`) — there is no column
      anywhere that stores a page's markdown. This must land before the editor can
      persist anything; see the Findings entry below.
- [ ] Build `packages/markdown` as the single unified/remark pipeline, imported by the
      editor, the API and the future indexer. No second parser anywhere in the codebase.
- [ ] Implement stable block IDs: every block-level node (paragraph, heading, list item,
      code fence, table) carries a persistent identifier that survives edits above it.
- [ ] Implement wiki-link parsing and a normalised link representation.
- [ ] Implement tag parsing.
- [ ] Implement the chunking function used later by RAG, keyed on block IDs so retrieval
      citations resolve back to a real anchor in the document.
- [ ] Build the markdown -> ProseMirror doc parser and the ProseMirror doc -> markdown
      serializer in `packages/editor`.
- [ ] **GATE-2**: assemble the fixture corpus (nested lists, tables, code fences with
      language hints, mixed emphasis, footnotes, wiki-links, tags, diagram fences, HTML
      passthrough) and assert byte-identical round-trips in CI.
- [ ] Implement Read mode: markdown rendered to HTML at save time, cached, served without
      booting ProseMirror. This is the default mode and carries the majority of traffic.
- [ ] Implement Edit mode with a soft lock: acquire on entry, heartbeat while open,
      expire on silence. Offer "take over" and "open read-only" rather than a hard block.
- [ ] Implement `@` mentions in the editor (users and cells), resolving against the
      permission model so a user cannot mention someone into a document they cannot see.
- [ ] Implement `/` slash commands in the editor (insert heading, table, diagram fence,
      callout, link to page).
- [ ] Derive and store the `links` table on every save; replace rows rather than patching.
      The graph is a projection of content and is never user-editable directly.
- [ ] Implement backlinks as an index lookup over the derived `links` table.
- [ ] Implement tag listing and tag-filtered navigation.
- [ ] Implement the navigation tree UI over `nodes` (shelves, books, chapters, pages) with
      drag reordering writing back to `position`.

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

---

## Open Questions

Decisions still owed. Move an entry out of this section once answered and record the answer
in Findings.

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
