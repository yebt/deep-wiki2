# deep-wiki — Project Specification

> Status: design baseline. This document is the reference for what deep-wiki is,
> what it must do, and why each structural decision was made. It is written to be
> read by both the team and by AI agents operating on this repository.

---

## 1. Vision

deep-wiki is a **self-hosted, multi-tenant wiki for software teams and AI agents**.

It exists to serve one flow end to end:

1. A team arrives with a raw idea, a seed document, or nothing but a concept.
2. The system **interrogates** that idea with AI — generating questions, surfacing gaps
   nobody evaluated, researching the market, and challenging assumptions.
3. That dialogue converges into a **robust, well-declared design document** plus the
   diagrams that describe the system to be implemented.
4. The wiki then becomes the team's **single source of truth**: client decisions,
   meeting outcomes, logs, schedules, budgets, architecture, and eventually the
   end-user manuals.
5. The same corpus is later served as a **RAG surface** so agents can query the
   project's accumulated knowledge.

### Positioning

deep-wiki is a fusion of two product lineages that are usually mutually exclusive:

| Lineage | What we take | What we leave |
| --- | --- | --- |
| **BookStack** | The rigid, legible hierarchy (shelf → book → chapter → page) that makes documentation navigable by people who did not write it | The PHP/MySQL operational burden and the absence of a link graph |
| **Notion / Obsidian** | The block editor, wiki-links, tags, backlinks, and the emergent knowledge graph | The proprietary hosting (Notion) and the single-user local-first model (Obsidian) |

The differentiator over both is the **AI-first authoring loop** and the fact that the
corpus is a **first-class consumption surface for agents**, not only for humans.

### Non-negotiable product properties

- **Self-hosted.** A stranger runs this on their own infrastructure. Operational
  simplicity, low memory footprint, and offline capability are product requirements,
  not nice-to-haves.
- **Multi-tenant.** One deployment serves many workspaces with hard isolation.
- **Markdown-canonical.** The content the user owns is Markdown. No proprietary
  document format, ever. An operator must be able to `git clone` their knowledge.
- **Dual-audience.** Every capability is designed for two consumers: a human in the
  UI, and an agent over MCP. Neither is an afterthought.

---

## 2. Actors and Tenancy

### Actor hierarchy

| Actor | Scope | Capabilities |
| --- | --- | --- |
| **Super Root** | The whole deployment | Manage the application globally: suspend, remove, and inspect tenants; define the plans that bound what a user may create; view instance-wide operational state |
| **Workspace Admin** | One workspace | Owner of a workspace. Manages its settings, permissions, AI credentials, formats, templates, teams, and invitations |
| **Member** | One workspace | Works inside a workspace with access limited by the permission model |
| **Cell / Team** | One workspace | Not a person: a named group of users used to assign permissions in bulk |
| **Agent** | Scoped token | A machine identity. A first-class subject in the permission model, never a shared human account |

**Agents are subjects, not a bypass.** An agent connecting over MCP resolves through the
same permission engine as a human. This is stated here because the most common failure
mode in this class of product is a second, more permissive read path built for machines.

### Workspaces

A workspace is the unit of tenancy and the unit of isolation. It carries:

- General settings: formats, templates, default theme
- The permission graph for everything it contains
- **AI credentials (BYOK)** — see §8
- Team/cell definitions
- Invitation state and registration policy overrides

A user may create **N workspaces, bounded by the plan** assigned by the Super Root. A user
may invite existing users or new people into a workspace they own.

### Registration policy

Instance-level setting, owned by Super Root:

```
registration_mode: closed | invitation_only | open
open_registration_domains: string[]   -- optional allowlist, e.g. ["company.com"]
```

- Default is **`invitation_only`**. A self-hosted instance that defaults to open gets
  discovered and spam-registered, and the operator blames the software.
- `open` **requires verified SMTP configuration**. Without it, invitations and password
  resets fail silently and produce unactionable support tickets. The setting must refuse
  to switch to `open` until an SMTP test send succeeds.

---

## 3. Domain Model

### 3.1 The hierarchy

```
Workspace
└── Shelf                (a group of books)
    └── Book             (a book generally represents a project)
        ├── Chapter
        │   └── Page
        └── Page         (pages may sit directly under a book)
```

### 3.2 Tree and graph are separate structures

This is the central modelling decision of the project.

BookStack is a strict hierarchy. Obsidian is a link graph. deep-wiki needs both, and they
must **not** be forced into one table.

- **Tree = navigation.** A single `nodes` table with `parent_id`, `position`, and a
  materialised path stored as **`text`** for cheap subtree queries. This is what the
  sidebar renders and what permissions cascade over. The path is deliberately *not*
  Postgres `ltree`: see the engine-portability decision in §14.
- **Graph = meaning.** A `links` table derived by parsing the Markdown **on every save**.
  Backlinks become an index lookup rather than a scan.

**The graph is a projection of the content, never a source of truth.** On save, reparse
and replace the rows for that page. Users never edit `links` directly, and no feature may
write to it outside the parser.

```sql
-- Navigation tree
nodes (
  id            uuid primary key,
  workspace_id  uuid not null,
  parent_id     uuid references nodes(id),
  type          node_type not null,        -- workspace | shelf | book | chapter | page
  path          text not null,             -- materialised ancestry, '/'-delimited ids
  position      integer not null,          -- sibling ordering
  slug          text not null,
  title         text not null,
  created_at    timestamptz not null,
  updated_at    timestamptz not null
);

-- Derived knowledge graph — rebuilt from markdown on save
links (
  id             uuid primary key,
  workspace_id   uuid not null,
  source_page_id uuid not null references nodes(id) on delete cascade,
  target_page_id uuid references nodes(id) on delete set null,
  target_raw     text not null,            -- the literal wiki-link text, for unresolved links
  source_block_id text not null,           -- which block contains the link
  anchor         text                      -- optional block anchor on the target
);

tags (
  id           uuid primary key,
  workspace_id uuid not null,
  name         text not null
);

page_tags (
  page_id uuid not null references nodes(id) on delete cascade,
  tag_id  uuid not null references tags(id) on delete cascade,
  primary key (page_id, tag_id)
);
```

### 3.3 Block IDs — the anchor primitive

Every block (paragraph, heading, list item, code fence, diagram) carries a **stable
persistent ID**, in the manner of Obsidian block references.

This single primitive serves three otherwise-unrelated features:

| Feature | How it uses block IDs |
| --- | --- |
| **Comments** | Anchored to `(block_id, offset_within_block)`. Edits above the comment do not move it |
| **AI on a selection** | A selection is expressed as a block range, so the model receives a stable, citable region |
| **Diffs** | A diff is a set operation over blocks — added / removed / modified / **moved**. "Moved" is free with IDs and impossible with line diffs |
| **RAG chunking** | Chunk boundaries follow block boundaries, so a citation links back to a real, highlightable region of the document |

Character offsets into raw Markdown are **not** an acceptable anchor: they break the
moment anyone types above them.

### 3.4 Versioning: revisions and changesets

Page-level versioning is a snapshot on save. Book-level history requires a concept
BookStack does not have: a **changeset** — a named group of page revisions across a book,
analogous to a git commit spanning several files.

```sql
changeset (
  id          uuid primary key,
  book_id     uuid not null references nodes(id) on delete cascade,
  author_id   uuid not null,               -- user or agent subject
  message     text,
  created_at  timestamptz not null
);

page_revision (
  id           uuid primary key,
  page_id      uuid not null references nodes(id) on delete cascade,
  changeset_id uuid references changeset(id) on delete set null,
  content      text not null,              -- markdown, canonical
  block_index  jsonb not null,             -- block_id -> {start, end, hash}
  author_id    uuid not null,
  status       revision_status not null,   -- committed | pending
  created_at   timestamptz not null
);
```

This makes *"what changed in this book since the client meeting on the 14th"* a single
query — which is the question users actually ask. It must be designed now: retrofitting
it later means backfilling history.

`status = pending` is what agent proposals and AI suggestions write (see §9).

---

## 4. Permissions

Permissions are the feature that sinks products in this category. Inheritance runs across
five levels (workspace → shelf → book → chapter → page) with teams as intermediate
subjects. Resolving that in application code per request produces N+1 queries and a
production authorisation bug within a month.

**Resolve it in SQL.** One table, one recursive CTE.

```sql
permissions (
  id            uuid primary key,
  workspace_id  uuid not null,
  subject_type  subject_kind not null,     -- user | team | role | agent
  subject_id    uuid not null,
  -- resource_type is deliberately NOT stored: it is `nodes.type` of `resource_id`.
  -- Storing it twice creates a value that can disagree with the tree.
  resource_id   uuid not null references nodes(id),
  action        perm_action not null,      -- read | comment | write | manage
  effect        perm_effect not null       -- allow | deny
);
```

Resolution rules, in order:

1. Walk the resource's ancestor chain via `nodes.path`.
2. Collect every grant whose subject is the requesting user, any team they belong to, or
   the agent identity presenting the token.
3. **`deny` wins over `allow`** at the same specificity.
4. **More specific wins**: a grant on the page overrides a grant on the book, which
   overrides the shelf, which overrides the workspace.

### Testing requirement

A truth table of roughly 30 cases covering inheritance, deny precedence, team membership,
and agent scoping **must be written before any permission-dependent UI**. This is a hard
gate, not a preference. The resolver is a pure function of the permission rows and the
ancestor path, so it is testable in complete isolation.

---

## 5. Content and the Editor

### 5.1 Markdown is the source of truth

The canonical stored artefact is **Markdown with wiki-links and tags**. The ProseMirror
document is only an in-memory representation used while editing.

**Mandatory CI gate:** a round-trip test suite asserting that
`markdown → ProseMirror doc → markdown` is **byte-identical** across a corpus of fixtures.
Without this suite, the editor silently corrupts user documents over time. This is the
single highest-risk area of the codebase.

> **GATE-2 — Status: SATISFIED (2026-09-07).** The full fixture corpus round-trips
> byte-identical through the real ProseMirror schema (`packages/editor/src/round-trip.ts`),
> 69 fixture-driven tests green (`packages/editor/src/round-trip.test.ts`), and the suite
> runs as a named, independently identifiable step (`gate-2-round-trip`) ahead of the
> build step in `.github/workflows/ci.yml` and in `bun run verify`. This repository has
> no git remote, so that workflow file never executes; enforcement today is local —
> `bun run check` on every commit, `bun run verify` before tagging.

The editor is built directly on ProseMirror (`prosemirror-view`/`-state`/`-keymap`/
`-commands`/`-history`/`-inputrules`/`-schema-list`) rather than on the Milkdown package —
a deviation from the original plan, recorded where it was made (WU-16.6's commit message)
— chosen over TipTap because it stays Markdown-first rather than treating Markdown as a
serialisation plugin, which matches the canonical-format decision.

**The supported and refused construct set.** Every construct a document can contain falls
into exactly one of three buckets, and `classify()` (`packages/editor/src/classify.ts`) is
derived from the ProseMirror schema rather than written beside it, so the buckets cannot
silently drift from what the schema actually models:

| Bucket | Constructs | Behaviour |
| --- | --- | --- |
| **Modelled** | Paragraphs, headings, nested and mixed-marker lists (tight and loose, ordered and unordered), blockquotes, tables (incl. ragged alignment), code fences with and without an info string, footnotes, hard line breaks, entities and escapes, mixed emphasis and strong markers, wiki-links (resolved, unresolved, anchored), tags, block-anchor syntax (` ^id`), diagram fences | Byte-identical round trip through the real ProseMirror schema; edit mode opens |
| **Verbatim** | Raw HTML (block and inline), reference-style links and images, frontmatter | Carried opaquely through the schema, not modelled node-by-node; byte-identical round trip; edit mode opens |
| **Refused** | Setext headings, indented code blocks, and one non-canonical spelling per pinned serialiser option (bullet marker, ordered-list marker, emphasis marker, strong marker, fence style, list-item indent, resource-link spacing, thematic-break rule, tight definitions) | The edit-session probe (`packages/editor/src/probe.ts`) returns a `409` naming the reason and the construct; edit mode does not open. The refusal is surfaced in-product, not only in this document — see the read/edit screens' refusal UI (`document-editor` capability) |

Byte-identity holds for canonical markdown in the modelled and verbatim buckets. It does
not hold for non-canonical input, which is refused or normalised on purpose, and it makes
no claim about markdown a future `remark` version parses differently — a dependency bump
that changes parsing surfaces as a failing fixture test, never as a silently rewritten
document.

**The buckets describe the editor's round trip, and only that.** They are a statement about
`markdown → ProseMirror → markdown`, which is what GATE-2 measures. Read mode is a second,
independent pipeline — `render()` (`packages/markdown/src/render.ts`), the `markdown → HTML`
path §5.3 caches and serves — and a construct's bucket says nothing on its own about what a
reader sees. **Both obligations bind every bucket:** a construct the editor accepts must also
reach the reader. The two pipelines can agree on the bytes and disagree on the rendering, and
a passing GATE-2 will not notice, because GATE-2 never calls `render()`. It happened: raw HTML
is Verbatim, the probe opened edit mode, the corpus round-tripped byte-identical, and every
reader saw an empty gap where a `<details>` runbook had been written (docs/TODO.md Finding,
2026-09-09). Anything added to the Verbatim or Modelled bucket therefore needs a render-side
test naming the visible output, not only a round-trip fixture.

Raw HTML reaching the reader also makes `render()`'s sanitiser allowlist load-bearing rather
than theoretical — it is the whole boundary between stored bytes and a reader's DOM, since
read mode injects the cached HTML with `v-html`. That allowlist is the security decision
recorded in design.md D12 and asserted in `packages/markdown/src/render.test.ts`; **Verbatim
means the *markdown* survives byte-identical, never that arbitrary HTML executes.**

### 5.2 Editor capabilities

- **Typora-like live preview** — WYSIWYG rendering in place, not a split pane
- **`@` mentions** — users, teams, and pages
- **`/` slash commands** — insert blocks, templates, diagrams, AI actions
- Wiki-links with autocomplete and unresolved-link surfacing
- Tags

### 5.3 Read mode and Edit mode

Every document is either **read** or explicitly entered into **edit mode**. This
distinction is load-bearing, not cosmetic:

| Mode | Behaviour |
| --- | --- |
| **Read** | Markdown rendered to HTML **at save time**, cached and served statically. ProseMirror is never booted. This is the mode ~95% of traffic uses, and it keeps the wiki fast at 10,000 pages |
| **Edit** | Acquires a **soft lock** with a heartbeat. Surfaces "Ana is editing, opened 4 minutes ago" with **"take over"** and **"open read-only"** as explicit options |

The soft lock is deliberately not a hard lock. It covers the real collision rate of a
documentation tool at the cost of one table and a heartbeat, versus weeks of work for
CRDT-based real-time editing.

A second consequence: it makes the AI a **first-class editor**. The AI proposes changes as
a *pending revision*, the human reviews the diff and accepts or rejects. That is exactly
how a human collaborator behaves under a lock-based model, and it is far cleaner than an
AI competing with a CRDT for cursor position.

---

## 6. Diagrams

Diagram support is required to describe flows and architecture. The format choice is
strategic rather than a library preference.

**Mermaid (and D2) are the primary format**, stored as fenced code blocks inside the
Markdown. The reasons compound with the AI-first flow:

| Property | Why it matters here |
| --- | --- |
| **It diffs** | Book-level diffs are a stated requirement. A Mermaid diagram diffs as text; an Excalidraw scene diffs as unreadable JSON |
| **The AI can write it** | Step 3 of the product flow is "a design document **plus the diagrams**". A model emits Mermaid natively and well. It cannot meaningfully emit an Excalidraw scene |
| **It is RAG-indexable** | The diagram source is prose the retriever can match on. A PNG is a hole in the knowledge base |
| **It round-trips** | No separate asset store, no orphaned files, no export pipeline |

**Server-side rendering** (PDF export, OG images) uses a self-hosted **Kroki** service —
text in, SVG out, supporting Mermaid, PlantUML, D2, and Graphviz. Headless Chrome must
never be placed in the API container.

Excalidraw may be added later as an explicit escape hatch for whiteboard-style sketches,
with the accepted trade-off that those do not diff. It is not the default.

---

## 7. Collaboration

### 7.1 Comments

Comments anchor to `(block_id, offset)`. They participate in threads, support Markdown,
and resolve. Because they anchor to block IDs rather than character offsets, edits
elsewhere in the document leave them intact.

### 7.2 Presence

Users can see **what another person is currently working on**. Full visibility of another
person's in-progress work is a future phase; the present requirement is knowing who is
where.

**Corrected 2026-09-14 to match what shipped (`packages/db/drizzle/0014_presence_view.sql`,
versioning-and-collaboration design.md Decision 5).** The original text here said the
inverse — "there is no separate lock table: an `editing` presence row *is* the lock" — and
described a `presence` table with a `viewing | editing` mode and its own TTL. The lock table
is the thing that exists; presence is derived from it.

```sql
-- page_locks is the soft lock (0010_page_locks.sql): one row per page while someone
-- edits, refreshed by heartbeat, expired on read when heartbeat_at is older than
-- PAGE_LOCK_TTL_SECONDS. It carries the composite foreign key
-- (node_id, workspace_id) -> page_content (node_id, workspace_id).
--
-- presence is a VIEW over it, not a table:
CREATE VIEW presence AS
  SELECT node_id AS page_id, workspace_id, holder_user_id AS user_id,
         acquired_at AS since, heartbeat_at, 'editing'::text AS mode
    FROM page_locks;
```

Consequences that follow from "a view, not a table":

- **The lock is the presence signal, not the other way round.** `page_locks` is written
  only by the lock's own operations in `packages/db/src/locks/page-lock.ts` — acquire
  (`GET /pages/:id/edit-session`), heartbeat (`PATCH /pages/:id/lock`) and take-over
  (`POST /pages/:id/lock/take-over`) — and the heartbeat's success path is the single
  caller of the broadcaster's `publish`. There is no presence writer, no presence TTL, no
  sweeper: staleness is evaluated on read exactly as `readLockStatus` evaluates the lock.
- **`mode` is always `editing`.** Nobody is ever recorded as *viewing* a page; the
  product can say who is editing and since when, and nothing else. The roadmap bullet
  for a `viewing` mode stays unticked (`docs/TODO.md`, Phase 3).
- **Tenant isolation is inherited, not declared.** The proposal flagged the original
  table sketch as missing a composite foreign key into `page_content`. A view has no rows
  to be cross-tenant; it inherits `page_locks_page_fk (node_id, workspace_id) ->
  page_content (node_id, workspace_id)` structurally (§14, "Tenant isolation by composite
  foreign key").

Broadcast over **SSE per workspace** — `GET /workspaces/:workspaceId/presence/stream` —
unidirectional, simple, and proxy-friendly. Membership opens the stream; every event is
checked with `can(user, page, read)` before it is emitted and silently dropped otherwise,
so a member who cannot read a page never learns it is being edited. Each keep-alive tick
also polls the view and emits anything not yet sent on that connection, which is what keeps
correctness from depending on a single API process. WebSockets are deferred until real-time
multiplayer arrives.

### 7.3 Profile photos

Users have profile photos, stored through the `BlobStore` port (§12).

### 7.4 Diffs

Diffs must be viewable **over a page and over a book**. Book-level diffs are computed from
changesets (§3.4).

Diffing is **by block, not by line**. Since block IDs are stable, a diff is a set
operation, which yields "this paragraph moved" instead of a wall of line noise.

---

## 8. AI Layer

### 8.1 Supported providers

deep-wiki integrates **Anthropic, OpenAI, Google Gemini, DeepSeek, and OpenRouter**
through the **Vercel AI SDK**, which supplies a unified `generateText` / `streamText` /
`generateObject` surface across all of them.

OpenRouter overlaps with the native providers by design. Native integrations are still
warranted for:

- **Prompt caching**, which is provider-specific and a major cost lever
- **Lower latency** and no intermediary markup
- **Compliance** — self-hosted operators frequently need "our data does not transit a
  third party", which a proxy cannot satisfy

Recommended shape: native for Anthropic / OpenAI / Google, an OpenAI-compatible adapter
for DeepSeek, and OpenRouter as the catch-all for everything else.

### 8.2 Capability registry

Providers are **not interchangeable**. The system maintains a per-model capability
registry:

```ts
type ModelCapabilities = {
  tools:            boolean
  structuredOutput: 'schema' | 'tool-call' | 'prompted' | 'none'
  promptCaching:    boolean
  vision:           boolean
  contextWindow:    number
}
```

Structured output degrades gracefully in that order: native schema mode → tool-call
coercion → prompted JSON with a repair pass. The idea→design-document flow depends on
reliable structured output, so this degradation path is required, not optional.

### 8.3 Chat and embeddings are separate configuration — hard requirement

**`chat_provider` and `embedding_provider` MUST be independently configurable.**

Not every chat provider offers an embeddings endpoint. Coupling the two means a workspace
that selects a chat provider without embeddings silently loses RAG, which is a core
product capability. The configuration model must never imply that choosing a chat model
chooses an embedding model.

A **local/self-hosted embedding fallback** (for example a locally served `bge`-class
model) is required so that an operator holding only a chat API key still gets working RAG.

### 8.4 Embeddings are immutable after indexing

Changing the embedding model invalidates the entire vector index. Dimension mismatches
between rows produce silent, catastrophic retrieval failure.

Requirements:

- Store **`embedding_model` and `dimensions` on every chunk row.**
- **Refuse to mix** models or dimensions within one index. Reads filter on the active
  model; writes with a different model are rejected.
- **Reindexing is an explicit, tracked job** with progress and a completion state — never
  an implicit side effect of changing a setting.

```sql
chunks (
  id              uuid primary key,
  workspace_id    uuid not null,
  page_id         uuid not null references nodes(id) on delete cascade,
  block_ids       text[] not null,          -- provenance, for citation back to the document
  content         text not null,
  -- The dimension MUST be declared. Verified against pgvector 0.8.6: an ANN index over an
  -- undimensioned column is refused with `ERROR: column does not have dimensions`, so an
  -- undimensioned `vector` stores embeddings that can never be indexed and every similarity
  -- search degrades to a sequential scan of the corpus. The literal below is illustrative;
  -- the real value follows from the chosen embedding model (see §14).
  embedding       vector(1536) not null,
  embedding_model text not null,
  dimensions      integer not null,
  created_at      timestamptz not null
);
```

### 8.5 Retrieval and tenant isolation

Chunking follows **block and heading boundaries**, reusing block IDs so that a citation is
a clickable link back into the document.

**The workspace boundary is a security boundary.** `workspace_id` is filtered **inside**
the vector query's `WHERE` clause, never as a post-filter in application code. A leaked
embedding across tenants is a data breach, not a bug.

### 8.6 BYOK credentials

AI credentials are per-workspace and supplied by the workspace:

- **Envelope-encrypted at rest.**
- **Validated on save** with a cheap probe call, so a bad key fails at configuration time
  rather than mid-conversation.
- **Never exposed to the client.** The frontend calls deep-wiki's own endpoint;
  deep-wiki's backend calls the model provider.

### 8.7 Cost accounting

Every model call is logged with provider, model, input/output tokens, computed cost,
workspace, and the initiating subject. This feeds:

- Super Root's **plan limits** and quota enforcement
- The operator's own budgeting, which for a self-hosted product is a first-order concern

### 8.8 Prompt construction and caching

Prompt assembly orders content from **most stable to most volatile**, so that the stable
prefix is cacheable:

```
1. tool definitions          (stable — deterministic ordering required)
2. system + team rule packs  (stable per team/book — see §10)
3. document content          (volatile)
4. user question / selection (volatile)
```

Team rule packs are therefore not just a product feature; they are the **stable cached
prefix** that makes AI interaction over documents economical. Any nondeterminism in that
prefix (timestamps, unsorted JSON, a varying tool list) silently destroys the cache and
must be treated as a defect.

---

## 9. MCP and Agent Surface

deep-wiki is consumed by **agents over MCP** and by **humans through a UI panel**. Both
paths share **one tool layer**. There is never a second retrieval implementation.

```
packages/ai-tools   ← the single definition of every capability
   ├── exposed over the wire by the MCP server   (agents)
   └── called in-process by the AI SDK           (in-app panel)
```

### 9.1 Transport and identity

- **Streamable HTTP**, remote and multi-tenant. Not stdio — stdio is a single-user local
  transport and does not fit this product.
- Authentication issues **scoped tokens** bound to an **agent subject**. An agent can be
  granted access to exactly one book if that is what the team wants.
- Every MCP call resolves through the **same permission resolver** as a human request.

### 9.2 Tool surface

| Tool | Kind | Description |
| --- | --- | --- |
| `search_workspace` | read | RAG search across the permitted corpus, returning cited block ranges |
| `get_page` | read | Fetch a page's canonical Markdown |
| `list_tree` | read | Navigate the shelf/book/chapter/page hierarchy |
| `get_backlinks` | read | Inbound links to a page, from the derived graph |
| `get_diff` | read | Page or book diff, by block |
| `get_team_rules` | read | The resolved rule-pack context for a scope (§10) |
| `propose_edit` | write | Create a **pending revision**. Never a direct commit |

### 9.3 Agent writes are proposals, never commits

`propose_edit` produces a `page_revision` with `status = pending`, surfaced in the UI as a
diff for a human to accept or reject.

This is not a workflow preference — it is the **prompt-injection mitigation**. The corpus
contains user-authored text. If an agent reads a page containing instructions aimed at the
agent, a direct-write tool would let that text mutate the team's source of truth. Gating
every write behind human review removes the attack's payoff.

`get_team_rules` deserves specific attention: it is what makes an external coding agent
immediately useful, because the team's conventions arrive with the retrieval rather than
having to be restated in every prompt.

---

## 10. Team Rule Packs — Shared Working Context

### 10.1 Requirement

At **team/cell level**, a team declares its working rules: stacks, tools, conventions,
corrections, and skills. These rules must be:

- **(a)** injected into every AI interaction over a document,
- **(b)** included when a document or book is **exported**, and
- **(c)** **reusable across different projects**, so conventions are shared rather than
  retyped per book.

### 10.2 Rule packs are first-class, and they are documents

Two decisions follow directly from requirement (c):

1. **A rule pack is a first-class entity with its own identity**, attachable to N books
   and N teams. It is not a child of a book, because a child cannot be shared.
2. **A rule pack is authored as a Markdown document.** It therefore inherits versioning,
   diffing, commenting, and AI-assisted improvement from the machinery that already
   exists. No parallel settings-blob format.

```sql
rule_pack (
  id           uuid primary key,
  workspace_id uuid not null,
  name         text not null,
  description  text,
  page_id      uuid not null references nodes(id),   -- its content is a real page
  created_at   timestamptz not null
);

rule_pack_binding (
  rule_pack_id  uuid not null references rule_pack(id) on delete cascade,
  scope_type    scope_kind not null,   -- workspace | team | shelf | book | page
  scope_id      uuid not null,
  priority      integer not null,      -- tie-break within the same scope level
  primary key (rule_pack_id, scope_type, scope_id)
);
```

### 10.3 Resolution cascade

Rule packs compose down the hierarchy, in the manner of a CSS cascade:

```
Workspace → Cell/Team → Shelf → Book → Page
```

`resolveRuleContext(page_id, subject_id)` walks that chain, collects every bound pack,
deduplicates by pack identity, and orders them **least specific first** so that the most
specific rules appear last and therefore dominate. Within one scope level, `priority`
breaks ties.

Ordering least-specific-first is deliberate: it keeps the workspace-wide prefix stable
across every book, which maximises prompt-cache reuse (§8.8).

### 10.4 Token budget

A team that binds twelve rule packs would otherwise attach tens of thousands of tokens to
every AI call. The resolver enforces:

- A **configurable token budget cap** per resolution.
- Deterministic truncation: packs are included in cascade order until the budget is
  exhausted, and the UI reports which packs were dropped. Silent truncation is forbidden.

### 10.5 Export

When a document or book is exported, the resolved rule set is included in the export
bundle. This makes an export self-contained for an external team or an agent receiving it
outside deep-wiki.

### 10.6 Agent access

Exposed over MCP via `get_team_rules`, so a coding agent connected to a workspace picks up
the team's conventions automatically. In effect, the wiki becomes the team's canonical
agent-instruction source rather than a file copied between repositories.

---

## 11. User Interface

### 11.1 Component library

**Nuxt UI** (Tailwind v4 / Reka UI) is the component library for `apps/web`.

### 11.2 Theming

Users select themes, in the manner of DaisyUI. Themes are implemented as **CSS-variable
blocks** rather than compiled stylesheet variants, so switching is instant and adding a
theme is data rather than a build step.

Resolution: a **workspace default theme, overridable per user.** The workspace default
gives an organisation a consistent look; the per-user override respects individual
preference and accessibility needs. The user override is stored on the user profile and
wins whenever set.

### 11.3 Icon packs

Icon-pack selection uses **`@nuxt/icon` with Iconify**. The workspace or user selects a
collection prefix (`lucide`, `heroicons`, `tabler`, …) and icons resolve as
`i-{pack}-{name}`.

**Documented gotcha — this will bite during implementation:** dynamic icon names defeat
`@nuxt/icon`'s build-time tree-shaking, because the bundler cannot statically enumerate
which icons are used. Two consequences:

- The set of **selectable packs must be an explicit allowlist**, bundled deliberately
  rather than discovered at runtime.
- **Self-hosted and air-gapped operators require the `@iconify-json/*` collections
  bundled locally.** Relying on the public Iconify API breaks any deployment without
  outbound internet access, which is a substantial fraction of self-hosted installs.

---

## 12. Infrastructure

### 12.1 Container runtimes

- **Local development: `podman compose`.**
- **Production: Docker.**
- **One Compose file for both.** Stay strictly on the Compose specification — no
  Docker-specific extensions — and the same file runs unmodified under both runtimes.

**Fedora/Podman gotchas that apply on day one:**

- **SELinux volume labels.** Bind mounts need a `:z` (shared) or `:Z` (private) suffix or
  the container receives permission-denied. Docker ignores the suffix harmlessly, so it is
  safe to leave in the shared file.
- **Rootless port binding.** Rootless Podman cannot bind ports below 1024. Map to
  8080/8443 locally and let the reverse proxy own 80/443 in production.

### 12.2 Services

| Service | Purpose | Notes |
| --- | --- | --- |
| `postgres` | Primary datastore | With **pgvector** — the vector index lives in the same database as the domain data |
| `mailpit` | Development SMTP | SMTP on **1025**, web UI on **8025** |
| `minio` | S3-compatible object storage | Profile photos, attachments, export bundles |
| `kroki` | Server-side diagram rendering | Text in, SVG out |

### 12.3 Hexagonal ports — required, not aspirational

The domain lives in `packages/core` with **zero framework imports**. Two ports are
mandatory because the self-hosting requirement forces multiple adapters:

| Port | Adapters | Why |
| --- | --- | --- |
| `MailSender` | Dev SMTP (Mailpit), production SMTP, transactional API | Self-hosters need plain SMTP. Hard-coding a SaaS provider breaks the distribution promise |
| `BlobStore` | S3-compatible, **local filesystem** | A self-hoster on a single VPS will not run MinIO. Without a filesystem adapter, the product is undeployable for them |

The same discipline applies to the HTTP layer: keeping Hono at the adapter boundary is
what keeps the "extract a Go service later" option real rather than theoretical.

---

## 13. Repository Layout

Monorepo managed with **Bun 1.4** workspaces. Explicitly **not pnpm**, and **not
Turborepo** for now — `bun run -F` covers the task graph, and one less tool is a real win
for a product that self-hosters must build.

```
apps/
  landing/        Astro           — marketing site
  web/            Nuxt 4          — the application UI
  api/            Hono on Bun     — adapters only, no domain logic
packages/
  core/           domain: entities, permission resolver, rule-pack resolution
                  — zero framework imports
  markdown/       the single shared unified/remark pipeline:
                  parse, block-ids, wiki-links, tags, chunking
  contracts/      zod schemas shared by web, api, and mcp
  editor/         ProseMirror schema, markdown <-> doc round trip and its tests,
                  and the mount entry (view, keymaps, input rules, @ mention and
                  / command plugins); the soft lock lives in db and api
  ai-tools/       the single tool layer shared by MCP and the in-app panel
  db/             drizzle schema and migrations
```

`packages/markdown` is the keystone of the architecture. It is imported by the editor, the
API, and the indexer, and it is the reason the backend is TypeScript (§14).

---

## 14. Key Decisions and Rationale

| Decision | Rationale | What would reverse it |
| --- | --- | --- |
| **Backend is Bun + Hono, not Go** | The server must parse the *same* Markdown as the editor to derive wiki-links, tags, block IDs, and RAG chunk boundaries. A Go server would run `goldmark` while the editor runs `remark` — two parsers with divergent edge cases on the same bytes, producing backlinks the editor does not render and chunk boundaries that do not match visible blocks. That is a permanent correctness tax. One shared `packages/markdown` eliminates the entire bug class. Shared types with Nuxt and Astro, and a materially more mature AI/streaming ecosystem, reinforce it | Making the primary distribution a **single binary with embedded SQLite** (appliance-style, no Postgres). That is a different product, and Go's static binary plus low memory footprint would become the deciding advantage |
| **Go reserved for future stateless satellites** | Two workloads genuinely favour Go, and neither is needed at v1: the **real-time CRDT hub** (long-lived WebSocket fan-out) and the **embedding/indexing worker** (CPU-bound, embarrassingly parallel, needs no Markdown semantics if fed pre-chunked blocks). Both are stateless satellites, not a second backend | Measured pain in either workload. Not before |
| **Markdown is canonical; ProseMirror is in-memory only** | The user owns their content. A proprietary document model makes export a feature instead of a property | Nothing foreseeable. This is a product commitment |
| **Tree and graph are separate tables** | They are different data structures serving different questions. Merging them yields a model that answers neither well | Nothing foreseeable |
| **Permissions resolved by recursive CTE in SQL** | Five levels of inheritance plus team subjects resolved in application code produces N+1 queries and authorisation bugs | Nothing foreseeable |
| **Block IDs as the universal anchor** | One primitive serves comments, AI selections, diffs, and RAG chunk provenance. Character offsets break on every edit above them | Nothing foreseeable |
| **A retired block id is terminal, and a document that reintroduces one is refused with a correction — DECIDED 2026-09-14** | A `tombstoned` or `superseded` `page_blocks` row is never flipped back to `active`, and a superseded row never loses its `superseded_by` pointer: that pointer is what migrates a comment thread onto the surviving block, and orphaning is one-way. The save path refuses a document that reintroduces a retired anchor (`DeadAnchorError`, following `NotCanonicalError`'s shape) and hands back the same document with the dead anchors removed — removed rather than re-minted, because block ids are assigned lazily. A `BEFORE UPDATE` trigger (`0016`) makes the same rule hold in the storage layer, so no future writer can undo a retirement. Rewriting the author's bytes inside the save was rejected: `savePage` returns a hash, not markdown, so the client would re-submit the dead anchor on every save and each pass would mint again. The server never edits the user's Markdown behind their back | A client contract in which the save response carries the stored markdown, so a server-side re-mint could be adopted by the editor instead of refused |
| **Read mode / edit mode with a soft lock** | Read mode serves cached HTML and keeps the wiki fast at scale. The soft lock covers the real collision rate of a documentation tool at a fraction of the cost of CRDTs, and it makes AI proposals fit naturally as pending revisions | Demand for genuine simultaneous editing, which is already a planned later phase |
| **Mermaid/D2 over Excalidraw as the primary diagram format** | Text diffs, the AI can generate it, RAG can index it, and it round-trips inside Markdown | Nothing — Excalidraw is additive, as an escape hatch |
| **`chat_provider` and `embedding_provider` separate** | Not every chat provider offers embeddings. **Verified 2026-09-04 against official documentation: DeepSeek documents a single endpoint, `chat/completions`, and offers no first-party embeddings API.** Coupling the two would silently disable RAG for any workspace that picked it | Nothing. This is a hard requirement |
| **Embeddings are 1536-dimensional** | Owner decision, 2026-09-04. It is `text-embedding-3-small`'s native size and the most common industry default, so the primary path needs no dimension juggling. Verified the same day: OpenAI's `dimensions` parameter can shorten `text-embedding-3-large` (3072 native) to 1536, so both OpenAI models remain available at this size. **Accepted cost: any local, air-gapped embedding fallback must itself produce exactly 1536 dimensions.** Common local models (bge-m3, e5-large) emit 1024 and therefore cannot serve as the fallback at this size; unless a 1536-dimension local model is identified, a self-hosted instance needs a third-party embedding key to have RAG at all. Anthropic offers no embeddings endpoint, and neither does DeepSeek (verified) | Identifying a local model at 1536, or accepting a migration and full reindex to change size |
| **The pgvector column carries an explicit dimension** | Verified against pgvector 0.8.6 on this project's own image: `CREATE INDEX … USING hnsw` over an undimensioned `vector` column fails with `column does not have dimensions`, while `vector(1536)` succeeds. An undimensioned column therefore stores embeddings that can never be indexed, and every similarity search becomes a sequential scan — invisible at twenty documents, fatal at ten thousand. This makes the embedding model a **schema-level** decision, not a runtime setting | Supporting several embedding models per deployment, which would need one table per dimension or a per-deployment migration input rather than a schema constant |
| **Agent writes are pending revisions** | The corpus is user-authored text, making direct agent writes a prompt-injection vector into the team's source of truth | Nothing foreseeable |
| **Rule packs are shareable entities authored as documents** | Sharing across projects requires independent identity; authoring them as documents inherits versioning, diffing, and commenting for free | Nothing foreseeable |
| **Bun workspaces without Turborepo** | `bun run -F` covers the task graph; fewer build dependencies matters for a self-hosted product | Build times that measurably hurt |
| **Postgres is the engine, but engine-specific features are paid for, not assumed** | The appliance question is answered: no single-binary/SQLite distribution, so the Bun + Hono decision stands. But the door stays open at low cost. The rule is a cost test, not a purity test: avoid a Postgres-only feature when a portable equivalent is nearly as good, accept one when it buys something the product genuinely needs. Applied: the `nodes` path is a `text` materialised path with `text_pattern_ops`, **not** `ltree` — the portable form is barely worse and `ltree` would have been the third hard lock-in. Recursive CTEs stay, because SQLite supports them too and they cost nothing in portability. `pgvector` stays and is accepted as a genuine lock-in, because RAG over the corpus is a core product function with no equivalent-maturity alternative | A decision to ship an appliance after all, which would reopen the backend choice as well |
| **Read mode's cached HTML never bakes in a per-viewer decision — DECIDED** | §5 has read mode serve pre-rendered cacheable HTML, and §4 makes permissions per-viewer. Those two hold together only while nothing rendered depends on who is looking, and anything per-viewer inside the blob turns the renderer into a disclosure channel — one cached blob per page cannot express two audiences. Discovered during Phase 2 implementation, when the non-disclosure test still passed **vacuously** because `render()` did not hyperlink wiki-links. **Resolved by the Phase 3 proposal** (`openspec/changes/versioning-and-collaboration/`, `specs/comment-overlay/spec.md`): the cache stays exactly one blob per page, byte-identical for every viewer; `render()` emits an invisible `data-block-id` per anchored block and nothing else; and anything per-viewer — comment indicators first — is a **separate overlay** fetched from its own `can('comment')`-gated endpoint and composed onto the unchanged HTML client-side. The general rule that falls out: the check runs at the endpoint that serves the per-viewer data, never inside the render. A clickable wiki-link is the same shape and takes the same treatment | A per-viewer variant of `rendered_html` being persisted, computed or cached, which the comment-overlay spec makes a named failing scenario |
| **Authorisation walks `parent_id`, never the `path` cache** | `nodes.path` is a trigger-maintained denormalised cache that exists for subtree *navigation* queries. If it goes stale or corrupt, a resolver reading it grants or denies access silently and wrongly. `parent_id` is the authoritative structure, depth is bounded at five, and each step is a primary-key lookup. Correctness of the cache is then a separate, testable concern instead of a security dependency | A measured cost difference at realistic depth, which would require the path integrity check to run continuously rather than per test |
| **The workspace is a real `nodes` row** | Materialising it as a fifth `node_type` gives the ancestor chain a genuine root, makes the resource foreign key unconditional, and deletes the workspace-level special case from the resolver. A branch in the authorisation query is exactly where an isolation bug hides. It also resolves a latent contradiction in this document, which previously declared `node_type` with four values in one place and five in another | Nothing foreseeable |
| **Tenant isolation by composite foreign key `(id, workspace_id)`** | A cross-tenant row becomes *unrepresentable* rather than merely unqueried. A `WHERE workspace_id = ?` is one forgotten clause away from a leak; a composite FK cannot be forgotten. GATE-3 will rely on this | Nothing foreseeable |
| **Super Root does not bypass `can()`** | An operator is not a reader. A bypass path is the same failure mode as any unchecked machine read. Instance-level operations go through a separate authority so operating the platform and reading a tenant's documents stay different things. **As built (corrected 2026-09-14):** that authority is the `requireSuperRoot()` middleware in `apps/api/src/routes/admin.ts`, which reads `users.is_super_root` and gates the whole `/admin` sub-app; the `canOperateInstance()` this row used to name was never written and exists only as a comment in `packages/core/src/permissions/can.ts` | A break-glass requirement, which would need its own audit trail |
| **`resource_type` is not stored on `permissions`** | It is `nodes.type` of `resource_id`. Storing it twice creates a second value that can disagree with the tree, and the disagreement would be an authorisation bug | A resource that is not a node |
| **`invitation_only` registration by default** | An open-by-default self-hosted instance gets discovered and spam-registered, and the operator blames the software | Nothing — `open` remains available as an explicit choice |

---

## 15. Deferred to Later Phases

Explicitly out of scope for v1, and deliberately so:

| Item | Why deferred | Prerequisite |
| --- | --- | --- |
| **Real-time multiplayer editing** | Read/edit modes plus a soft lock cover the actual collision rate of a documentation tool. CRDTs are weeks of work serving a rare case | Demonstrated demand. Arrives with the Go realtime hub and a WebSocket transport, replacing SSE-only presence |
| **Full visibility of another person's in-progress work** | Presence — knowing *who is working on what* — is the v1 requirement. Seeing their live content depends on the multiplayer layer | Real-time multiplayer |
| **Excalidraw / freehand diagrams** | Does not diff, is not RAG-indexable, and the AI cannot generate it. Mermaid and D2 cover the architecture and flow diagrams the product flow actually needs | Explicit demand for whiteboard sketching, accepted with the no-diff trade-off |
| **Go satellite services** | The realtime CRDT hub and the embedding/indexing worker are the two workloads that would justify Go. Neither is a bottleneck at v1 | Measured performance pain, in that order |
| **Public rule-pack sharing beyond the workspace** | Cross-workspace rule packs need their own ownership and permission model. In-workspace sharing across books satisfies the stated requirement | A decision on cross-workspace or public rule-pack distribution |
