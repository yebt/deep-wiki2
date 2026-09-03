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

**Entry conventions**

- Roadmap items are `- [ ]` / `- [x]` checkboxes, grouped by phase.
- Log entries (Findings, Fixes) are dated `### YYYY-MM-DD — Short title`, newest first,
  and each carries an **Impact:** line stating what changes because of it.
- Keep task text concrete and actionable. "Improve permissions" is not a task;
  "Write the recursive-CTE resolver and its truth-table tests" is.
- When a phase task turns out to be wrong, strike it and add a Finding explaining why,
  rather than silently rewriting history.

---

## Cross-cutting gates

These are hard gates. Work that depends on them does not start until they are green.

> **GATE-1 — Permission truth table before any UI.**
> The recursive-CTE permission resolver must have an exhaustive truth-table test suite
> (subject types x resource levels x allow/deny precedence) passing before a single
> permission-aware screen is built. Permission bugs discovered after the UI exists are
> found by users, not by tests.

> **GATE-2 — Markdown round-trip suite before the editor ships.**
> `markdown -> ProseMirror doc -> markdown` must be byte-identical across the full
> fixture corpus, running in CI, before Milkdown is wired into a user-facing screen.
> Markdown is the source of truth; a lossy serializer silently corrupts user documents.

> **GATE-3 — `workspace_id` filtered inside every vector query.**
> Tenant isolation in retrieval is a security boundary, not a convenience. The filter
> belongs in the SQL `WHERE` clause of the similarity search. Post-filtering results in
> application code is a data leak across tenants and must fail review.

---

## Roadmap

### Phase 0 — Foundations

Monorepo, containers, CI. Nothing user-facing.

- [ ] Initialise Bun 1.4 workspace monorepo: root `package.json` with `workspaces`,
      task orchestration via `bun run -F` (explicitly **not** pnpm, **not** Turborepo —
      revisit Turborepo only when build times measurably hurt).
- [ ] Scaffold `apps/landing` (Astro) — marketing surface, no app dependencies.
- [ ] Scaffold `apps/web` (Nuxt 4) — the application shell.
- [ ] Scaffold `apps/api` (Hono on Bun) — adapters only, no domain logic.
- [ ] Create `packages/core` — domain entities and use cases. Enforce **zero framework
      imports**: no Hono, no Nuxt, no Bun-specific APIs. Add a lint rule or dependency-cruiser
      check that fails CI on a framework import inside `packages/core`.
- [ ] Create `packages/markdown` — placeholder for the shared unified/remark pipeline.
- [ ] Create `packages/contracts` — shared request/response schemas, the single source of
      truth for the API surface consumed by `apps/web` and `apps/api`.
- [ ] Create `packages/editor` — placeholder for Milkdown/ProseMirror integration.
- [ ] Create `packages/db` — schema, migrations, and the query layer.
- [ ] Write `compose.yaml` that runs unchanged under `podman compose` (local dev,
      Fedora) and `docker compose` (production).
- [ ] Compose service: `postgres` with the `pgvector` extension enabled in an init script.
- [ ] Compose service: `mailpit` (SMTP on 1025, web UI on 8025) for local mail capture.
- [ ] Compose service: `minio` for S3-compatible object storage in dev.
- [ ] Compose service: `kroki` for server-side diagram rendering, plus the
      `kroki-mermaid` companion container. The base image cannot render Mermaid, and
      Mermaid is the primary diagram format, so `kroki` must set
      `KROKI_MERMAID_HOST=mermaid` or the sidecar is never routed to.
- [ ] Apply SELinux `:z` labels to every bind mount in `compose.yaml` (required on
      Fedora under podman; harmless under docker).
- [ ] Keep all published host ports at 1024 or above so rootless podman can bind them.
- [ ] Document the local bootstrap in `README.md`: clone, `bun install`, `podman compose up`,
      migrate, seed.
- [ ] Base CI pipeline: install, typecheck, lint, unit tests, on every push.
- [ ] Add the `packages/core` purity check to CI.
- [ ] Define the `MailSender` and `BlobStore` port interfaces in `packages/core`
      (interfaces only — adapters land in Phase 1). They give `packages/core` real
      content to test and exercise the purity check against a genuine boundary.
- [ ] Workspace-wide test command covering every package and app, with at least one
      real executing test per member — a placeholder that asserts nothing does not count.
- [ ] Scoped Vitest + `@nuxt/test-utils` for `apps/web` only. Nuxt component tests
      cannot run under `bun test`; see Findings. Add a structural check asserting Vitest
      appears in exactly one workspace member so the second runner cannot spread.
- [ ] Wire Playwright for e2e and prove it boots `apps/web` with one smoke test.
- [ ] Ensure CI exercises the build of all three apps, not only the two front-ends.
- [x] Add `env.example` (copied to `.env` locally) and typed configuration loading that
      fails fast at startup with
      an actionable message naming the missing or malformed variable.
- [ ] Re-resolve `strict_tdd` to `true` in `openspec/config.yaml` once the above lands.

### Phase 1 — Tenancy and permissions

The multi-tenant skeleton and the authorisation model. This phase is where the product
lives or dies; it is deliberately front-loaded.

- [ ] Design and migrate the `nodes` table: `id`, `workspace_id`, `parent_id`, `type`
      (`shelf` | `book` | `chapter` | `page`), `position`, and an `ltree` path column for
      cheap subtree queries.
- [ ] Add the `ltree` extension and index the path column (GiST).
- [ ] Migrate `workspaces` with per-workspace settings (formats, defaults, AI config
      references, theme default).
- [ ] Migrate `users`, `cells` (teams), and `cell_members`.
- [ ] Migrate the Super Root concept: instance-level operator identity, distinct from any
      workspace membership.
- [ ] Migrate `plans` and per-workspace plan limits (workspace count per owner, seats,
      storage, AI token budget) — authored by Super Root.
- [ ] Migrate the single `permissions` table:
      `(subject_type, subject_id, resource_type, resource_id, action, effect)` where
      `subject_type` is `user` | `cell` | `role` | `agent` and `effect` is `allow` | `deny`.
- [ ] Implement the resolver as one recursive CTE that walks the resource ancestor chain
      and returns the effective grant. Precedence: `deny` wins over `allow`; the most
      specific resource level wins over ancestors.
- [ ] **GATE-1**: write the permission truth-table test suite covering every
      subject-type x resource-level x precedence combination, including inherited deny
      overriding a nearer allow, and cell membership overlapping a direct user grant.
- [ ] Expose a single `can(subject, action, resource)` entry point in `packages/core`.
      Every read and write path — HTTP, MCP, background jobs — goes through it.
- [ ] Implement `registration_mode` as an instance setting: `closed` | `invitation_only` |
      `open`, defaulting to `invitation_only`.
- [ ] Gate `open` mode behind a verified SMTP configuration; refuse to enable it otherwise
      so invitations and password resets cannot fail silently.
- [ ] Add optional `open_registration_domains` allowlist for `open` mode.
- [ ] Implement the `MailSender` SMTP adapter (port interface defined in Phase 0) and
      bind Mailpit in dev.
- [ ] Implement the invitation flow: create invite, send mail, accept, join workspace with
      a starting permission set.
- [ ] Implement the `BlobStore` adapters (port interface defined in Phase 0): S3-compatible
      (MinIO in dev) and local filesystem, selected by environment.
- [ ] Implement profile photos on top of `BlobStore`, including upload validation and
      resizing.
- [ ] Authentication: sessions, password reset over the `MailSender` port.

### Phase 2 — Content and editor

The markdown pipeline and the two document modes.

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
precisely the late failure Phase 0 exists to prevent.

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

_No entries yet — implementation has not started._

---

## Open Questions

Decisions still owed. Move an entry out of this section once answered and record the answer
in Findings.

- **Rule pack sharing scope.** Are rule packs shareable only across books within a single
  workspace, or across workspaces entirely? Cross-workspace sharing requires packs to carry
  their own ownership and permission model rather than inheriting a workspace's. A related
  question: is a public rule-pack registry (importable convention sets) a product goal?
  This is architecturally decisive and blocks the Phase 6 data model.
- **Embedding provider and model to standardise on.** Drives the default `dimensions`, the
  pgvector column definition, index sizing, and what the local fallback must match. Needs
  the per-provider embedding-support verification from Phase 5 first.
- **Single-binary + SQLite appliance distribution.** Is "download one binary, run it, no
  Postgres" a distribution goal? If it is, it reverses the Bun-versus-Go backend decision —
  the markdown-parser argument loses to the operational simplicity argument, and the
  hexagonal boundary in `packages/core` becomes the migration path rather than an
  abstraction exercise. Answer this before Phase 1 hardens the persistence layer.
