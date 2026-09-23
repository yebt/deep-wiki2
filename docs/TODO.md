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

_Last updated 2026-09-17._

| Phase | State |
| --- | --- |
| 0 — Foundations | Complete and archived (`openspec/changes/archive/2026-09-03-bootstrap-monorepo-foundations/`) |
| 1 — Tenancy and permissions | SDD change complete and archived — 85/85 tasks, all 18 work units. GATE-1 satisfied. Owner-reviewed and approved (`docs/UI-CHECKLIST.md` Review Log). One broader roadmap item stays open past this change: Super Root plan-authoring admin route (see the unticked bullet below) |
| 2 — Content and editor | SDD change complete and archived (`openspec/changes/archive/2026-09-07-content-and-editor/`), merged to `main` 2026-09-09. GATE-2 satisfied. One roadmap bullet stays partially shipped past this change: `/` slash commands cover heading/list/quote/code-block/divider only, not table/diagram-fence/callout/link-to-page (see the unticked bullet above) |
| 3 — Versioning, diffs, comments and presence | **In progress — 88 of 97 tasks ticked** in `openspec/changes/versioning-and-collaboration/tasks.md` (counted 2026-09-14 by counting `- [x]` lines; 85 before this pass, then 6.9 ticked on the evidence of the read screen's `comments-unplaced` state and its e2e, 11.1 on the §7.2 rewrite below, and 11.2 because §14 already carried the row it asks for). Every build task in Phases 1–10 is done and every route is mounted (`apps/api/src/index.ts`). What remains is not code: the six **owner-review gates** (10.2, 10.4, 10.6, 10.8, 10.10, 10.12 — one per shipped surface) and Phase 11's remaining tasks (11.3 Findings, 11.4 `bun run verify`, 11.5 success-criteria confirmation). **First owner verdicts landed 2026-09-17** (`docs/UI-CHECKLIST.md` Review Log): 10.4 and 10.6 **not passed** (GitHub-style word-level diff plus a two-column option wanted, on top of the four change classes shipped); 10.2 has an owner-reported defect under investigation (an empty history entry sometimes saved); 10.8, 10.10 and 10.12 not yet evaluated. Two roadmap bullets below stay unticked past the change: the workspace-wide "what the team is working on" surface, which the change never scoped, and the per-viewer presence `mode` (`viewing`), which the shipped view derives from the lock and so only ever reports `editing` |
| 3.5 — Workspace polish | Opened 2026-09-16. The management sidebar and invite dialog **approved** by the owner 2026-09-17 (`docs/UI-CHECKLIST.md` Review Log); the rest of the phase carries twelve further owner decisions from the same 2026-09-17 review (Findings) and is still in design/build |
| 4–9 | Not started |

`openspec/changes/versioning-and-collaboration/` is the active change. Its `tasks.md` is
the tick record; this table restates its count and must be corrected whenever the two
disagree — the count above was taken by counting `- [x]` lines, not by reading a summary.

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
> fixture corpus, running in CI, before the editor is wired into a user-facing screen.
> (Written when the editor was planned on Milkdown; it shipped directly on ProseMirror —
> `docs/SPECS.md` §5.1.)
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
- [x] Create `packages/editor` — placeholder for the editor integration (planned on
      Milkdown; built directly on ProseMirror in Phase 2, `docs/SPECS.md` §5.1).
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
- [ ] ~~Base CI pipeline: install, typecheck, lint, unit tests, on every push.~~ **Unticked
      2026-09-14.** `.github/workflows/ci.yml` exists with `verify`, `e2e` and
      `compose-smoke` jobs, but this repository has no git remote (`git remote -v` prints
      nothing), so the workflow has never run and cannot — "on every push" is a claim about a
      push that does not happen. What actually gates every commit is `.githooks/pre-commit`
      running `bun run check`, and `bun run verify` by hand before tagging. A tick here would
      say CI enforces something; nothing does until a remote exists.
- [ ] ~~Add the `packages/core` purity check to CI.~~ **Unticked 2026-09-14**, same reason.
      `core-purity.ts` runs inside `bun run check`, which the workflow's `check` step calls —
      but the workflow never executes. Enforcement is the pre-commit hook, locally.
- [x] Define the `MailSender` and `BlobStore` port interfaces in `packages/core`
      (interfaces only — adapters land in Phase 1). They give `packages/core` real
      content to test and exercise the purity check against a genuine boundary.
- [x] Workspace-wide test command covering every package and app, with at least one
      real executing test per member — a placeholder that asserts nothing does not count.
- [x] Scoped Vitest + `@nuxt/test-utils` for `apps/web` only. Nuxt component tests
      cannot run under `bun test`; see Findings. Add a structural check asserting Vitest
      appears in exactly one workspace member so the second runner cannot spread.
- [x] Wire Playwright for e2e and prove it boots `apps/web` with one smoke test.
- [x] Ensure CI exercises the build of all three apps, not only the two front-ends. (The
      workflow file does — `landing` and `web` build, `api` typechecks because it has no
      bundler — but see the two unticked CI bullets above: the file never runs.)
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
      authoring path yet — no admin route creates or edits a plan. **Amended 2026-09-17**
      (owner decision, Open Questions closed): a per-instance default plan is assigned
      automatically to a self-registered user; a workspace's owner chooses which plan
      applies to it, and the workspace's limits derive from that owner's plan. Needs a Super
      Root **root panel** (Phase 3.5) listing every workspace in the instance alongside plan
      management — this makes the `capabilities`/`GET /me` signal (Open Questions) a build
      prerequisite for that panel, not a discretionary question.
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
      Root does not bypass `can()`. **Amended 2026-09-14:** this bullet used to say
      instance-level operations go through "a separate `canOperateInstance()`". No such
      function exists — the name survives only in a comment in
      `packages/core/src/permissions/can.ts` and in prose. What exists is the
      `requireSuperRoot()` middleware in `apps/api/src/routes/admin.ts`, which reads
      `users.is_super_root` and gates the whole `/admin` sub-app. The decision (no bypass of
      `can()`) holds; the function the bullet named was never written.
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
      **Amended 2026-09-14 — narrower than written.** `ANCHORABLE_BLOCKS` in
      `packages/markdown/src/extensions/block-anchor.ts` is `paragraph`, `heading` and
      `listItem`; a code fence or a table carries no anchor. And since commit `1d0a325` a
      *block* is a top-level child of the document only (`topLevelBlocks()` in
      `blocks.ts`), so a `^id` written on a list item is parsed and round-tripped but never
      becomes a `page_blocks` row or a diff/comment target. The mechanism is shipped and
      stable; the list of node types in this bullet is not the list the code has.
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
- [ ] ~~Implement backlinks as an index lookup over the derived `links` table.~~ **Unticked
      2026-09-14 — half shipped.** The lookup exists: `GET /pages/:id/backlinks`
      (`apps/api/src/routes/links.ts`), behind `can()`, tested. Nothing calls it: `rg
      backlinks apps/web/app` finds no caller, and no screen shows a page's backlinks. An
      endpoint with no consumer is an index, not a feature.
- [ ] ~~Implement tag listing and tag-filtered navigation.~~ **Unticked 2026-09-14 — neither
      half is what the bullet says.** There is no tag-listing endpoint at all (no
      `GET /tags`); the only tag route is `GET /tags/:name/pages`
      (`apps/api/src/routes/tags.ts`), and no code under `apps/web/app` calls it or renders
      a tag anywhere. Tag *parsing* and the derived `page_tags` rows are done (bullet above);
      listing and navigation are not started.
- [ ] Make wiki-links clickable in Read and Edit, and add Obsidian-style block references
      (a stable-block-id link into a specific part of another page, on top of the block-id
      mechanism already shipped) so cross-referencing another part of a document, or another
      page, is easy. Reaffirmed by the owner 2026-09-17, alongside backlinks (above) and the
      graph view (Phase 8, below) as the same underlying knowledge-graph feature seen from
      three angles.
- [x] Implement the navigation tree UI over `nodes` (shelves, books, chapters, pages) with
      drag reordering writing back to `position` (WU-17).

### Phase 3 — Versioning, diffs, comments and presence

Ticks below were taken 2026-09-14 against the tree, not against
`openspec/changes/versioning-and-collaboration/tasks.md`; the file and line named on each
is the evidence. Every shipped screen in this phase is still waiting on its owner-review
gate (tasks 10.2–10.12) — a tick here means built, mounted and tested, not reviewed.
**First owner verdicts, 2026-09-17** (`docs/UI-CHECKLIST.md` Review Log 2026-09-17): gates
10.4 (page diff) and 10.6 (book diff) **not passed** — see the two bullets below and Open
Questions; gate 10.2 (page history) has an owner-reported defect under investigation, "an
empty history entry is sometimes saved" (Findings 2026-09-17); gates 10.8, 10.10 and 10.12
were not evaluated in that pass, because the owner's running dev servers predated the
comments-from-read batch. The management sidebar and the invite dialog, reviewed the same
day outside this task list, were **approved**.

- [x] Migrate `page_revision`: content snapshot plus the block index at that revision.
      `packages/db/drizzle/0012_page_revisions_and_changesets.sql`; rows are immutable by
      trigger.
- [x] Migrate `changeset`: `(id, book_id, author_id, message, created_at)` — a commit-like
      group of page revisions spanning a book. Same migration; one open changeset per
      `(workspace, book, author)` by partial unique index, closed by the
      `CHANGESET_WINDOW_MINUTES` window.
- [x] Link every `page_revision` to its `changeset` so book-level history is one query.
      `GET /books/:id/history` (`apps/api/src/routes/revisions.ts`).
- [x] Implement block-level diff over two block sets: added, removed, modified, **moved**.
      Moved is free with stable block IDs and impossible with line diffing — do not
      fall back to a line differ. `diffBlocks()` in `packages/markdown/src/diff-blocks.ts`,
      re-parsing both sides; `scripts/checks/diff-input-purity.ts` forbids feeding it the
      stored `block_index`.
- [x] Build the page-level diff view. `apps/web/app/pages/pages/[id]/diff.vue` over
      `GET /pages/:id/diff?from=&to=`. **Gate 10.4 not passed (owner review, 2026-09-17)** —
      built and mounted, but reopened: the diff must show GitHub-style word-level changes
      inside a block, on top of the four change classes, plus an optional two-column
      before/after view. See Open Questions and `docs/UI-CHECKLIST.md` Review Log
      2026-09-17.
- [x] Build the book-level diff view answering "what changed in this book since <date>"
      via changesets. `apps/web/app/pages/books/[id]/{history,diff}.vue` over
      `GET /books/:id/{history,diff?since=}`, navigable between changed pages. **Gate 10.6
      not passed (owner review, 2026-09-17)** — same rework as gate 10.4, above.
- [x] Migrate `comments` anchored to `(block_id, offset_within_block)` so reflow above the
      anchor does not detach the comment. `0013_comments.sql`: `block_id`, `offset_start`,
      `offset_end`, `quote`, `quote_hash`, `status` (`anchored` | `orphaned`); migration
      across a split follows `page_blocks.split_from` (`0011`); orphaning is one-way.
- [x] Implement comment threads, resolution state, and mention notifications over
      `MailSender`. `apps/api/src/routes/comments.ts` (`GET`/`POST /pages/:id/comments`,
      `PATCH /comments/:threadId/resolved`); the read screen shows, replies to and resolves
      threads. **Not shipped:** starting a *new* thread from read mode — there is no
      affordance, and the client's only `POST /pages/:id/comments` call sends a reply
      (`usePageComments.ts`). Recorded in Findings 2026-09-14.
- [ ] Migrate `presence`: `(user_id, page_id, mode, last_seen_at)` where `mode` is
      `viewing` | `editing`, with a short TTL. **Shipped differently, left unticked on the
      `viewing` half:** `presence` is a *view* over `page_locks`
      (`0014_presence_view.sql`), not a table, so it carries no rows, no TTL of its own
      (the lock's `PAGE_LOCK_TTL_SECONDS` is evaluated on read) and no composite-FK gap —
      and its `mode` is the constant `'editing'`. Nobody is ever "viewing" as far as the
      product can tell. `docs/SPECS.md` §7.2 now says this.
- [x] Implement an SSE channel per workspace broadcasting presence changes. SSE is
      sufficient for one-way fan-out and survives proxies better than WebSockets.
      `GET /workspaces/:workspaceId/presence/stream` (`apps/api/src/routes/presence.ts`),
      per-event `can(read)` before emitting, keep-alive poll of the view as the
      multi-process fallback.
- [x] Wire presence as the soft-lock signal: "Ana is editing, opened 4 minutes ago".
      `PresenceIndicator.vue` on the read and edit screens via `usePresenceStream.ts`.
- [ ] Surface "what the team is working on right now" in the workspace UI. Not scoped by
      the change; presence is shown per page only.

### Phase 3.5 — Workspace polish

Opened 2026-09-16. The owner reviewed the workspace frame shipped in Phase 3 and returned a
mix of immediate defects (see Findings, 2026-09-16 — those are in flight, not roadmap) and
product decisions that do not fit any existing phase. This phase holds the latter.

- [ ] ZEN mode for both Read and Edit: hide everything non-essential from the screen.
      Distinct from focus mode (Phase 3, `Ctrl`/`⌘`+`\`), which hides only the sidebar.
- [ ] `Ctrl`/`⌘`+`K` quick search / command palette.
- [ ] Workspace dashboard, two levels (owner decision 2026-09-17): the dashboard itself
      lists **shelves**; opening a shelf shows its **bookshelf**, books rendered as covers
      with a user-chosen colour and cover per book — replaces the current card-list
      dashboard.
- [ ] Management sidebar: inside management screens (members, registration, and future
      settings screens) the sidebar switches from the navigation tree to a dedicated
      management sidebar. Team-level settings for sharing models and rule packs/cells
      (`docs/SPECS.md`) and personal settings will live here once built — Phase 6 owns the
      rule pack model itself; this phase only owns where its UI lives. **Approved by the
      owner, 2026-09-17, together with the invite dialog** (`docs/UI-CHECKLIST.md` Review
      Log) — "settings feels like something apart."
- [ ] Root panel for the Super Root (owner decision 2026-09-17, closes the plans Open
      Question above): every workspace in the instance, and plan management — the Phase 1
      admin route this phase's management sidebar has been waiting to reach.
- [ ] Notion-like block editing on the existing ProseMirror schema: a block handle, an inline
      floating toolbar, and `/` to insert tables/headings/etc., replacing the crowded
      breadcrumb-plus-buttons contextual bar. Editor direction confirmed 2026-09-16: stay on
      ProseMirror rather than migrate — Tiptap is ProseMirror with a wrapper, and Editor.js
      stores JSON blocks, which would break markdown-as-truth and GATE-2. Built 2026-09-16
      (`feat/editor-block-commands` for the package, `feat/editor-block-ui` for the Vue side:
      toolbar, handle, tunes, undo/redo, `/` icons); awaiting the owner's review.
- [ ] Edit mode carries no frame or border around the document (owner decision 2026-09-17):
      the environment — the bar, the block handle, the tools above — signals edit mode in
      harmony with Nuxt UI, never a box that fights the block handle above. Amends the block
      editing bullet above; not yet built against this rule.
- [ ] Edit mode stays a single mode with an Obsidian-style shortcut toggling live preview and
      raw markdown source, rather than two separate modes (owner decision 2026-09-17).
      Markdown stays the truth, so the toggle must be lossless in both directions.
- [ ] Route pages as `/w/<workspace-slug>/p/<uuid>` (owner decision 2026-09-17, option b):
      the workspace slug in the URL, a stable id, the hierarchy carried in the breadcrumb
      rather than the path. Old `/pages/<uuid>` routes must redirect rather than break.
      Needs a `slug` column on `workspaces` and its own uniqueness/rename handling — not
      designed yet.
- [ ] Creation dialog never asks what it already knows (owner decision 2026-09-17): location
      and type come from the row and the action chosen, so only the name is asked; the rest
      (location, type) stays reachable but folded, not asked up front.
- [ ] **Book mode** (owner decision 2026-09-17, new and large). Entering a book makes it the
      header and the scope: chapters and pages chain into one continuous read, like a PDF;
      AI stays scoped to that book; nothing drifts to the rest of the workspace until the
      person returns to the general view. The owner's framing: "a book as a project is a
      unit of concentration." Needs its own design pass before tasks — this bullet is the
      placeholder for that.
- [ ] Fix the 320px `ConfirmDialog`-under-drawer stacking defect (Findings 2026-09-16,
      "found on the way, not fixed") the owner's way: `ConfirmDialog` always outranks every
      other overlay, drawer included (owner decision 2026-09-17). The two Reka dialogs both
      sit at `z-index: auto`; the fix is a stacking-context ruling, not a per-screen patch.
- [ ] **Deleting a workspace lives in the workspaces list (`/workspaces`), never beside the
      tree** (owner decision 2026-09-23). The tree's header carries nothing destructive at
      all — the owner read a red trash beside `New…` as "delete the workspace", which is the
      one thing that row must never be able to mean (Findings, 2026-09-23). A workspace is
      deleted from the screen that lists workspaces, where the thing being deleted is the
      row the person is pointing at. Needs the delete-and-trash model extended above the node
      hierarchy (what happens to members, invitations, the slug) — no design pass yet, and
      `/workspaces` has no such control today.
- [ ] **Team decisions register** (owner decision 2026-09-17, new). A per-workspace place
      where important decisions are abstracted out of documents and kept so the knowledge is
      not lost — fed by hand and by the AI when it detects a decision in a document. Related
      to `docs/SPECS.md`'s rule packs and cells (Phase 6, below) without merging into that
      model: a rule pack is a convention applied going forward, a decision register is a
      record of what was already decided and why. Needs its own design pass; no schema or
      screen exists yet.

### Phase 4 — Diagrams

Reaffirmed by the owner 2026-09-17: images and diagrams stay next after the current polish
phase, unchanged from the 2026-09-16 scoping below.

- [ ] Adopt Mermaid (and D2) fenced code blocks as the primary diagram format. Diagrams
      are text: they diff, they are indexable by RAG, and the AI can author them.
- [ ] Render diagram fences client-side in Read mode.
- [ ] Render diagram fences live in Edit mode with error display for invalid syntax.
- [ ] Integrate the Kroki service for server-side SVG rendering (export, PDF, previews).
      Keep headless browsers out of the API container.
- [ ] Add a diagram-focused slash command with starter templates (flowchart, sequence,
      ER, C4-style architecture).
- [ ] Support images and SVG assets inline in pages — upload through the `BlobStore` port
      (Phase 1), render in Read and Edit. Scoped into this phase 2026-09-16.
- [ ] Explicitly defer Excalidraw. Record the tradeoff: freehand scenes do not diff and
      are not RAG-indexable, so they are an escape hatch, never the default.

### Phase 5 — AI layer

Multi-provider inference, retrieval, and the idea-to-design-document flow.
`ai-provider-foundation` (2026-09-06) delivered the provider half — everything depending on
`packages/markdown` (chunking, retrieval, the idea-to-design-document flow, AI editor actions)
remains in a later change, per that proposal's own "Out of Scope" section; items below are marked
accordingly rather than left as a blanket unchecked list.

- [x] Integrate the Vercel AI SDK as the single inference abstraction.
- [x] Wire providers: Anthropic, OpenAI, Google Gemini, DeepSeek, OpenRouter.
- [x] Build a per-model **capability registry**: tool calling, structured output, prompt
      caching, vision, context window, embedding support. Providers are not interchangeable
      and the app must degrade deliberately rather than fail at runtime.
- [x] Implement BYOK per workspace: envelope encryption at rest, decryption server-side
      only, credentials never serialised to the client under any code path.
- [x] Validate a credential when it is saved (cheap models-list call) and store the
      validation result so misconfiguration surfaces at settings time, not mid-generation.
- [x] **Separate `chat_provider` from `embedding_provider` in configuration.** They are
      independent settings with independent credentials. Do not assume a workspace's chat
      provider can produce embeddings.
- [ ] ~~Verify embedding support per provider before wiring it, and record the outcome as a
      Finding.~~ **Partially resolved 2026-09-06**: Anthropic and DeepSeek confirmed absent via
      vendor documentation (no probe needed). OpenAI, Gemini and OpenRouter remain **unknown** —
      `ai:probe` was built and run, but no provider key was available in this session. See the
      2026-09-06 Finding "Per-provider embedding support: OpenAI, Gemini and OpenRouter remain
      unverified this session". **OpenRouter resolved 2026-09-17**: `ai:probe` with a real key
      observed HTTP 200 and 1536 dimensions from `openai/text-embedding-3-small` (Finding
      2026-09-17, "Cheap models first"). OpenAI and Gemini direct still unknown. Left unchecked
      until those two are probed and an OpenRouter `EmbeddingModelPort` adapter exists.
- [ ] ~~Provide a local embedding fallback so an operator holding only a chat credential
      still gets working retrieval.~~ **Seam built, not satisfied, 2026-09-06**: the registration
      guard and resolution path exist (`packages/core/src/ai/embedding-registration.ts`,
      `embedding-configuration.ts`), but no local model emitting the required 1536 dimensions was
      identified — bge-m3 and e5-large emit 1024. `resolveLocalFallback()` reports "none available"
      today, honestly. See the 2026-09-06 Finding "No local embedding model exists that emits 1536
      dimensions: air-gapped RAG has no path today". Left unchecked — the operator-facing outcome
      this item describes does not exist yet.
- [x] Store `embedding_model` and `dimensions` on every chunk row.
- [x] Reject writes that would mix embedding models or dimensions within one index.
- [x] Implement reindexing as an explicit, tracked, resumable job with progress reporting —
      changing the embedding model invalidates the entire vector index.
- [ ] Implement pgvector similarity search with **GATE-3**: `workspace_id` in the SQL
      `WHERE`, never a post-filter. — *deferred to the retrieval slice (needs `packages/markdown`
      chunking); explicitly Out of Scope for `ai-provider-foundation`.*
- [ ] Return citations that resolve to `(page_id, block_id)` so every RAG answer links
      back into the document. — *deferred to the retrieval slice, same reason.*
- [ ] Build the idea -> interrogation -> design-document flow: the model generates
      clarifying questions, surfaces gaps, challenges assumptions, and converges on a
      structured design document with modules and phases. — *deferred; no UI ships in
      `ai-provider-foundation` (proposal — "Out of Scope").*
- [ ] Use `generateObject` structured output for the design-document schema so the result
      is parseable rather than prose to be scraped. — *deferred with the design-document flow
      above. The structured-output degradation ladder it will run on on already ships
      (`apps/api/src/ai/gateway/structured.ts`).*
- [ ] Implement AI actions scoped to a selection: expand, summarise, critique, convert to
      diagram, extract tasks — anchored on block ranges. — *deferred; needs `packages/markdown`
      block anchoring from Phase 2.*
- [ ] Post-AI interaction mechanics scoped to a selection: ask a question about the selected
      text, and comment on a selection — confirmed 2026-09-16, alongside the selection-scoped
      actions bullet above.
- [ ] Land every AI edit as a **pending revision** reviewed through the diff view, never a
      direct write. — *deferred; needs the diff view (Phase 2).*
- [x] Order every prompt for cache reuse: stable prefix first (tools, then resolved rule
      packs and system instructions), volatile content last (document body, user question).
- [x] Implement per-workspace token and cost accounting: log provider, model, input and
      output tokens, and cost for every call.
- [x] Enforce plan limits from the accounting ledger — pre-call admission refuses an
      over-budget request with a machine-readable reason (limit, outstanding). *User-facing
      **messaging** (a rendered UI string) is deferred with the rest of the AI panel — no UI
      ships in `ai-provider-foundation`.*

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
- [ ] Support user-contributed colour themes, in the spirit of Obsidian's theme community, on
      top of the CSS-variable token system above. Confirmed 2026-09-16 — the design system
      already commits to surviving theme and icon-pack selection (`apps/web/PRODUCT.md`).
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
- [ ] Graph view: visualise the corpus over its wiki-link and block-reference edges (owner
      decision 2026-09-17, named as a later item — depends on the clickable wiki-links and
      block references above and on backlinks actually being surfaced, Phase 2).

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

### 2026-09-23 — Two toasts are one tier working, and a screenshot that claims a theme has to assert it

Two things the e2e suite taught this batch after the toasts landed, both worth keeping.

**A toast stays for a few seconds, so a test that acts twice sees two.** `e2e/editor.spec.ts`'s
`saveAndConfirm` saved, bolded, and saved again inside five seconds, and its
`getByRole('status').filter({ hasText: /Saved/ })` then resolved to two elements — a Playwright
strict-mode violation, and the first thing the banner-to-toast move broke. That is the tier working
(each save is confirmed, and the confirmations stack up to the cap) rather than something to assert
away, so the helper waits for the first. The same shape in `e2e/tree-writes.spec.ts`: a created
row's sentence is now in *two* places on purpose — the tree's always-present live region and the
toast — so a `toHaveCount(1)` that used to mean "announced once" now means "announced in one place
only", which is not what the rule says (`docs/UI-CHECKLIST.md` §4.12). It names both.

**A screenshot that claims a theme proves nothing unless the theme is asserted.** The review
material for this batch is shot at 1280 light, 1280 dark and 320 light, and the dark shot of the
read screen came out **light**: the theme preference is applied by color-mode's own client plugin,
and `waitForHydration` does not wait for it — the page was photographed in the window between the
server's light document and the client's dark one. Nothing was wrong with the screen; the evidence
was simply false. `e2e/authoring.spec.ts` now asserts `<html>`'s class beside every shot
(`expectTheme`), which both closes the window and makes the claim the file's name is making. Worth
copying wherever a suite photographs a theme it did not assert.

### 2026-09-23 — Status banners became toasts, and the tier rule moved into the checklist

The owner, pointing at the green "Saved “parla”." bar under a page title: *"estas cosas pueden
manejarse como toasts."*

**What moved.** Exactly the transient, successful confirmations: "Saved “X”." (edit mode),
"Created <kind> “X” in “Y”." and "Moved “X” to the trash." (the tree), and "Invitation sent to
<address>." (members). Each is now one sentence in a toast through `useStatusToast()`, which is the
one place the tier's role, politeness, dismissal, icon and duration are chosen — a product where
each call site picks its own is a fourth notice shape per screen, which is the defect the three
`InlineNotice` tiers already exist to prevent.

**What deliberately did not move**, because a toast removes itself: every error and refusal, "your
work is preserved" after a failed save, the lock-lost notice, the not-canonical and dead-anchor
exits, the tree's refused drag, create, rename and delete reasons, and every `PageNotice` panel —
those are states the screen is in. The auth screens' success bars stay bars: they replace the form
the person submitted and carry the next step, which is not transient at all.

**Two surfaces on purpose.** Where a screen already kept an always-present live region — the tree's
and the members screen's — the region still says the sentence and the toast is what a sighted
person reads. That pairing was already the case for the trash chip (Review Log, 2026-09-18, which
records the double announcement as known), so nothing regressed; the visible half simply stopped
being a chip that stayed. The members screen's region is now `sr-only` in every state rather than
becoming a hand-rolled success chip — a fifth notice shape nobody had noticed.

**The saved confirmation is now correct by construction.** `useSavePage`'s status legitimately stays
`success` until the next save resolves, so the chip had to be computed away with
`showSavedBanner = success && !isDirty` or it went on claiming a document was saved while it was
being edited again. A notice that removes itself cannot make that claim: the toast fires on the
*transition* into success, exactly once per save, and `edit.test.ts` holds both halves.

**Where the rules live now.** The four shapes are stated in `InlineNotice.vue`, as the three were;
the rule for *choosing* between them is new `docs/UI-CHECKLIST.md` §4.12, because which surface a
message takes is a correctness matter and the checklist wins on those. `docs/DESIGN-SYSTEM.md` §9.6
loses its "snackbars keep `inverse-surface`" line — that ruling rested on snackbars being rare, and
a toast on every save is not rare — with the reasoning and both measurements in its §14.

**Not moved because it does not exist yet:** "restored". Trash restore is Phase 9 and the screen is
not built; when it is, its confirmation is a toast by this rule. A rename from the page's own title
field is also not confirmed by a toast: the heading the person just typed into is the confirmation.

### 2026-09-23 — The page title is edited on the page, and a second tree instance silently undid the rename

The owner: *"El title, se edita y es el mismo title del page, como en obsidian."* What shipped is
the half that needs no change to a single stored byte: the title is editable in place at the top of
read and edit mode, and editing it renames the node through `PATCH /nodes/:id` — the tree's own
rename path, classified by the tree's own `classifyWriteRefusal`, so one write has one rule
wherever it is asked from. The half that was **not** built — the title living in the markdown body
as the document's first heading — is in Open Questions with the argument, because it would rewrite
the canonical bytes of every page, shift every block anchor, and give one fact two writers.

**Found on the way: two instances of `useWorkspaceTree` were not coherent.** The sidebar holds one
and the page now holds another; both mirror their transport's refs into the one shared `useState`
record, and each was *seeded* from that record exactly once, at creation. So a write through one
left the other's own refs on the pre-write tree, and the next write through that second instance
rebuilt the tree from what it last saw — silently undoing the first. Reproduced as a unit test: a
page renamed from the page, then a rename through the sidebar's instance, and the first rename was
gone. Each transport now follows the record in both directions (`nodes` and `rootId` only; status,
message, `manageable` and ownership are `load()`'s). Nothing in the tree's own behaviour changes:
the optimistic-write contract and its "zero `GET /tree` after a successful PATCH" e2e are
untouched.

**Decisions worth naming, because a reviewer will ask:**

- **The field is inside the `<h1>`, not instead of it.** The screen keeps exactly one `<h1>` in
  every state it has (checklist §4.4), and the field carries its own accessible name because a
  heading is not a label.
- **No box, and the caret is the indicator.** The reviewed precedent is the source view's text
  area (`DESIGN-SYSTEM.md` §14, 2026-09-17): a text surface that *is* the document takes the
  document's treatment, and WCAG 2.4.7 counts the text cursor as a text field's focus indicator.
  A 56px outlined field where the title stands would be a form control wearing the heading's
  place.
- **Two ways in.** The title itself opens the field, as in Obsidian; the pencil beside it is the
  keyboard's way in and the one with a name and a tooltip, drawn quiet and revealed on hover or
  focus — the comment gutter's "+" treatment, never out of the tab order.
- **Optimistic, with the whole screen agreeing.** The heading, the breadcrumb and the tab title
  read one computed name, so there is no window in which the screen says two things; a refusal
  puts all three back together.

**Known gaps:** a caller who may only `read` is offered the field and refused by the server — the
standing "no per-node `write` signal reaches the client" gap the app bar's "Edit" has carried since
2026-09-14, and fixing it here alone would make this control disagree with the two beside it. The
title field has no `F2`, which the tree's row has; the pencil is the keyboard path. A rename does
not stale the page's *history* screen, which shows revision rows rather than titles.

### 2026-09-23 — Task lists were four layers of nothing, and code had no colour (branch `feat/task-lists-and-highlighting`)

Two owner reports: *"creo que no se soporta ok el task list"*, and code blocks with no syntax
highlighting. The first one's diagnosis is the interesting half, because the layer everybody
would have checked first was already correct.

**What was actually wrong with task lists, layer by layer.**

| Layer | State before | Evidence |
| --- | --- | --- |
| Parser / round trip | **Correct.** `- [ ] a` / `- [x] b` parse to `listItem{checked}` and serialise byte-identically; `modelled/task-list.md` has been inside GATE-2 since the `checked` attribute was added. `*` normalises to `-` and `[X]` to `[x]`, which is the pinned canonical spelling doing its job. | `canonicalise('- [ ] a\n- [x] b\n')` is a fixed point |
| Editor — input rule | **Missing.** Typing `- [ ] Ship it` produced a BULLET whose text was the literal `[ ] Ship it`, which `toMarkdown` then escaped to `- \[ ] Ship it`. | no rule for it existed; the live set was `#`, `>`, `-`, `1.`, `**`, `_`, `` ` ``, `~~`, `*`, `__`, links, autolinks |
| Editor — the box | **Missing.** `schema.ts`'s `toDOM` rendered a task item as an ordinary `<li>` carrying `data-checked`, an attribute no stylesheet read. `- [ ] a` and `- a` drew identically. | nothing in `main.css` matched `data-checked`, `task-list-item` or `contains-task-list` |
| Editor — ticking | **Impossible.** `/task-list` could set `checked: false`; no command, keystroke or click could ever set it to `true`. | `taskListCommand` returns `false` when `checked !== null` |
| Read mode | **Half right.** `render()` already emitted `<li class="task-list-item"><input type="checkbox" disabled>` and the sanitiser already let it through — so the boxes were there, inert (correct: read mode serves cached HTML and has no write path), and completely undressed: a disc bullet with a browser checkbox beside it. | `render('- [ ] a\n')` |
| Styling | **Nothing.** No rule in `main.css` had ever mentioned a task list. | as above |

So the owner was reporting the *only* layer a person can see, and the pipeline — the layer a
maintainer checks first — was never the problem.

**The known GFM limit still holds, and is still not fixable below the pipeline.** GFM cannot
spell an EMPTY task item: `listItem{checked:false}` with no text serialises to `-`, and `- [ ]`
alone re-parses as literal text (`canonicalise('- [ ]\n')` → `'- \\[ ]\n'`). A task list created
on an empty line and saved before anything is typed comes back a bullet. It is not what the
owner hit — every layer above was broken for a task item that *did* have text — but it is the
one thing a fix cannot reach.

**Highlighting: two measured findings worth keeping.**

- **Shiki's tokenisation is not deterministic at its defaults.** It inherits VS Code's
  `tokenizeTimeLimit`, 500 ms per line, and `vscode-textmate` honours it by giving up mid-line
  and emitting the remainder as one undifferentiated token. A grammar's first line pays for
  compiling its rules, which crosses that budget regularly on this host — so the same block
  rendered coarse once and complete afterwards: `const x: number = 1; // c` returned 3, then 6,
  8, 9 and 10 style spans across five consecutive calls, still climbing. Two to five of the
  thirty languages disagreed with themselves between consecutive calls, under both regex
  engines and every `target`. `rendered_html` is a cache, so that would have made a save and a
  later backfill of the same bytes disagree, and any test asserting on the output flaky by
  construction. `tokenizeTimeLimit: 0` fixes it, and the output then matches the WebAssembly
  Oniguruma engine token for token — the independent check that lifting the limit restores the
  *correct* tokenisation and not merely a consistent one. `tokenizeMaxLineLength` (VS Code's
  own 20 000) takes over the guard, bounded by the input rather than by the clock.
- **A double-click was not two clicks.** With only `handleClickOn` bound, ticking a box and
  immediately unticking it left it ticked: ProseMirror routes the second press to
  `handleDoubleClickOn` by the event's own `detail`, and nothing was listening there. Found by
  an e2e test doing what a person does.

**Costs, measured on this host (Bun 1.4.2).** Importing the thirty grammar modules: ~180 ms and
~20 MB RSS, once per process, at module load. Building the highlighter: ~80 ms, once, on the
first highlighted fence. Compiling one grammar: 0–300 ms, once per language a document uses.
Highlighting: ~1.7 ms per line. All of it lazy past the import, all of it server-side;
`CURRENT_PIPELINE_VERSION` went 4 → 5 so `backfillStaleRenders` carries the colouring to the
corpus cached before it shipped.

**Found on the way, recorded rather than fixed: a list item's first paragraph carries a 16px top
margin in the editor and not in read mode's tight lists.** `.doc-body p { margin-top: 1rem }`
matches a list item's paragraph, and the editor always wraps an item's content in one while read
mode's *tight* list does not — so a two-item checklist stands ~42 px apart in edit mode and ~4 px
apart in read mode, and the same is true of every ordinary bullet list. It predates this branch
and is visible in this batch's screenshots only because task lists are now visible at all. The
fix is one rule (`li > p:first-child { margin-top: 0 }`), but it changes what a *loose* list
looks like in read mode as well, which is a typography ruling for `docs/DESIGN-SYSTEM.md` §2.3
to make once rather than a rule improvised inside this batch (checklist §1's standing rule).

**Also recorded: the editor names almost none of its key bindings anywhere.** `Mod-B`, `Mod-I`,
`Alt`+arrows, `Tab`/`Shift-Tab`, `Mod-E` and now `Mod-Enter` are discoverable only by knowing
them. The navigation tree solved this with a "Keyboard help" icon carrying a `UTooltip` and an
`sr-only` paragraph (`NavigationTree.vue`); edit mode has no equivalent. This batch names
`Mod-Enter` on the checkbox itself (`aria-label`/`title`, so it is announced and shown where the
manipulation happens) and leaves the general surface owed.

### 2026-09-23 — Commenting on a selection answered 500: the anchor mint spliced its way out of canonical form

The project owner selected text on one of their pages, wrote a comment, and got a 500.
`POST /pages/:id/comments` mints an anchor onto an unanchored block and saves it through
`savePage()`, which refused:

```
NotCanonicalError: markdown is not in its own canonical form; normalise before saving
 canonical: "This is a content @Seed Owner  ^7HZCW31PRF\n"
```

**The stored bytes, read out of the owner's database:** `"This is a content @Seed Owner&#x20;\n"`.
Note what that is *not*: it is not a trailing space. The paragraph ends in a space, and canonical
form spells a trailing space as the entity `&#x20;`, because an unescaped one does not survive a
reparse. The page's three revisions are all the owner's, minutes apart, through the editor and
`savePage()` like any other save. **`canonicalise()` is a fixpoint on those bytes.** The page was
never the problem, no write path bypassed canonicalisation, and the seed is not implicated — the
first two hypotheses worth having were both wrong, and only reading the real row said so.

**The defect is the splice.** `mintAnchorAtBlock` appends the literal ` ^id` at the block's end
offset — a byte operation on Markdown source. A block's last bytes are exactly where a spelling
can depend on what *follows* them: append ` ^id` and the space is no longer trailing, so its
canonical spelling is a literal space, and `…Owner&#x20; ^ID` is no longer its own fixed point.
`savePage()` refuses exactly that. The mint had produced a document its own save path rejects.

**`stripBlockAnchors` had it in the other direction**, and worse. It is the inverse splice, and it
is what `DeadAnchorError.corrected` hands back to a client as "the document to re-submit" — its
doc comment even claims "canonical, and safe to re-submit". Remove the anchor and the space
becomes trailing again: `"…Owner \n"`, which canonicalises to `"…Owner\n"`. The correction was a
document the save path would refuse all over again. Nobody had hit it because it needs a dead
anchor *and* a spelling the splice invalidates, but it was the same bug with a longer fuse.

**The fix, and why at that layer.** Both functions now return `canonicalise()` of their spliced
result. The comment-overlay spec already requires it in so many words — "MUST write it into the
canonical Markdown … The mint MUST round-trip byte-identically" — so this is the contract being
met, not a new one. The alternative, canonicalising in the comment route before saving, was
rejected: `mintAnchorAtBlock` is the *one* anchor minter, and a mint that can emit non-canonical
bytes is a trap laid for every future caller, not just this one. `canonicalise` is idempotent by
construction, so the result is a fixed point for any input; when the input was canonical — which
stored page Markdown is, by construction (D1) — the only bytes that differ from the raw splice are
the ones whose spelling the splice itself invalidated.

**A comment on a page that was never canonical now normalises it.** Stated plainly because it is a
real consequence: a `page_content` row written around `savePage()` (a direct INSERT, a backfill)
is not canonical, and the mint canonicalises the whole document rather than only the anchor. That
is deliberate. A commenter holds `comment`, not `write`: they cannot repair such a page and must
not be the person who is told about it, and normalisation is the save path's own documented remedy
for a non-canonical document. The route test `a comment on a page whose stored markdown was never
canonical still opens a thread, and normalises the page` pins the behaviour so it is a decision
rather than a side effect.

**The excerpt was being located against bytes that were never stored.** The route located the
comment's quote in the *pre-mint* source, then saved the minted document. That was already only
safe because the splice appended; now that the mint also *respells*, the offsets named bytes that
did not exist in the saved page, and a stored quote that is not a substring of its block's source
skips save-time reconciliation's exact rows on every later save — orphaning a comment on a block
nobody touched, which is the whole reason `locateQuoteInBlock` exists. The quote is now located in
`minted.markdown`, with the trailing ` ^id` stripped first so an anchor is never part of an
excerpt.

**And the refusal is now honest.** `POST /pages/:id/comments` caught *none* of `savePage()`'s four
typed refusals, so every one of them reached a person as an unhandled 500 — the same
`NotCanonicalError` that the editor is shown as a `409` with the normalised document attached.
This was recorded as a follow-up on 2026-09-13 ("Until it does, a reintroduced dead anchor is a
500") and only half closed on 2026-09-16, when the mint started passing `reservedIds`: the
`reservedIds` half removed one *cause*, and the entry then read as done. The mapping is now one
function, `apps/api/src/routes/save-page-refusal.ts`, called by both `savePage()` callers, so a
third caller cannot inherit the gap and the two existing ones cannot drift into disagreeing about
what a stale save is called. It is tested directly: three of the four refusals are races no route
test can provoke on demand, and asserting the mapping through a route would have left them
unstated.

**The category — a byte-offset edit into a context-sensitive spelling.** Every splice in this
repository that edits Markdown *source* by offset is a candidate: the bytes at the seam may be
spelled the way they are *because* of what is on the other side of it. The two in this module are
now closed by construction. `packages/db/src/comments/reconcile-comments.ts` re-finds its quote by
text rather than trusting an offset, so it does not join the class; nothing else splices Markdown
source by offset today. There is no check for this, deliberately: the property is
`canonicalise(f(x)) === f(x)`, which is a test each such function can state about itself in one
line, and a script that tried to find "functions that splice Markdown" would be guessing.

**Seen on the way, not fixed.** `packages/db/testing/provision.integration.test.ts`'s two
self-healing cases (`provisioning from a container compose left in 'Created'`) fail on this host
against the real container runtime, before and after this change, with `no container with name or
ID "deep-wiki-test-heal_postgres_1" found`. Environmental, unrelated, and already the subject of
the 2026-09-16 entry on the same file.

**Impact.** `mintAnchorAtBlock` and `stripBlockAnchors` are canonical by construction; a comment on
a selection works on any page, canonical or not; a refused comment save is a typed 409 or 404 the
client can render, never a 500; and a comment's excerpt indexes the bytes that were actually
stored. GATE-2 stays at 182.

### 2026-09-23 — The source-mode refusal promised two spellings it did not have, and was a wall where a formatter belonged

Two defects in one notice, both reported by the owner on the same screen: *"Line 6 is not in
canonical form. As typed: — canonical: Write it the canonical way to open the visual view, or keep
editing here."*

**Why both examples were empty.** `probe()` reports the line at which the *bytes* first diverge
(`packages/editor/src/probe.ts`, `firstDivergenceLine`), and `describeRefusal` read that line out
of both texts. For the commonest non-canonical document a person produces — one blank line too
many, or two newlines at the end of the buffer — the byte that differs is a newline, so the line
it lands on is **blank in both texts** and both "spellings" were the empty string. Measured
against the real pipeline: `"# T\n\nA\n\nB\n\n\n\n"` refuses at line 6, and line 6 of the text and
line 6 of its canonical form are both `""`. A second shape had the same effect: a divergence past
the end of the canonical text (`lineOf` answers `''` by design), and a third promised a difference
it could not show — a missing trailing newline diverges on a line whose two spellings are the same
word ("As typed: A — canonical: A").

**Impact.** The two spellings now travel together in one `spellings` object and are `null`
together, so the notice cannot render one without the other or render two empty code spans; it
names the line and stops when there is no example to give. Five cases are unit-tested in
`apps/web/app/utils/editor-view.test.ts`.

**The wall.** The owner: *"es mejor trabajar con un formateador o algo así para que me permita
manejarlo."* `formatSource` (same file) is the second decision the toggle makes — the buffer is
rewritten to its canonical form and the visual view opens on it, in one click on a control that
says what it does. The bytes it writes are `roundTrip` from `@deep-wiki/editor/mount`
(`toMarkdown(fromMarkdown(md))`), which is the same function `probe` compares against, so the
action and the check cannot disagree about what canonical means. Measured against the real
pipeline on ten non-canonical samples, `roundTrip` is byte-identical to `packages/markdown`'s
`canonicalise` on every one of them, is idempotent, and the probe accepts its output — but the
implementation re-probes the formatted text rather than assuming it, because the two conditions
are not the same one.

**Where the wall stays, and why that is the whole answer to "would formatting lose something".**
`fromMarkdown` **throws** `UnsupportedConstructError` for a construct the schema does not model
rather than dropping it (`packages/editor/src/from-markdown.ts`), so a canonicaliser that would
lose content cannot return — it raises. `formatSource` answers a throw by rewriting nothing and
keeping the refusal, and the notice offers no Format action when the probe named a construct
(`refusal.formattable`). There is no case in which a successful format returns a document with
less in it than it was given: it changes spelling, never content.

**Left open:** the refused-document panel's unbuilt exit is still called "Normalise this document"
while the live action is "Format" — two words for one idea, and the owner's call which survives.
A line whose only non-canonical feature is trailing whitespace shows two code spans that look
identical, because the difference is invisible characters; the same whitespace-glyph follow-up the
diff screens already carry (2026-09-17).

### 2026-09-23 — The vacuous-negative sweep: 85 candidates, six real, and why there is no thirteenth check

The entry below ends with a suggestion: *every `toHaveCount(0)` and `not.toBeVisible()` in `e2e/`
that runs between a `goto` and a `waitForHydration` is a candidate.* That sweep has now been run
over the whole directory, and the inventory it produced is the reason this batch fixes six
assertions and builds no check.

**The sweep.** A throwaway script walked every `test(...)` body in `e2e/*.spec.ts`, tracked the
last `goto`/`reload`/`goBack`/`goForward`, and flagged every negative assertion — `toHaveCount(0)`,
`not.toBeVisible()`, `toBeHidden()`, `not.toContainText()`, `not.toContain()`, `toEqual([])`,
`count() === 0` — reached without a `waitForHydration` in between. **85 flags across 18 files.**
Six were real. The other 79 are sound, and they are sound for four different reasons.

**What actually makes a negative vacuous.** Not the missing hydration wait. The condition is
narrower and it is *semantic*: the thing asserted absent must be drawn by the **client**, and
nothing between the navigation and the assertion may prove the client has drawn. The second half
is what the mechanical rule cannot see, because what proves it is a property of the Vue
components, not of the test file:

- `getByRole('treeitem')` resolves only after hydration *and* the tree fetch — `NavigationTree.vue`
  loads under `import.meta.client`. A treeitem being visible is a hydration proof.
- `getByRole('heading', { level: 1 })` on the read screen resolves from the document the **server**
  sent (`useApiRead` + `ssrCanAuthenticate`). It proves nothing.
- `getByTestId('editor-surface')`, the workspaces list, the members listing, the presence
  indicator, the comment chips: client. The read article, the "Edit" link, the permission-denied
  notice, the "This page is empty" notice, `sidebar-no-workspace`: server.

Two locators, the same shape, opposite verdicts. A static checker would have to know which Vue
branch each one lands in.

**The six, and the proof for each.** Proved by running a throwaway probe spec against the real
stack with each assertion's subject deliberately made to exist.

1. **`e2e/read.spec.ts`, the read-only invariant (two tests) and `e2e/comments.spec.ts`, "a reader
   with read but not comment sees nothing of the overlay".** These already waited for hydration —
   the entry below fixed them — and were **still** premature. *A hydration wait is not a fetch
   wait.* The gutter is drawn from one `GET /pages/:id/comments` (`usePageComments`), which
   carries both the threads and `canComment`, and it leaves *after* hydration. A screen whose
   whole claim is that the overlay draws nothing offers no positive that answer must have
   produced, so there is nothing on it to wait for. Fixed with `pageCommentsAnswered` in
   `e2e/hydration.ts` — registered before the `goto`, because on a warm route the response lands
   before the next line runs.
2. **`e2e/read.spec.ts:283`, the 320 "hidden comments" test.** `expect(marks).toHaveCount(0)` was
   asserted before the "Show comments" toggle, on the strength of the server's `<h1>`. Proved
   vacuous directly: the same assertion, made at the same point on a page whose marks **are**
   shown, passed — and the marks were there, visible, a moment later. Fixed by asserting the
   toggle first: its count text cannot be drawn without the fetch.
3. **`e2e/comments.spec.ts:498`** (the pre-backfill page) and **`:223`** (the fresh page) — the
   same shape, fixed the same way: the chip and the "+" move above the absence, because each is
   drawn from the answer the missing mark would have been drawn from.
4. **`e2e/read.spec.ts:62`**, `expect(editorRequests).toEqual([])` — "read mode never reaches the
   ProseMirror/Milkdown bundle". Not vacuous, but measured at **45 client requests logged at the
   assertion point against 566 once hydration finished**: the test was sampling a twelfth of the
   client's module graph, and the editor bundle is reached by a dynamic import in the other
   eleven twelfths. Now asserted after hydration.
5. **`e2e/create-and-open.spec.ts:205`**, `expect(getByText('No revisions yet')).toHaveCount(0)`.
   Sound in this harness, but held up by nothing: the history screen's `<h1>` is
   **unconditional** — it stands over the skeleton branch too — so the absence would also have
   held on a screen that had rendered no answer at all. A negative with no positive twin is the
   shape that hides this, so the twin was added: the one revision the save minted.

**Four false-positive shapes, and why the check is not worth building.**

- **The intervening positive is usually a hydration proof, and telling which requires the app.**
  79 of 85. See above.
- **`goBack()`/`goForward()` in a hydrated app are client-side hops.** Hydration is never lost, so
  every negative after them is sound — but a rule that counts navigations counts these
  (`e2e/data-layer.spec.ts` alone contributes five).
- **Some negatives are deliberately about the server's document and must run before hydration.**
  `e2e/frame.spec.ts:261` asserts the sidebar is hidden after a reload *and before* the
  `waitForHydration` five lines below it, because "no sidebar flashing by first" is the rule. A
  check would have to allow-list exactly the assertions that carry the most intent.
- **An interaction between the navigation and the negative proves nothing.** A click before
  hydration falls through to a dead element — that is the 2026-09-16 regression `waitForHydration`
  was written for. So clicks cannot be the proof signal; and they are everywhere, so counting them
  as one is wrong and not counting them is noise.

And the decisive one: **the check's own stop signal is what two of the six defects already had.**
`e2e/comments.spec.ts:180` and `e2e/read.spec.ts:323` were fixed yesterday with a
`waitForHydration` and were still asserting too early. Any check that stops looking at
`waitForHydration` is blind to them by construction. A rule with 7% precision that cannot see a
third of its own defect class is not a rule; it is 79 allow-list entries and a false sense of
cover.

**What replaces it.** The habit, written down here: *a negative assertion needs a positive twin,
and the twin must be a thing only the client could have drawn.* Where the screen offers one, assert
it first. Where it offers none — because the claim is that nothing is drawn — wait for the response
the drawing would have come from. `e2e/hydration.ts` now holds both waits and says which is which.

### 2026-09-23 — Two e2e tests that had stopped being true, found by running the suite rather than trusting it

Hunting for other defects of the never-saved class (the entry below) meant running the whole
Playwright suite against a real stack rather than re-reading it. 243 tests: **228 passed, 2
failed, 13 did not run** (both failures are in `serial` files, which abort the rest). Neither
failure is a product defect and neither was caused by this batch — both were already red on
`main` at `fb5ffd0`, which is where a throwaway worktree
(`<repo-parent>/deep-wiki2-worktrees/baseline`) was used to prove it.

**1. `e2e/editor.spec.ts` still measured a toolbar row that had grown a third control.**

`expect(|renameBox.right - rowBox.right|).toBeLessThanOrEqual(1)` — "Rename… ends at the row's
edge" — failed by **exactly 36px**, twice (at 1280 in the sidebar, and at 320 in the drawer).
36px is the icon-only Delete control that `1ce67e5` added to the tree's toolbar on 2026-09-18:
the row still fills the pane, but the control that ends at its edge is Delete now. The batch
that added it updated `e2e/tree.spec.ts` and not this file, and its review-log entry repeats
the earlier batch's measurement sentence rather than a fresh one. Fixed by asking for the
row's **last** control, so a fourth one cannot walk past the edge unnoticed either.

**2. `e2e/comments.spec.ts` raced hydration — and its read-only twin passed vacuously.**

`a commenter starts a thread from a block's "+"` asserted `toHaveCount(2)` on the "+" buttons
with Playwright's default 5s, immediately after the heading appeared. Since the read layer
(`useApiRead`) the article is in the document the *server* sent, and the gutter, the marks and
the "+" are drawn only once the client bundle has hydrated it — measured here on a cold dev
route at ~19s. So the assertion was counting an unhydrated page. Instrumented directly (a
throwaway probe spec in the baseline worktree): at the moment it failed the browser had made
**one** request, the document itself; `GET /pages/:id/comments` had not been sent, so
`canComment` was still its initial `false` and `CommentGutter` drew no "+" at all. After
`waitForHydration` the same page shows both.

The same file's **negative** assertions are the worse half: "a reader with read but not comment
sees nothing of the overlay" (`comments.spec.ts`) and the two read-only invariant tests in
`e2e/read.spec.ts` assert that no mark and no toggle exist — and nothing does exist before
hydration, on any page, for any caller. Those three passed without ever testing the rule they
name. `waitForHydration` was already in this repository for exactly this (`e2e/hydration.ts`,
written after the 2026-09-16 "clicked before hydration" regression) and was called by two of
the file's seven tests; it is now called by all of them.

**The gap class, and it is the same shape as the entry below.** *An assertion about something
the client draws, made before the client has drawn anything, is not an assertion.* It fails
noisily when it is positive and silently when it is negative — and the silent half is the one
that had been green for a week. Worth a sweep: every `toHaveCount(0)` and `not.toBeVisible()`
in `e2e/` that runs between a `goto` and a `waitForHydration` is a candidate.

### 2026-09-23 — A page created from the tree answered "This page does not exist", and three layers of tests could not see it

**What the owner did.** Created a page from the navigation tree. The toolbar said
`Created page “parla” in “complex”.`, the row appeared, the breadcrumb named it — and clicking
it rendered **"This page does not exist."**

**The defect.** `apps/api/src/routes/pages.ts`, `GET /pages/:id`:

```ts
const content = await readPageHtml(deps.sql, { nodeId, workspaceId: node.workspace_id });
if (!content) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);
```

A page node exists from the moment the tree creates it; its `page_content` row exists only from
its first save. `readPageHtml` answers `undefined` for a node with no content row, and the route
read that as the absence of the *page*. The same shape sat in `GET /pages/:id/edit-session` and
`POST /pages/:id/lock/take-over`, so the editor refused the page as well: there was no way to
give a newly-created page its first paragraph through the UI at all.

**Not a trash-work regression.** `git log -S` puts the line in `6f3ef93`, the original read
route. It has been broken since pages became creatable.

**Why nothing caught it — the real defect.** Every fixture in this repository saves content
before it asks anything. `apps/api/src/routes/pages.test.ts` calls `savePage()` at the top of all
35 of its tests; `packages/db/src/locks/page-lock.test.ts`'s only seed helper is
`seedPageWithContent()`; the e2e suites drive pages the seed scripts wrote content into. The
never-saved node — the state *every* page passes through, for as long as it takes its author to
type the first word — had no fixture, so it had no test, in any of the three layers. A suite that
is green because it cannot express the failing state is the finding; the 404 is a symptom.

**The second defect, which the first one hid.** `page_locks` carried
`page_locks_page_fk (node_id, workspace_id) -> page_content (node_id, workspace_id)` from
`0010_page_locks.sql`. `page_content` was the composite key on hand in 0010, and pinning the lock
to it smuggled in "a lock may only exist where content already exists" — invisible for as long as
`edit-session` answered 404 before it ever reached `acquireLock`. Fixing the 404 turned that into
a foreign-key violation on the first lock of a brand-new page. Proved directly: with `0023`'s down
migration applied, inserting a `page_locks` row for a page with no content row fails with
`insert or update on table "page_locks" violates foreign key constraint "page_locks_page_fk"`.

**The fix.**

- **`apps/api/src/routes/pages.ts`** — a page the caller may read, that exists and is live, with
  no content row renders as an **empty document**: `NEVER_SAVED_HTML` (`html: ''`) on the read
  route and `NEVER_SAVED_MARKDOWN` (`markdown: ''`, `contentHash: null`) on `edit-session` and
  `lock/take-over`. The defaults live in the route and deliberately **not** in
  `packages/db/src/content/read-page.ts`: those two functions answer `undefined` for "no content
  row" *and* for "a trashed page's content", and every handler in `pages.ts` has already resolved
  the node through `live_nodes`, so only past that gate can `undefined` mean the row was never
  written. A db-layer default would turn a trashed page's content read into an empty document for
  any future caller that forgot the gate — exactly the disclosure `scripts/checks/trash-filter.ts`
  exists to prevent.
- **`packages/contracts/src/pages.ts`** — `EditSessionResponseSchema.contentHash` is
  `z.string().nullable()`. `null` is already what `SavePageRequestSchema.expectedContentHash`
  means by "the first save", so the two spellings of "nothing is stored yet" stay one value.
- **`packages/db/drizzle/0023_page_lock_before_first_save.sql`** — the lock's foreign key moves to
  `nodes (id, workspace_id, type)`, the key `page_content_node_fk` itself uses (0008), with
  `node_type` CHECK-pinned to `'page'`. Tenancy and node type stay structurally pinned (a lock on
  a chapter is still unrepresentable) and "content exists" stops being a precondition for holding
  a lock. The purge cascade fires one hop earlier: deleting the node took the content row, and
  with it the lock, before; it takes the lock directly now.
- **`apps/web/app/pages/w/[workspace]/p/[id]/index.vue`** — the read screen's empty state
  (`docs/UI-CHECKLIST.md` §3): the page's own `<h1>` stands, and in the article's place a
  `PageNotice` at `level="2"` reading "This page is empty" with "Start editing" — the history
  screen's own never-saved action, verbatim and at the same emphasis (§4.1: match the nearest
  existing screen). It replaces the article rather than standing beside an empty one, because the
  article is what the comment overlay measures its marks against and a page with no content has no
  block to put one on. It also covers the page an author *cleared* and saved (`markdown: ''` is a
  legal document), which read as a blank screen before.

**Absence is untouched.** A caller without `read` still gets the byte-identical 403 this one route
deliberately returns for a directly-requested URL (`usePageRead`'s own note); an id that names
nothing still 404s with `{ "error": "not found" }`; and a *trashed* never-saved page is still
refused identically to an unknown id, because the empty document is only ever reached after
`live_nodes` has found the node. All three are asserted.

**The tests that were missing, at the three layers the defect crossed.**

- **API** — `apps/api/src/routes/pages.test.ts`, a new `describe('a page that has never been
  saved')` whose whole trick is *not calling `savePage()`*: read renders empty, edit-session opens
  an empty editor and takes a real lock, the first save from that session persists and reads back,
  the empty session's lock refuses a second writer and can be taken over, denial and absence are
  unchanged, and a trashed never-saved page is absence. Plus the two sibling surfaces that were
  already right and had no test saying so: `revisions.test.ts` (empty history, not 404) and
  `comments.test.ts` (empty threads and indicators, not 404).
- **DB** — `packages/db/src/locks/page-lock.test.ts` gains `seedPageNeverSaved()` beside
  `seedPageWithContent()`, and two tests: a page that has never been saved can be locked, and a
  node that is not a page still cannot. `packages/db/drizzle/migration.test.ts` asserts the old
  constraint is gone, the new one names `nodes(id, workspace_id, type)`, and the CHECK exists.
- **E2E** — `e2e/create-and-open.spec.ts`, the journey the owner walked: shelf → book → chapter →
  page, all four created **through the tree**, then the page opened, then typed, saved, reloaded,
  and its history read. `e2e/create-open-fixtures.bun.ts` mints one member with
  `read`/`write`/`manage` on the workspace root **and not one node** — the rule of the file is that
  nothing is seeded but the person, because a seeded page is a page the tree did not create, which
  is the habit that hid this for as long as it existed.

**The gap class, for the next time.** *A fixture that always reaches the steady state cannot see
the transient one.* Three suites shared one assumption — "a page has content" — and none of them
stated it, so it was never a decision anybody could review. The same shape is worth looking for
wherever a row is created by one request and filled by another: a workspace before its first
shelf, a book before its first page, a comment thread before its first reply.

### 2026-09-23 — The owner rejected the tree: a trash beside "New", and a question with one answer (branch `feat/tree-like-vscode`)

**The rejection.** The owner looked at the navigation tree and read the red trash button
beside `New…` as *delete the workspace*. That misreading is the defect: the header offered
`New…`, `Rename…` and a destructive icon in one row, and nothing in that row said which of
the three acted on the workspace and which on a row. He also rejected the creation dialog,
which asked "Type" with a radio group holding a single option, **Shelf** — a question whose
only answer was already known.

**What the research said, before anything was built.** Both reference products were read at
source rather than from memory (the report is in this batch's session scratchpad):

- **VS Code** registers exactly four actions against `MenuId.ViewTitle` for the Explorer —
  New File, New Folder, Refresh, Collapse Folders (`explorerView.ts`, lines ~1107–1198).
  **Zero destructive actions are registered there.** Delete and Rename are
  `MenuId.ExplorerContext` plus keybindings (`Delete`, `F2`) and nothing else
  (`fileActions.contribution.ts`). Creation is an input box drawn *in the row* at the target
  folder's own depth — a placeholder item is added to the folder so the tree renders it at
  the right indent, then put into editable mode (`openExplorerAndCreate` → `renderInputBox`);
  Enter confirms, Escape cancels. Rename runs through the **same code path**, opening on the
  current name.
- **Obsidian** puts New note, New folder, Sort, Auto-reveal, Expand all and Collapse all in
  the toolbar; Delete and Rename live in the right-click menu. Creation is create-then-name
  inline, rename is `F2` or the menu, both in place.

Neither product puts a destructive or identity-changing action next to the creation button.
That is the one thing they agree on without exception, and it is what the owner's reading
independently discovered.

**What changed.**

1. **The header is three controls: `New…`, `Filter`, `Collapse all`** (`NavigationTreeActions.vue`,
   now a `role="group"` named "Tree actions" rather than a toolbar of writes). `Collapse all`
   is new; `Filter` moved into the group from the section-header row. **No `Refresh`**: VS
   Code needs one because its tree mirrors a filesystem other processes write to, and this
   tree is drawn from the response of the request that changed it (`useTree`, 2026-09-16), so
   a Refresh button would be a control with nothing to do — said in a comment at the call
   site rather than built.
2. **`Rename…` and the trash left the header.** Both are on the row's own context menu, where
   they already were, plus the keyboard: **`F2`** renames, **`Delete`** trashes. The delete
   flow itself is untouched (`useTrash`, the typed-name confirm, the optimistic removal).
3. **Creation is a row, not a dialog.** `New…` inserts a draft row in the right place with
   its name editable in place and focused; Enter confirms, Escape cancels and removes the
   row. The created row is then selected, and opened when it is a page (a shelf, book or
   chapter has no screen to open). `NavigationTreeDraftRow.vue` is the row,
   `NavigationTreeRowEditor.vue` the field, `useTreeRowEditor.ts` the state machine
   (idle → naming → committing → error).
4. **Never a question with one answer.** `newRowChoice()` reads the one `LEGAL_PARENT_TYPES`
   table: **one** legal child (workspace → shelf, shelf → book, chapter → page) and `New…`
   starts naming it immediately, with no menu; **several** (a book holds chapters *and*
   pages) and a short menu picks the kind first. Derived, never a second list — the table
   already has five recorded copies in this file's history and `single-source.ts` fails the
   build on a sixth.
5. **Rename is the same field**, opened by `F2` or the menu item, on the current title
   selected whole.
6. **The footer: nothing to do — see below.**

**How a refusal is answered, and why it splits in two.** The classification the dialog made
is kept, because it is about what the person can do next:

- **409, a name already taken** → the field stays open, the typed text still in it, the
  server's own sentence beside it and wired with `aria-describedby`. Never a rename behind
  the person's back.
- **403 / 404 / 400 / a dead connection** → the draft row goes away and the reason appears in
  the chip beside the tree, exactly where a refused drag's reason already stands. None of
  those is fixable by typing in that field.

**What the tree owes the field.** The tree is an ARIA tree with a roving tabindex and arrow
navigation, and every key it answers — the arrows, Home, End, Enter, Delete, F2 — is a key
someone typing a name will press. The editor marks itself `data-row-editor`, which
`NavigationTreeNode.onKeydown` checks before reporting a press to the tree (the same guard
`data-row-actions` already had for the `⋯` menu). The draft row is a real `treeitem` so the
tree's shape stays true (`aria-setsize` counts it), and it is `tabindex="-1"` so the arrows
never land on a text box. Focus returns to the row afterwards; the outcome is announced in
the tree's live region, which **moved out of the rows' own branch** — a first shelf is
created on a tree that has no rows to hold the region.

**Found on the way, not a defect of this batch:** the e2e tree fixtures had no session that
could write at the **workspace root** — ownership is not a grant and `can()` never consults
it, and every fixture grant hung off the fixture shelf — so the one case where the hierarchy
leaves a single legal child (`workspace` → `shelf`) could not be driven end to end at all.
The owner now gets `manage` on the root in `e2e/tree-fixtures.bun.ts`.

**The footer (owner criterion 6) needed no change, and this is the evidence.** The criterion
asked for `AppShell`'s footer — "deep-wiki · Material Design 3 · Nuxt UI v4" — to leave the
workspace frame. It is not in the workspace frame and never was: the app has exactly one
`UFooter`, at `AppShell.vue:450`, inside the **`v-else`** branch — the document frame, taken
by a screen that is *not* inside a workspace. Every screen inside the frame (the dashboard,
read, edit, history, diff, members, settings) renders through the `UDashboardPanel` branch,
which has no footer at all. The footer therefore stands only on `/workspaces`,
`/workspaces/new` and the error screen — the "signed-out/marketing-ish shells" the criterion
itself says to keep it on. Verified by reading every `UFooter` site in `apps/web` and by the
screenshots in this batch: `tree-ux-header-1280-light.png` (inside the frame, no footer).
Nothing was removed, because removing it would have taken it off exactly the screens the
owner asked to keep it on.

**Out of scope, recorded not built:** deleting a **workspace** belongs in the workspaces list
at `/workspaces`, not beside the tree. Added to the Phase 3.5 roadmap above.

### 2026-09-17 — Cheap models first: OpenRouter's catalogue priced, and the cheapest routes that declare tools and JSON output (branch `feat/ai-cheap-models`)

**The owner's instruction (2026-09-17).** "If the architecture works with cheap models, it will
work wonderfully with expensive ones." The default model of every AI feature must be the
cheapest one that passes conformance; an expensive model is an upgrade a workspace opts into,
never the baseline. This Finding is the measurement that rule needs — prices from OpenRouter's
public catalogue, then (below, appended as the branch progressed) what the registered cheap
models actually did under `ai:conformance`.

**How the table was produced.** `bun run -F @deep-wiki/api ai:catalogue` (new,
`apps/api/src/ai/openrouter-catalogue{,-cli}.ts`) reads `GET /api/v1/models` and
`GET /api/v1/embeddings/models` — both public, no key — and ranks paid routes by
input + output price. A route is a candidate only when it emits text, declares both `tools`
and `response_format` in `supported_parameters`, has a fixed price (OpenRouter reports `-1`
for its `openrouter/auto` routers), and carries an id the registry could hold: `parseModelId`'s
slug rule refuses `:free`/`:batch` variants and `~…-latest` aliases, so the ranking refuses
them too. Free routes are excluded on purpose — rate-limited, and OpenRouter's terms let them
train on prompts. The `structured_outputs` column is OpenRouter's own declaration that the
route honours a JSON schema in `response_format`; it is a vendor claim, not a measurement.

**Cheapest 20 chat routes declaring tools + `response_format`, prices as of 2026-09-17
(USD per million tokens):**

| Model | $/1M input | $/1M output | Context | `structured_outputs` |
| --- | ---: | ---: | ---: | --- |
| `mistralai/mistral-nemo` | 0.019 | 0.030 | 131,072 | yes |
| `inclusionai/ling-3.0-flash` | 0.021 | 0.063 | 262,144 | no |
| `meta-llama/llama-3.1-8b-instruct` | 0.050 | 0.080 | 131,072 | yes |
| `qwen/qwen3.7-flash` | 0.030 | 0.130 | 1,000,000 | no |
| `openai/gpt-oss-20b` | 0.030 | 0.130 | 131,072 | yes |
| `deepseek/deepseek-v4-flash-0731` | 0.060 | 0.120 | 1,310,720 | yes |
| `inception/mercury-2.5` | 0.040 | 0.150 | 260,000 | yes |
| `mistralai/ministral-3b-2512` | 0.100 | 0.100 | 131,072 | yes |
| `google/gemma-3-12b-it` | 0.050 | 0.150 | 131,072 | yes |
| `openai/gpt-oss-120b` | 0.037 | 0.170 | 131,072 | yes |
| `deepseek/deepseek-v4-flash` | 0.070 | 0.140 | 1,048,576 | yes |
| `inclusionai/ling-3.0-flash-vl` | 0.060 | 0.180 | 131,072 | yes |
| `qwen/qwen3-30b-a3b-instruct-2507` | 0.048 | 0.193 | 262,144 | yes |
| `qwen/qwen3.5-9b` | 0.100 | 0.150 | 262,144 | yes |
| `nvidia/nemotron-3.5-lightning` | 0.080 | 0.200 | 262,144 | yes |
| `meta/muse-spark-1.3-contributor` | 0.100 | 0.200 | 1,048,576 | yes |
| `meta/muse-spark-1.2-contributor` | 0.100 | 0.200 | 1,048,576 | yes |
| `nvidia/nemotron-3-nano-30b-a3b` | 0.060 | 0.240 | 262,144 | yes |
| `mistralai/ministral-8b-2512` | 0.150 | 0.150 | 262,144 | yes |
| `qwen/qwen-2.5-7b-instruct` | 0.100 | 0.200 | 32,768 | yes |

For scale: the one OpenRouter route the registry held before this branch,
`meta-llama/llama-3.1-70b-instruct`, is listed at **0.40 / 0.40** today — the registry said
0.52 / 0.75 (vendor docs, 2026-09-06). Roughly ten to twenty times the price of the top of
this table, per token. The natively-wired entries are further out still (`gpt-4o` 2.50 / 10.00,
`claude-3-5-sonnet` 3.00 / 15.00).

**Embeddings: OpenRouter does offer them.** The 2026-09-06 Finding left OpenRouter embeddings
"unknown" because no key was available; `GET /api/v1/embeddings/models` lists 33 routes today,
and the `ai:probe` outcome against the real endpoint is recorded below. Cheapest 20 paid
routes (dimensions are what the description states; OpenRouter has no field for it):

| Model | $/1M input | Context | Dimensions (declared) |
| --- | ---: | ---: | ---: |
| `perplexity/pplx-embed-v1-0.6b` | 0.004 | 32,000 | not stated |
| `thenlper/gte-base` | 0.005 | 512 | 768 |
| `intfloat/e5-base-v2` | 0.005 | 512 | 768 |
| `sentence-transformers/paraphrase-minilm-l6-v2` | 0.005 | 512 | 384 |
| `sentence-transformers/all-minilm-l12-v2` | 0.005 | 512 | 384 |
| `baai/bge-base-en-v1.5` | 0.005 | 512 | 768 |
| `sentence-transformers/multi-qa-mpnet-base-dot-v1` | 0.005 | 512 | 768 |
| `sentence-transformers/all-mpnet-base-v2` | 0.005 | 512 | 768 |
| `sentence-transformers/all-minilm-l6-v2` | 0.005 | 512 | 384 |
| `thenlper/gte-large` | 0.010 | 512 | 1024 |
| `intfloat/e5-large-v2` | 0.010 | 512 | 1024 |
| `intfloat/multilingual-e5-large` | 0.010 | 512 | 1024 |
| `baai/bge-large-en-v1.5` | 0.010 | 512 | 1024 |
| `baai/bge-m3` | 0.010 | 8,194 | 1024 |
| `qwen/qwen3-embedding-8b` | 0.010 | 32,768 | not stated |
| `voyageai/voyage-4-lite` | 0.020 | 32,000 | 256 |
| `openai/text-embedding-3-small` | 0.020 | 8,192 | not stated |
| `qwen/qwen3-embedding-4b` | 0.020 | 32,768 | not stated |
| `perplexity/pplx-embed-v1-4b` | 0.030 | 32,000 | not stated |
| `voyageai/voyage-4` | 0.060 | 32,000 | 256 |

Two things to notice against SPECS §14's 1536-dimension column. Nothing in the cheap half of
this table emits 1536: the sub-cent routes are 384/768/1024-dimensional, 512-token-context
sentence-transformer classes. The 1536 routes are `openai/text-embedding-3-small` (0.02, native
1536) and, by Matryoshka truncation, `qwen/qwen3-embedding-{4b,8b}` (2560/4096 native, the
vendor documents any dimension from 32 up). The 2026-09-06 Finding "No local embedding model
exists that emits 1536 dimensions" was about local models; this table says the hosted cheap
tier does not either, which is one more reason the dimension is a settings value the first
index generation fixes, not a constant.

**What the cheap routes did under the real ladder.** Registered
(`packages/core/src/ai/registry.ts`): `mistralai/mistral-nemo`,
`meta-llama/llama-3.1-8b-instruct`, `qwen/qwen3-30b-a3b-instruct-2507`, each at
`structuredOutput: 'prompted'`, `source: 'probe'`, `verifiedAt: 2026-09-17`; the 70b route kept
as the upgrade and repriced. Chosen by screening the top of the table with the conformance
request itself (system "Respond only with JSON matching the provided schema", one user turn,
`maxOutputTokens: 64`) through the real `OpenRouterChatModel`. Then
`bun run -F @deep-wiki/api ai:conformance` — the real `generateStructured` ladder at the declared
rung, exit 0 on every run — three times; the CLI now reports rungs, tokens, cost at the
registry price and elapsed time (`ConformanceResult` grew those fields):

| Model (declared `prompted`) | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| `mistralai/mistral-nemo` | matched, 1 rung, 36/11 tok, 1 µ$, 2852 ms | matched, 2 rungs, 111/25 tok, 3 µ$, 4215 ms | matched, 2 rungs, 111/25 tok, 3 µ$, 3137 ms |
| `meta-llama/llama-3.1-8b-instruct` | matched, 1 rung, 48/6 tok, 3 µ$, 530 ms | matched, 1 rung, 48/10 tok, 3 µ$, 566 ms | matched, 1 rung, 47/10 tok, 3 µ$, 1127 ms |
| `qwen/qwen3-30b-a3b-instruct-2507` | matched, 1 rung, 45/14 tok, 5 µ$, 1472 ms | matched, 1 rung, 45/15 tok, 5 µ$, 1003 ms | matched, 1 rung, 45/15 tok, 5 µ$, 1840 ms |
| `meta-llama/llama-3.1-70b-instruct` | matched, 2 rungs, 129/37 tok, 66 µ$, 1460 ms | matched, 1 rung, 47/7 tok, 22 µ$, 718 ms | matched, 2 rungs, 129/21 tok, 60 µ$, 1603 ms |

"2 rungs" is the `prompted` rung's one repair pass doing its job: the first answer came back
fenced (`` ```json … ``` ``), the validator's strict `JSON.parse` refused it, the repair turn
carried the error verbatim, and the second answer was bare JSON. That is the ladder working as
designed, so it is a pass — but it is also the one measurable difference between these routes,
so it was measured on its own. First-attempt validity over twelve conformance-shaped calls
each (one screen, eight repeats, three conformance runs):

| Model | First attempt valid | Failure shape | Latency (first attempt) |
| --- | ---: | --- | --- |
| `mistralai/mistral-nemo` | 6 / 12 | `` ```json `` fence every time | 1.0–3.9 s |
| `meta-llama/llama-3.1-8b-instruct` | 11 / 12 | one `` ```json `` fence | 0.5–2.5 s |
| `qwen/qwen3-30b-a3b-instruct-2507` | 12 / 12 | — | 0.5–1.5 s (one 6.7 s outlier) |
| `meta-llama/llama-3.1-70b-instruct` | 6 / 11 | bare `` ``` `` fence | 0.6–2.8 s |

**The default is `mistralai/mistral-nemo`, and here is the arithmetic.** The owner's rule is
the cheapest route that passes conformance, and `registry.test.ts` now holds every declared
default to it mechanically: it must be a `source: 'probe'` entry and the cheapest such entry for
its provider by `computeCostMicroUsd` over a reference call. Nemo passes 3/3. Its 50 %
first-attempt rate means half its structured calls pay a repair pass — and even then a
conformance call costs 2.9 µ$ against llama-8b's 3.2 µ$ single rung, because nemo's token price
is 2.6× lower. What the default trades away is latency (3–4 s with the repair against
0.5–1.1 s), not money. If the product's structured flows turn out to be latency-bound rather
than cost-bound, `DEFAULT_MODEL_BY_PROVIDER` is one line and the test will still hold the
replacement to the cost rule — llama-8b is the next cheapest probe-verified entry.
`defaultModelFor(provider)` is the mechanism; nothing consumes it yet because no AI feature
has a settings screen (Phase 5's deferred half). The first one to ship must read it instead of
carrying its own literal.

**Screened and rejected, and why.** Every reasoning-by-default route in the cheap tier —
`inclusionai/ling-3.0-flash`, `qwen/qwen3.7-flash`, `openai/gpt-oss-20b`,
`deepseek/deepseek-v4-flash-0731`, `inception/mercury-2.5` — returned **empty text with
`finish_reason: length`**: the 64-token ceiling was spent on hidden reasoning tokens and no
answer followed. The adapter does not send `reasoning: { enabled: false }` (OpenRouter's switch)
and the conformance ceiling is the conformance, so these fail, and the ceiling was not loosened.
`google/gemma-3-{12b,27b}-it`, `mistralai/ministral-3b-2512`,
`mistralai/mistral-small-3.2-24b-instruct`, `meta-llama/llama-4-scout` and
`google/gemini-2.5-flash-lite` all answered correctly inside a `` ```json `` fence on the first
attempt — the same shape nemo's repair pass recovers from, but at a higher price than the three
that passed clean, so nothing was gained by registering them.

**The `schema` rung is real on the wire and unreachable from the runtime.** Sent by hand with
`response_format: { type: 'json_schema', strict: true, … }`, all four registered routes
returned bare, valid JSON **12 / 12** (three each) — no fence, no repair. But no adapter in
`apps/api/src/ai/gateway/providers/` reads `request.structuredOutput`: every one passes
`{ system, messages }` to `generateText` and drops the schema and the level on the floor. So
today the ladder's `schema`, `tool-call` and `prompted` rungs put **the same bytes on the
wire**, and a validation failure "at `schema`" measures nothing a failure at `prompted` would
not; the `prompted` rung's only real mechanism is the repair turn, and even the schema is
conveyed by the caller's own prompt text (`conformance.ts` spells the field name out in the user
turn). That is why these entries declare `prompted` although OpenRouter's catalogue declares
`structured_outputs` for all three: `prompted` is the rung the runtime actually exercised. It
also means `openai:gpt-4o` and `google:gemini-1.5-pro` declare a `schema` level (vendor docs)
that `ai:conformance` would "verify" without ever sending a schema. Owed, and the single biggest
cost lever this Finding found: wire `structuredOutput.level` into the adapters —
`response_format`/`providerOptions` for `schema`, a single required tool for `tool-call`, the
schema appended to the system text for `prompted` — then re-run `ai:conformance` and raise the
cheap entries to the rung they measure at. Recorded under Open Questions.

**Embeddings over OpenRouter: supported, 1536 observed.**
`AI_PROBE_OPENROUTER_KEY=… bun run -F @deep-wiki/api ai:probe` →
`openrouter embeddings — supported=true (HTTP 200 — embedding dimensions observed: 1536)`
against `openai/text-embedding-3-small`; the probe now reports the observed dimension the way
the OpenAI probe does. This closes the OpenRouter third of the 2026-09-06 "remain unverified"
Finding; OpenAI and Gemini direct remain unknown (no key in this session). OpenRouter is not yet
an `embedding_provider` — there is still no `EmbeddingModelPort` adapter for it, and the
registry's `embeddings: false` on its entries stays until one exists.

**Recorded, not synthetic.** The fixtures under
`apps/api/src/ai/gateway/providers/__fixtures__/openrouter-{mistral-nemo,llama-3.1-8b,qwen3-30b-a3b}-*`
are real responses from 2026-09-17 — `generate` ("Say hello in five words or fewer"),
`structured` (the conformance request), `error-401` (the same call with an invalid key) — with
nothing to redact in the bodies, and `openrouter-error-429-upstream.json` is a real upstream
rate limit captured by bursting a free route (`user_id` redacted); a 429 cannot be provoked on
a paid route on demand and the mapping is by status, so the one capture serves every route.
The scrubber in `fixtures.test.ts` still refuses any key-shaped string. Two things the real
bodies show that the synthetic ones did not: OpenRouter reports `usage.cost` in USD on every
response (1.47 µ$ for the hello call), which is a second source a future ledger reconciliation
can compare the registry price against; and `provider` names a different upstream host per
call (Novita, DekaLLM, CoreWeave, StreamLake, DeepInfra) — the route's behaviour is the
behaviour of whichever host OpenRouter picked, which is one more reason `verifiedAt` is a date
and not a promise.

**Nothing in `bun run test` reaches the network — confirmed and now enforced.** The CLIs are
the only network path, they read one env var each, and their tests spawn them with an
environment of exactly `PATH` and `HOME`; every probe and adapter test injects a fixture
`fetch`. Run with `AI_CONFORMANCE_OPENROUTER_KEY` and `AI_PROBE_OPENROUTER_KEY` deliberately
set to invalid values in the test process: 143/143 of the `src/ai` suites pass and the CLI tests still see "skipped"
and "unknown". The enforcement is `apps/api/testing/no-network.ts`, preloaded by
`apps/api/bunfig.toml` under `bun test`: the global `fetch` refuses any host that is not
loopback, so a test that forgets its fixture fails at the call with a message naming the fix,
rather than spending money and passing.

### 2026-09-17 — `bun run test` lost 85 suites to one race: two processes creating `deepwiki_test_template`

**What happened.** `bun run test` runs every package's suite at once (`--filter '*'`), and
`packages/db` and `apps/api` each provision the shared test template from their own process.
Both saw no `deepwiki_test_template`, both ran `CREATE DATABASE`, and the loser failed with
`duplicate key value violates unique constraint "pg_database_datname_index"` — 85 suites red
that pass alone (458/458). Behind that race stood a second one nobody had hit yet: `CREATE
DATABASE … TEMPLATE` refuses while anyone is connected to the template, and the other process
is connected to it exactly then, running the migrator.

**The fix** (`packages/db/testing/provision.ts`). Every provisioner takes a session-level
advisory lock keyed on the template's name, on the maintenance connection: exclusive to create
or migrate (`ensureTemplateDatabase`), shared to copy (`createTestDatabase`, which
`provisionTestDatabase` now goes through). A second process arriving at the same moment waits,
finds the template, runs the migrator over nothing, and copies; copies wait for a migration
and never for each other; a holder that dies releases the lock with its connection. The
migrator's connection to the template is closed before the exclusive lock is released, so a
copy that was waiting finds nobody on it.

**Proof.** `provision.concurrency.test.ts` reproduces the race in one process — three
`ensureTemplateDatabase()` calls at once against the real harness Postgres, on a template of
the test's own (`dw_test_template_race`), each followed by a copy: red with the exact
production error on the code before the lock (two of three rejected), green after; and two
`provisionTestDatabase()` calls at once, which share the per-process memo. Then `bun run test`
twice, the second after dropping `deepwiki_test_template` so db and api raced for it from
cold: 460 + 393 + 1049 green both times.

**Left as found.** `DROP DATABASE … WITH (FORCE)` on a database Postgres is still analysing
waits for that worker — measured 4 s once — which is more than `bun test`'s 5 s hook default
with several drops in a row; the new test drops inside its own body with a 120 s timeout,
not in `afterAll`. Other suites drop one database each and stay well under.

### 2026-09-17 — The node responses name their workspace; the edit route's 501st request was never `/location`, it was the core barrel in the browser (branch `fix/routes-followups`)

**What happened.** Two follow-ups from the routes batch (2026-09-16, "one more request per
node screen"). The fold is done: `GET /pages/:id`, `/pages/:id/edit-session` (and its 409
refusal), `/pages/:id/history`, `/pages/:id/diff`, `/books/:id/history` and `/books/:id/diff`
carry `workspace: { id, slug }` (`NodeWorkspaceSchema`), each node composable exposes a
`NodeLocation` (pending / located / unknown, `nodeLocationOf()`), the six screens pass it to
`AppShell`, and the shell asks `useNodeLocation` for nothing on them — the composable stays
for a screen that cannot say, the endpoint for the legacy redirect. `e2e/routes.spec.ts`
counts zero `/nodes/:id/location` requests across three node screens and a client-side hop.
`workspaceId` stays beside `workspace.id` on the four responses that had it: the presence
stream and the mention endpoints read it, and renaming their input is its own change.

**The perf premise was wrong.** `e2e/perf.spec.ts`'s "fewer than 500 requests" measured 501
on `main` and the routes batch's note blamed the location request. Measured on a throwaway
worktree at `043efdb` and on this branch after the fold: the browser's resource list is
byte-for-byte the same 501 entries (module URLs aside), and `/nodes/:id/location` is in
neither — on a full load the read layer answers it on the server, so the browser never sent
it. What the list did hold: **19 modules of `packages/core`** — `ai/{aad,budget,degrade,
embedding-configuration,embedding-registration,ids,prefix,pricing,registry}`,
`permissions/{actions,can,decide,decide-many}`, `email`, `secret`, `paths`, `result`,
`content/inline-diff`, and the barrel — because `packages/contracts/src/nodes.ts` and
`workspaces.ts` imported a hierarchy table and a slug rule through `@deep-wiki/core`'s barrel,
and the contracts barrel rides in every page's client bundle. The same shape as the
2026-09-16 "no data layer" finding for `contracts/env`, one package down. Production
tree-shakes it (`sideEffects: false`); the dev server serves it file by file, and that is what
the budget counts.

**The fix.** `@deep-wiki/core` gains two subpath exports, `./nodes/hierarchy` and
`./nodes/slug`, and the two contracts modules import through them. The edit route now loads
**482** resources, 2 of them core. Nothing else changed in what the browser runs.

**Not done.** A guard that the contracts barrel's closure never reaches `packages/core/src/
index.ts` again — `bundle-isolation.ts` follows `exports` maps already and could hold it; the
perf budget is the only assertion today. And the budget itself is a coarse count of dev-server
module requests (Nuxt's own `?macro=true` reads of every page, devtools, `main.css` twice);
its next breach will be another creeping module, and `perf-resources`-style listing is how to
find it: `performance.getEntriesByType('resource')` from the test, diffed against `main`.

### 2026-09-17 — The owner's review of v0.5.1: twelve decisions, and the first Phase 3 gate verdicts

**What happened.** The owner reviewed the shipped `v0.5.1` tag and answered twelve standing
product questions in one pass, plus the first real verdicts on the six Phase 3 owner-review
gates opened 2026-09-14. Full text of each decision lives where it now governs: Open
Questions (closed or amended, above), the Roadmap (Phase 1, 2, 3, 3.5 and 8, above), and
`docs/SPECS.md` §2 (the plans decision). This entry is the index and the parts that fit
nowhere else.

**The twelve decisions, and where each now lives:**

1. Edit mode carries no frame or border; the environment (bar, block handle, tools) signals
   it instead, in harmony with Nuxt UI. Phase 3.5, above.
2. One edit mode, Obsidian-style: a shortcut toggles live preview and raw markdown source,
   losslessly, since markdown stays the truth. Phase 3.5, above.
3. **Live input rules are missing** for `~~strikethrough~~`, `*emphasis*`, `__strong__`,
   `[text](url)` and autolinks — its own entry, immediately below.
4. Routing moves to `/w/<workspace-slug>/p/<uuid>` (option b): workspace in the URL, a
   stable id, hierarchy in the breadcrumb; old `/pages/<uuid>` routes redirect. Phase 3.5,
   above.
5. The dashboard becomes two levels: it lists shelves, and opening one shows its bookshelf,
   books as covers with a user-chosen colour and cover. Phase 3.5, above (narrows the
   existing dashboard bullet).
6. The creation dialog never asks what it already knows: location and type come from the
   row and action chosen, only the name is asked. Phase 3.5, above.
7. The condensed bar stays edit-mode-only; read mode keeps the full path and relies on the
   tree highlighting the open document. Closes the Open Question of that name, above.
8. **Book mode** (new, large): entering a book makes it the header and the scope, chapters
   and pages chained into one continuous read, AI scoped to the book, no drift until the
   person returns to the general view — "a book as a project is a unit of concentration."
   Phase 3.5, above.
9. `ConfirmDialog` always outranks every other overlay, drawer included, resolving the
   320px stacking defect recorded 2026-09-16 ("found on the way, not fixed"). Phase 3.5,
   above.
10. **Plans**: a default plan for self-registered users; the workspace owner chooses the
    workspace's plan; a workspace's limits derive from its owner. A root panel for the
    Super Root lists every workspace in the instance and manages plans. This makes the
    `capabilities`/`GET /me` signal (Open Questions) a build prerequisite, no longer a
    discretionary question. Closes the "Default plan policy" Open Question; amends the
    Phase 1 plans bullet and adds a Phase 3.5 root-panel bullet, above; `docs/SPECS.md` §2
    amended, below.
11. **Deletion**: containers must be empty to delete; the owner may force-delete by typing
    the container's name and accepting "N pages will be deleted"; comments and revisions go
    with the page, leaving a trace in the book's history ("page X deleted by Y"); trash with
    restore, 30 days, then purge. Closes the "Node deletion" Open Question, above.
12. **Team decisions register** (new): a per-workspace place where important decisions are
    abstracted and kept, fed by hand and by the AI when it detects a decision in a document;
    related to `docs/SPECS.md`'s rule packs/cells (Phase 6) without merging into that model.
    Phase 3.5, above.

Also reaffirmed, unchanged in substance: easy cross-references to another part of a
document or another page (wiki-links made clickable, plus Obsidian-style block references)
and a later graph view over that same edge set (Phase 2 and Phase 8, above); images and
diagrams staying Phase 4 (above).

**The Phase 3 gate verdicts (Findings, not decisions — the owner reviewed the shipped
surfaces, not a question put to him):** gate 10.4 (page diff) and gate 10.6 (book diff)
**not passed** — the owner wants a GitHub-style diff, word-level changes inside a block on
top of the four change classes already shipped, with a two-column before/after view offered
as an option; this supersedes the "Page diff directions (a) and (c)" Open Question, above,
which asked the owner to choose among three narrower options that are no longer the ask.
Gate 10.2 (page history) carries a reported defect, under investigation — its own entry,
below. Gates 10.8, 10.10 and 10.12 were **not evaluated**: the owner's running dev servers
predated the comments-from-read batch, so those surfaces were not the ones in front of him.
The management sidebar and the invite dialog, reviewed the same day outside the numbered
gate list, were **approved** — "settings feels like something apart." All verdicts are
recorded in full in `docs/UI-CHECKLIST.md` Review Log, 2026-09-17.

Impact: five Open Questions closed or amended, `docs/SPECS.md` §2 amended, and Phase 1,
2, 3, 3.5 and 8 of the Roadmap gain or amend bullets, all above. Two gates (10.4, 10.6)
reopen work already ticked; the other four gates' status is unchanged pending further
review.

### 2026-09-17 — Live input rules are missing for `~~strikethrough~~`, `*emphasis*`, `__strong__`, `[text](url)` and autolinks

**What happened.** `packages/markdown` parses and round-trips all five constructs — fixtures
exist for each in the GATE-2 corpus — but the editor's live typing conversion
(`packages/editor/src/mount/input-rules.ts:57-59`) only wires the input rules for `**`/`__`
(strong), `_`/`*` single-character emphasis wait state, and `` ` `` (code). Typing
`~~text~~`, a bare `*emphasis*`, `__strong__` written with underscores, `[text](url)`, or a
bare URL does not convert live the way `**bold**` already does; the construct still parses
correctly on save (round-trip is intact) because the parser is unaffected, but the person
typing gets no live feedback for five of the constructs the product actually supports.
Raised by the owner during the 2026-09-17 review (decision 3 of that entry, above); the fix
is in flight.

Impact: `packages/editor/src/mount/input-rules.ts` only — the parser and round-trip are
unaffected, so this is an editing-experience gap, not a data-integrity one.

### 2026-09-17 — Page history sometimes saves an empty entry (gate 10.2, under investigation)

**What happened.** The owner reported, during the 2026-09-17 review of `apps/web/app/pages/
pages/[id]/history.vue` (gate 10.2), that an empty history entry is sometimes saved — a
revision row with no meaningful content change. Not yet reproduced or root-caused in this
pass; recorded so the gate's block on it is not lost. Candidates to check first: whether
`savePage` inserts a `page_revision` row even when the incoming markdown hashes identical to
the current one, and whether the changeset window (`CHANGESET_WINDOW_MINUTES`) can close and
reopen around a no-op save.

Impact: gate 10.2 stays open until this is diagnosed and fixed; no code changed by this
entry.
### 2026-09-17 — "Sometimes an empty history entry is saved": a byte-identical save minted a revision, and the editor called an unchanged document dirty

**What happened.** Reproduced against the real API (`createPageRoutes` + `createDiffRoutes`
over a provisioned Postgres, a scratch script): `PUT /pages/:id` with the very bytes already
stored answered 200 and wrote a `page_revision` whose diff against its predecessor classified
every block `unchanged`. Five paths were tried — byte-identical save (**empty revision**),
whitespace-only changes (a trailing newline or a doubled blank line is refused `409 not
canonical`; a doubled space inside a paragraph is canonical and a real `modified` — not this
defect), a save after a failed stale save (fine), two quick saves inside the changeset window
(**the second, unchanged, minted an empty revision** in the same changeset), take-over then
save (**empty revision**). The history screen showed such a row like any other — author, time,
"Compare with previous" — and the link opened onto "No differences".

**Cause, two halves.** `savePage()` (`packages/db/src/content/save-page.ts`) wrote the
revision unconditionally after the `content_hash`-guarded `UPDATE`, which happily updated a
row to its own bytes. And `pages/pages/[id]/edit.vue` set `isDirty = true` on *every* editor
transaction, so a character typed and deleted, or an Undo back to the start, left Save live
and sending the stored bytes back. Neither half alone produces the row; both were there.

**Decision, from the spec's wording.** The revision-history spec pairs a revision with "the
corresponding `page_content` change" and says a save "MUST NOT commit a revision without the
corresponding `page_content` change"; its success scenario is "a page save request with
changed Markdown". A save that changes nothing has no corresponding change, so it earns no
revision — even if the owner pressed Save on purpose: a revision is a *version*, and an
identical version is not one (design.md Decision 7 rejects "revision-on-changeset-close"
because it "loses intermediate versions"; an identical snapshot is no version to lose).
`savePage()` now returns early with `unchanged: true` once the `FOR UPDATE` row already holds
the canonical text: no `page_content` update (so `updated_by`/`updated_at` keep naming the last
real edit), no revision, no changeset activity, no derived rebuild. The stale check still runs
first — an identical save against an outdated hash is a stale save, refused as before. The
route carries `unchanged` in `SavePageResponseSchema`; `useSavePage` confirms "Nothing
changed since the last save." and clears no cached reads; the edit screen's dirty flag is now
"differs from the saved text". Tests: `save-page.test.ts` (three), `pages.test.ts`,
`pages.test.ts` (contracts), `useSavePage.test.ts`, `edit.test.ts`. The chain-compression
tests in `rebuild-derived.test.ts` had used an identical re-save as their reconciliation
trigger; they save a real edit now.

**The rows already written.** Revisions are immutable, so the empty ones stay. The history
summary now carries `contentHash` (db query, `RevisionSummarySchema`, route), and
`history.vue` names a row whose hash equals its older neighbour's — "Same content as the
previous revision" — with "Compare with previous" `aria-disabled` and the reason in its
tooltip ("Nothing to compare: …"), rather than a link onto an empty diff (docs/UI-CHECKLIST.md
§3 "Disabled — explains why", §5 `aria-disabled`).

### 2026-09-17 — "A diff like GitHub's": word-level marks inside an edited block, and a side-by-side layout (owner review of gates 10.4/10.6)

Branch `feat/word-level-diff`; the Review Log entry of this date in `docs/UI-CHECKLIST.md`
carries the measurements and the screenshots.

- **Where the differ lives.** `packages/core/src/content/inline-diff.ts` — pure, zero
  imports, so `core-purity` holds: `tokenizeInline()` (words in any script, whitespace runs,
  single punctuation marks; the tokens concatenate back to the input) and `diffInline()`
  (Myers' O(ND) over the tokens, deletions before insertions within a run). The block-diff
  spec's ban on a line differ is about *classification* — it exists so "moved" survives —
  and is untouched: `diffBlocks()` still decides the four classes, and the word differ runs
  only inside a block it has already matched on both sides.
- **The whitespace fold.** Exact word LCS marks "with no edits yet" → "now with one small
  edit" as `[no→one] [edits→small] [yet→edit]` — three marks per side around three shared
  spaces, correct and unreadable. Whitespace-only equal runs between two changes are folded
  into both sides whenever the neighbours carry both a deletion and an insertion, so the
  phrase is one mark per side and neither side ever gets a mark that is only a space.
  `inline-diff.test.ts` holds the reassembly invariant on both sides.
- **The contract is extended, not replaced.** `ModifiedChangeSchema` gains `segments`
  (`InlineSegmentSchema`); `text` stays the after text; no other kind carries segments (an
  `unchanged` one that arrives with them is stripped by `z.object`). `attachBlockText()`
  diffs a modified block between its own `fromSlot` and `toSlot`, so a block that moved and
  changed is compared with itself and not with whatever now stands in its old slot
  (`attach-block-text.test.ts`).
- **One renderer for two screens.** `BookDiffBlockChanges` became `DiffBlockChanges` and the
  page diff renders it too; the page screen's full-row accent wash (the 2026-09-14 audit's
  "highlighter pass") is gone — a word mark on a `warning-container` row would have been a
  container on a container. The page-diff test that proved "moved is distinct" by background
  class now proves it by the accent border, as the book's already did. The audit's (b) —
  "the before-text under a modified block" — is closed by the marks themselves; (a) and (c)
  stay in Open Questions.
- **`tertiary-container` is `success` here.** The owner named M3's `tertiary-container` for
  insertions; this project has no `tertiary` alias (Nuxt UI's set is closed at seven), and
  `success` already names "Added" on the badge beside the mark. Recorded in
  `docs/DESIGN-SYSTEM.md` §14; the alternative is a seventh palette to author and measure.
- **The 3:1 boundary is measured, not assumed.** Each mark carries the 1px inset accent ring
  (`TONAL_BOUNDARY` by hand); `e2e/diff.spec.ts` runs `boundaryContrast()` on an `<ins>` and
  a `<del>` in both themes and prints and asserts ≥ 3:1: 6.19:1 / 7.08:1 light, 12.13:1 /
  11.46:1 dark. The audit's 1.00:1 badge is the reason.
- **`UButtonGroup` does not exist in Nuxt UI 4; the group is `UFieldGroup`.** The control's
  first cut used the old name: an unresolved tag renders its children on the client and
  nothing on the server, so the control was missing from every server-rendered screenshot
  and present after hydration — and both the component test (client-side) and the e2e's
  post-hydration clicks passed. `vue-tsc` did not flag the unknown tag either. Caught by
  looking at the screenshots; the e2e now asserts the control on the server's DOM.
- **Side by side is honoured as one column below `md`.** The grid needs two readable 14px
  columns; at 320 it has 288px. The preference survives (cookie `dw-diff-layout`, the control
  still pressed) and the segment's tooltip says so, so the control never looks inert. The
  width is read from `matchMedia` on mount with `true` as the server's assumption — a phone
  with a side-by-side cookie collapses one frame after hydration rather than mismatching it.
- **`<pre>` and a Vue template do not mix.** `DiffInlineText` is a render function: inside a
  `<pre>`, the template's own line breaks between `<ins>` and `<del>` would be preserved as
  content. Its tests read `textContent`, since test-utils' `text()` trims what a `<pre>`
  keeps.
- **`e2e/diff.spec.ts` is serial, and its first test is a click-through on a cold dev
  server.** Under a load average of 13–19 (other worktrees' suites) that test outran its 30s
  timeout in two of three runs at the on-demand compiles of `/history` and `/diff`, taking
  the thirteen tests behind it down as "did not run"; the run between passed at 26.6s. It now
  takes the same `test.setTimeout` allowance the skeleton test in the same file already
  takes for the same reason — a harness trade, not a retry into passing.
### 2026-09-17 — The creation dialog asks only what it does not know

**What was wrong.** `NavigationTreeActions.vue`'s "New item" dialog showed the Location and Type
radios even when a row's context menu had already answered both — "New page…" on a chapter
opened a dialog that asked "Location? Type?" with the answers pre-selected, and the name field,
the only real question, stood third (owner decision, 2026-09-17).

**What changed.** `openCreate(type)` now records whether the invocation *answered* the kind
(`answered`: a `type` was given and the picked row may hold it). When it did, the dialog is
titled for the thing being made ("New page", "New chapter"), leads with the name field —
focused through `UInput`'s `autofocus`, which lands after Reka's own initial focus — and states
the two answers in one line ("Page in “Onboarding”", or "Shelf at the top level") beside a
"Change…" disclosure: a text button with `aria-expanded`/`aria-controls` that reveals the same
two radio groups, pre-answered, and reads "Hide the choices" while they show. From the toolbar
the kind is only a guess (the first legal one), so the radios show as before, whether or not a
row is picked; a type the row cannot hold ("New book…" would never be offered on a chapter, but
the exposed method is callable) falls back to the asking shape. One dialog, two shapes, one
submit path (`NavigationTreeActions.test.ts`: both shapes, the disclosure both ways, the posted
body; `e2e/tree-writes.spec.ts`: the menu path against the real API, the created row, both
shapes at 1280 light, 1280 dark and 320 with `expectNoHorizontalOverflow`).

**Not changed.** The Rename dialog, which never asked anything it knew.

### 2026-09-17 — Source mode: one edit mode, two views of one buffer, and what the toggle refuses

**Shape.** `pages/[id]/edit.vue` owns `currentMarkdown` and always did; source mode
(`EditorSourceSurface.vue`, a plain `<textarea>`) is a second reader and writer of that buffer
beside `EditorSurface`. Nothing else moved: dirty state, the lock, the heartbeat, presence,
`beforeunload` and the router guard never learn which view is up, and Save reads the same
buffer from either — `flush()` closes the visual view's 300 ms window on the way out, the text
area reports every keystroke. The choice persists per browser in `dw-editor-view`
(`useEditorView`, the `dw-comments` shape). `Ctrl`/`⌘`+`E` is Obsidian's binding and was free:
not in `keymap.ts`, not in any `defineShortcuts`, and a page may claim it (Chrome reserves
`Ctrl+T/W/N`, not `Ctrl+E`).

**The decision is pure and fail-closed.** `~/utils/editor-view.ts`: visual → source is always
granted (`toMarkdown` of the live document is canonical by construction); source → visual runs
`probe()` — now exported from `@deep-wiki/editor/mount` beside the converters, same binding as
the `"."` export's — and a text that is not its own fixed point keeps the person in source with
a chip-tier notice naming the first non-canonical line **by its two spellings** (as typed,
beside what the pipeline would write), because "not canonical" alone is not something a person
can act on. Nothing they typed is rewritten; the next edit clears the notice and the next
attempt judges the new text. Save from a non-canonical source is still allowed and the server's
own 409 answers it with "Use the canonical document" — the existing exit, never a silent
rewrite. `probe()`'s `not_byte_identical` carries a line and no construct, which is why the
notice names the spelling rather than a construct; an `unsupported_construct` refusal names the
construct the probe already knows.

**The surface.** A `<textarea>`, not CodeMirror — a second editor dependency is a permanent bug
class — and not `UTextarea`: the library's text area is a form field (ring, 56px rhythm, size
variants that bundle padding and font), and this is the document, the same object as the
contenteditable beside it. Set in the code family at the reading surface's own metrics
(`font-mono text-doc-body`, 16px on 26px): §2.3's code role is 14px, but §9.5's 16px floor binds
every text-entry control and the checklist wins on correctness. Same `-m-4 p-4` reach, same
measure column, no box, the caret in `primary` as the focus indicator (`main.css` §13). It grows
with its text (`scrollHeight` after every edit; `field-sizing: content` when Firefox has it) so
the pane scrolls, not the control. `Tab` inserts two spaces where the caret is; a captured Tab
is a keyboard trap unless the way out is stated, so `Escape` leaves for the contextual bar and
the `aria-describedby` says so (WCAG 2.1.2). `Shift`+`Tab` is left to the browser.

**The bar.** A segmented control ("Visual | Source", `UFieldGroup`, `aria-pressed` plus the
opaque `secondary-container` fill the selection toolbar uses for pressed, tooltips carrying
`Ctrl`/`⌘`+`E`) from `sm` up; below `sm` one icon-only toggle, pressed while source is up —
measured at 320 with the two halves drawn, even icon-only, the right-hand group ran to 213px
and the "Editing" crumb clipped to "Editi…". Undo and Redo stand only beside the visual view:
the text area's undo is the keyboard's own, and a button running the other view's history is
§6's inert control. **Save is icon-only below `sm`** (label kept for assistive technology, the
same idiom "Read page" already uses): with the view toggle beside Undo, Redo and Save the crumb
was 17px short of whole, and of everything in that group the label on a filled, iconed
primary action was the one thing the fill and the icon already say. The owner may prefer the
crumb to give instead; it is a one-line change either way.

**Measured** in `e2e/editor-source.spec.ts` against the real backend: type in visual, `Ctrl`+`E`,
the source shows the typed text (flushed), edit in source with Tab-indented list, `Ctrl`+`E`
back, the nested item rendered, Save, reload, `Ctrl`+`E`: the bytes read back through a fresh
edit session are the bytes the source view showed. A non-canonical source (`**bold**`) stays as
typed with the notice naming the line and both spellings; written `__bold__`, the same key opens
the visual view. The cookie survives a reload. At 320 the crumb is whole in both views. Unit:
`editor-view.test.ts` (the decision), `useEditorView.test.ts` (the cookie),
`EditorSourceSurface.test.ts` (Tab, Escape, the report), `edit.test.ts` (the control, the swap,
the refusal, Save from either view).

**Future item, recorded not built.** A syntax-highlighting layer for the source view. It would
be a second rendering of markdown (CodeMirror's language mode, or an overlay) beside the one
parser, and the argument that keeps the editor on one parser applies to it; if it is ever
wanted, the highlighter must be driven by `@deep-wiki/markdown`'s own tokens.

### 2026-09-17 — The live input rules now cover what the pipeline already parses inline; GATE-2 is 182

**What was missing.** `packages/editor/src/mount/input-rules.ts` had `**x**`, `_x_` and
`` `x` `` — three of the inline constructs the schema models as marks. A person who typed
`~~gone~~`, `*em*`, `__strong__`, `[text](url)` or a bare URL saw the punctuation stay as text
until they reached for the toolbar (owner decision, 2026-09-17).

**What was added, and what each writes.** A rule accepts the spelling a person *types*; the
editor *writes* the pinned canonical one, so the saved bytes are what `canonicalise()` would have
produced for the same input: `*em*` → `_em_`, `__strong__` → `__strong__` (and `**bold**` →
`__bold__`, as before), `~~gone~~` → `~~gone~~`, `[text](url)` → `[text](url)` (`resourceLink`
is pinned, so this is canonical and re-opens as typed; no title form), and a bare
`http(s)://…` closed by a space → a link to itself, `[url](url)` — the spelling the pipeline's
autolink-literal parse canonicalises to (`pins/pin-resourceLink.md`; `<url>` is in `refused/`).
`input-rules.test.ts` holds every rule's transaction and, for all eight inline rules, the result
through `toMarkdown` → `fromMarkdown` back to an equal document. Two fixtures join the corpus:
`modelled/inline-shortcuts.md` (every spelling the rules emit, on one line) and
`refused/autolink-literal.md` (a bare URL as bytes is non-canonical and must be refused on
open, never silently rewritten). GATE-2: 177 → **182**.

**Two things found on the way.**

- **A marker beside a space is not a marker.** The pipeline reads `** bar **` as text (a
  delimiter run next to whitespace is not flanking), so a rule that marked ` bar ` would write
  `__ bar __`, read it back as text, and refuse the document on its next open. Every inline
  rule now requires its content to begin and end with a non-space; the three pre-existing rules
  had the hole too and are closed the same way (`markers padded with spaces fire nothing`).
- **A trailing `.` or `)` stays in the URL.** `https://example.com/a.` followed by a space links
  `https://example.com/a.`; GFM's autolink-literal parse trims trailing punctuation, this rule
  does not. The document stays canonical either way (the mark's text is its href), so it is a
  taste question for the owner, recorded rather than guessed.

**The bare URL's space is the typed character.** `prosemirror-inputrules` matches text-before
plus the typed text and the handler's transaction *replaces* the insertion, so the rule inserts
the space itself as an unmarked node and clears the stored mark — which is what surfaced the
missing stylesheet above.

### 2026-09-17 — prosemirror-view's stylesheet was never loaded: a trailing space beside an inline element vanished under the next keystroke

**How it surfaced.** The bare-URL input rule (below) turns `https://example.com/bare` into a link
on the space that closes it and inserts that space itself, unmarked, after the link. In the
browser the space showed after the rule ran — DOM `<a>…</a>" "` — and the next key replaced it:
`"n"` where `" n"` should have been (measured with a DOM dump per keystroke, 2026-09-17). The
unit test of the same transaction passed, so the loss was the DOM's, not the state's.

**Cause.** `apps/web` never imported `prosemirror-view/style/prosemirror.css` (nor
`prosemirror-gapcursor/style/gapcursor.css`). `.ProseMirror` therefore had `white-space:
normal`, under which a trailing space is *collapsible* — Chrome's editing rewrites the text
node around it when the next character lands — and ProseMirror itself warns about exactly this
in the console on every mount ("ProseMirror expects the CSS white-space property to be set,
preferably to 'pre-wrap'"). A space typed at the end of a longer text node had survived by
Chrome's own nbsp juggling; a space that was a text node of its own, after a link, did not. The
gap cursor — the caret ProseMirror draws between two blocks that hold no text, which
`plugins.ts` installs precisely so a document ending in a table or a code block has a keyboard
path past it — was an empty `<div>` with no rule to draw it, so it never showed.

**Fix.** `main.css` §13 now carries both stylesheets' structural rules on `.prosemirror-editor`
(`white-space: break-spaces` with the `pre-wrap` fallback, `word-wrap`, no ligatures, `li`
positioned, `hideselection`, the separator image) and the gap cursor drawn in the caret's role
(`--ui-primary`), never the packages' literals (`#8cf`, `black`) — checklist §4.2.
`e2e/editor-source.spec.ts` measures the computed `white-space` on the focused editor.

**Not done.** The two package stylesheets are not imported as files: `main.css` is the one
stylesheet and Tailwind's `@import` of a package CSS would carry the colour literals with it.
If prosemirror-view adds a structural rule in a future release it has to be copied here; the
console warning is the tripwire.

### 2026-09-17 — The "border" around the document in edit mode was the focus indicator, and the caret is where it belongs

**What the owner saw.** A rounded box hugging the content in `/pages/:id/edit`, fighting the
`⋮⋮` block handle in the margin (the 2026-09-17 review). The box was not a border: nothing in
`EditorSurface` drew one. It was `main.css` §9's global focus indicator — 3px `secondary` at 2px
offset — landing on the editor's contenteditable and following its `rounded-lg`. A browser treats
a text-entry element as `:focus-visible` on *any* focus, pointer included, so the ring stood the
whole time the caret was in the document, which in edit mode is always. Confirmed against the
2026-09-16 screenshots: `fb-editor-ui-surface-1280-light.png` (editor unfocused) has no box;
`fb-editor-ui-toolbar-1280-light.png` (a selection inside it) has the box.

**Why the ring is wrong here and not elsewhere.** The indicator's job is to say which control
holds focus. A document is not a control among controls: it is the whole pane, and the person
knows they are in it because they are typing. WCAG 2.4.7 counts the text cursor as the focus
indicator of a text field; M3's text field draws its caret in `primary`
(`md.comp.outlined-text-field.caret.color`). So the indicator moved, the way it moved from the
tree's `treeitem` to its row on 2026-09-07 — relocated, never removed (checklist §5 is
pass/fail on this): `.prosemirror-editor { caret-color: var(--ui-primary) }` and
`.prosemirror-editor:focus-visible { outline: none }`, `main.css` §13. The surface's
`rounded-lg` went with it — nothing is drawn, so nothing is rounded; `-m-4 p-4` stays, because
it is the reach that puts a click just beside the first character into the document and starts
the block handle's hover band before the text does. The measure column, the heading and the
read/edit alignment are untouched (`e2e/editor.spec.ts` still holds the title and the first
paragraph to the pixel across the two modes; `e2e/editor-source.spec.ts` measures the computed
outline, radius and caret colour in both themes).

**Where it is recorded.** `docs/DESIGN-SYSTEM.md` §14 (the deviation from §5.1's uniform ring),
`docs/UI-CHECKLIST.md` Review Log, 2026-09-17.
### 2026-09-16 — Workspace-scoped addresses (`/w/<slug>/p/<id>`), the old shapes redirected, and the confirm dialog above the drawer (branch `feat/workspace-routes`)

**The decision (owner, 2026-09-17, option b).** A page lives at `/w/<workspace-slug>/p/<uuid>`:
the workspace's slug in the address, the node's id stable underneath, the hierarchy left to the
breadcrumb. The whole family moved: `/w/<slug>` (dashboard), `/w/<slug>/p/<id>[/edit|/history|
/diff]`, `/w/<slug>/b/<id>/history|diff`, `/w/<slug>/members|settings|ai`. `/workspaces`,
`/workspaces/new`, `/admin/*`, `/account` and the sign-in family stay. Four commits on the
branch: the API's two additions, the web move with its docs, the e2e migration with the two
`AppShell` fixes the run found, and the stacking ruling; `docs/RUNNING.md` §2 is the route table.

**What was built, and the reasoning that is not obvious from the diff.**

- **One helper spells every route** — `apps/web/app/utils/routes.ts` — and `routes.test.ts`
  walks `apps/web/app` for a route-shaped string outside it (API paths exempt: `api(…)`,
  `$fetch(…)`, `apiBaseUrl`) and fails on any. Nineteen files spelled `/pages/<id>` by hand
  before it. Dependency-free, so the e2e suite drives the same addresses through the same
  functions.
- **A workspace is two names.** `useCurrentWorkspace` holds `{ id, slug }` and the
  `dw-workspace` cookie carries `<id>:<slug>` (`utils/workspace-cookie.ts`, shared with e2e), because
  `/` builds `/w/<slug>` on the server from the cookie alone while the sidebar fetches the tree
  by id. **A cookie from before this change (id alone) remembers nothing** — `/` goes to the
  chooser once, and the next workspace opened writes the pair. Recorded, not migrated: a
  one-time click.
- **The API takes a slug where a screen has one.** `GET /workspaces/:ref/activity` and
  `/members` accept the slug as well as the id (`apps/api/src/routes/workspace-ref.ts`; the slug
  is tried first, so a uuid-shaped slug is still found as a slug), and the activity response
  names the workspace by slug beside id and name. So the dashboard and members keep their
  server render with no resolver round trip in front of them. The tree and the presence stream
  stay by id — the sidebar always has one.
- **The old shapes redirect, from the server, permanently.** They are real routes
  (`nuxt.config.ts`, `pages:extend`, one placeholder component `LegacyRedirect.vue`) behind
  `middleware/legacy-routes.ts`: `GET /nodes/:id/location` (new; a node the caller may not read
  is the same 404 as one that does not exist — a redirect resolver has no caller to be honest
  with, and a 403 would confirm ids) or the caller's `GET /workspaces` says where the thing
  lives, and the answer is a `301` with the query kept. Signed out: sign-in first, the old
  address as the return. On a deployment where the API's cookie never reaches the Nuxt server,
  the server renders the placeholder and the browser resolves on hydration.
  `e2e/legacy-routes.spec.ts` proves each shape's 301 and that denial and absence land on the
  same not-found screen at the old address.
- **The address is held to its word, in one place.** `AppShell` asks `useNodeLocation` beside a
  node screen's own read (parallel, in the read layer, cached across screens; one extra ~100-byte
  request per node screen — see below). A located node whose workspace slug is not the
  address's is **not found**: the notice in place of the screen, its `header-end` actions
  withheld, the frame standing on the workspace the address named (or the remembered one) with
  no row marked, and no `enter`. A node the API refuses to locate is left to the screen's own
  answer, which for a direct request tells denial from absence on purpose (`usePageRead`).
  Considered and rejected: folding the check into the tree (a stale tree says "not here" for a
  page created a minute ago), a route middleware in front of every node screen (a serial request
  before the screen's own), and `workspaceSlug` in all six node responses (four API routes and
  two composables another branch owns).

**Found on the way, fixed.**

- `enter` during the server render wrote the address's word into the cookie before the location
  that might dispute it had answered (watchers with `immediate` run at setup, before
  `onServerPrefetch`). Entering now waits for the location to settle — which on the server means
  never; the browser enters on hydration.
- A management screen the API refused — the reader on `/w/<slug>/members` — stood in no room:
  its response names no workspace. The address's workspace is entered when the directory
  confirms it is one the caller can open (`AppShell.test.ts` holds both).
- `e2e/read.spec.ts` clicked `getByRole('link', { name: 'Read page' })`, which since the tree's
  rows became links matches "E2E Read Page" in the tree and the breadcrumb as well
  (case-insensitive substring); `exact: true`. `e2e/book-history.spec.ts` had the same
  ambiguity with the page-switcher link; scoped to the bar.

**Seen on the way, not fixed.**

- **The dashboard's panels lose their accessible names in a production build — and they do on
  `main` too.** `getByRole('region', { name: 'Recent changes' })` finds nothing after hydration:
  the `<section aria-labelledby>` keeps the server's `useId()` (`v-0-6-1`) while its `<h2 id>`
  is re-rendered with the client's (`v-0-0-1`), so the pair no longer matches. Two SSR requests
  in a row answered `v-0-5-*` and `v-0-6-*` for the same page — the server's async-boundary
  count is not stable across requests — and the hydrated `h2` sits under boundary `0-`.
  Measured on this branch's build **and on a build of `2128ebe` (v0.5.1) served on the same
  port**, identical; so it is not this batch's. `e2e/frame.spec.ts` "the dashboard stands
  beside a 280px sidebar…" and `e2e/data-layer.spec.ts` "back to the dashboard…" fail against a
  production build for this reason (they pass against the dev server, which is what
  `bun run e2e` starts). The 2026-09-16 `useSidebarWorkspace` fix closed the sidebar's half of
  this; the panels' half is open. Worth a `useId`-free labelling (`aria-label` from the title)
  on `DashboardPanel`, which needs no id at all.
- `e2e/perf.spec.ts` matches the dev server's module URLs (`packages/editor/src/mount/index.ts`);
  against a production build those chunks are hashed and "the editor chunk is requested while
  the edit-session request is still in flight" fails by construction. Dev-only by nature; not a
  regression.
- **One more request per node screen.** `GET /nodes/:id/location` runs beside the page read on
  every read, edit, history and diff view (cached across hops; server-side on a full load).
  Folding `workspaceSlug` into the six node responses would remove it; deferred because two of
  those composables and the diff API route are another branch's this week.
  **Closed 2026-09-17** (`fix/routes-followups`): the fold is done — see the Finding of that
  date; it was not, as this note assumed, the edit route's 501st request.
- The placeholder screen the old address shows when the server cannot resolve it is rendered in
  the document frame — the workspace is exactly what is not yet known — and is never seen in
  development or e2e (the cookie is forwarded and the server answers the 301).
- The host ran at load average 18–21 throughout (three other worktrees running e2e). `bun run
  e2e`'s dev `webServer` timed out twice inside its 120 s start; every e2e result below is
  against a production build of this branch served on the harness's web port
  (`bun run -F @deep-wiki/web build`, `node apps/web/.output/server/index.mjs` with
  `PORT` and `NUXT_PUBLIC_API_BASE_URL`, `bunx playwright test` directly with
  `reuseExistingServer`) — the documented workaround, not the command.

### 2026-09-16 — `e2e/editor.spec.ts`'s "flake" was one race, and it is the harness's: a key sent within the frame after a click is handled at the caret ProseMirror still holds

**What happened.** The v0.5.0 verification saw `:754` (`/table`) time out waiting for "Saved"
and, rerun alone with `--workers 1`, `:347` produce `"SecondStart."` in the new heading. Both
sit on the slash-menu path `feat/editor-block-ui` and `feat/editor-block-commands` touched, so
the suspects were a click running a command against a stale `view.state`, a debounce/`flush`
race, or the host's capture-phase Enter handler swallowing a key. Measured first, on
`fix/editor-flake-and-heal` (worktree `fb-fix3`), then read.

**Measured.** `bun run e2e -- e2e/editor.spec.ts --repeat-each 5 --workers 1` on the idle
machine: `:347` failed 4 of 5 repeats with `"SecondStart."`, and in the one repeat it passed,
`:754` failed instead — the spec is `serial`, so each failure skipped the rest of that repeat
(33 passed, 5 failed, 106 skipped). `:754`'s error-context snapshot shows the editor holding an
*empty paragraph, then the table, then `Before the table.`* and Save refused as "not canonical"
— the table was inserted above the text, not below it. Both failures are one shape: `Enter`
after `editor.click()` + `End` split the paragraph at its START, so `/` was typed at the start
and the block command ran on the paragraph holding the original text — `"Second"` typed at the
start of `Start.` in one case, a table above `Before the table.` in the other. A throwaway spec
doing only click, `End`, `Enter` on `Start.` split at the start in **15 of 20** unthrottled runs
and **0 of 20** under six-times CPU throttling. A page-side event log on the failing runs shows
why, byte for byte:

    mousedown, setTimeout(20) [ProseMirror's focus timer], focusin, mouseup,
    keydown End, keyup End, keydown Enter, keyup Enter,
    selectionchange anchor=#text:0            ← the first one, after Enter, at offset 0

and on the passing runs `selectionchange anchor=#text:6` lands ~14 ms after `mouseup`, before
`End`. Chrome delivers `selectionchange` at the next rendering opportunity; ProseMirror reads
the browser's caret only from that event (`prosemirror-view`'s `DOMObserver.onSelectionChange`
→ `flush()`; its `keydown` handler's `forceFlush()` flushes only a flush that was already
scheduled). Playwright's `mouseup`, `End` and `Enter` arrive ~1 ms apart — inside one frame —
so ProseMirror handles `Enter` with the selection it had at mount, the start of the document,
then writes that selection to the DOM, which is the `#text:0` above. Throttling stretches the
frame past the next key, hence 0 of 20. No hand is that fast. None of the suspects was it:
`confirmSlashAt` reads `slashState`, which the plugin view's `update` sets synchronously with
`view.state`; `flush()` is called before Save; the capture handler returns before touching an
event with no menu open. Not a stale-state dispatch in this code — a synthetic key inside the
frame ProseMirror needs.

**What changed.** `EditorSurface.vue` exposes `data-transactions` on the editor root: the count
the view reports after every transaction (`EditorUpdate.transactionCount`), the pointer's
selection-only one included. `e2e/editor.spec.ts` replaces every `editor.click()` + `End` with
`caretToEnd(editor)`: click just inside the last block's right edge — where `End` was taking the
caret — then wait for `data-transactions` to move past its value before the click. That is
ProseMirror saying it has read the caret; no timeout, and no longer wait papering over anything.
The same throwaway spec with that sequence: 0 of 20 at both throttles. `EditorSurface.test.ts`
proves the attribute follows every reported transaction.

**After.** `bun run e2e -- e2e/editor.spec.ts --repeat-each 5 --workers 1`, same idle machine:
130 passed, 0 failed, 0 skipped in 10.6 minutes — every test, all five repeats — against
33 passed, 5 failed, 106 skipped before. `--repeat-each 3`: see the verification line in the
commit.

**Not fixed here.** `bun run e2e -- e2e/editor.spec.ts --repeat-each 3` (parallel workers, the
default): 75 passed, 1 failed, 2 did not run on the first invocation; 78 passed on the second.
The one failure is unrelated to the caret: `:1203` ("the drawer's toolbar row fills its width",
320x900) measured `Rename…` 17.17 px off the row's edge *after* its own `expect.poll` had just
seen the difference at ≤ 1 — the poll accepts a single settled-looking sample mid-animation and
the next measurement disagrees. A poll that requires two consecutive samples with the same row
width would close it; left as found, it is not on this branch's path. `e2e/comments.spec.ts:332`
presses `End` on a focused gutter control, not in the editor — a different `End`, no race. The 20 ms focus timer ProseMirror schedules
(`handlers.focus`: push its selection to the DOM if the two disagree) never fired first in any
logged run, but it is the other half of the same frame arithmetic and would produce the same
outcome by a different route; `caretToEnd` covers both because it waits for the transaction
rather than for either event.

### 2026-09-16 — The self-healing provisioning did not heal because the cause was this process's `PATH`: `bun run` puts `@vercel/nft`'s `nft` in front of nftables' and netavark ran the wrong one

**What happened.** The very next full verification after `2d10af6` ("start a container compose
left in `Created`") hit the same `podman compose exited with code 125`, the same containers in
`Created`, and needed the same manual `podman compose up -d --wait` — the mechanism had been
proven against injected fakes and never against the failure. Investigated on
`fix/editor-flake-and-heal` (worktree `fb-fix3`) by reproducing the real path, not by reading
the fakes.

**What was actually wrong.** Not load, not a transient runtime hiccup, and not the label
filter (podman-compose 1.6.0 stamps both `com.docker.compose.project` and
`io.podman.compose.project`, verified with `podman inspect`). A shim `podman` script on `PATH`
that logged every invocation's argv, exit code and stderr showed compose's own `podman start`
and the heal's `podman start` failing identically within a second of each other, each with the
message both provisioners had been discarding through `stderr: 'ignore'`:

    Error: unable to start container "…": netavark: nftables error: got invalid json:
    EOF while parsing a value at line 1 column 0

`bun run <script>` prepends `node_modules/.bin` to `PATH` for the script and every child it
spawns. Nuxt → nitropack → `@vercel/nft@1.11.0` installs a binary named `nft` there
(`node_modules/.bin/nft -> ../@vercel/nft/out/cli.js`, present since `e068da6`, 2026-09-03).
Rootless podman hands network setup to netavark (1.17.2, nftables driver, Fedora 44), which runs
`nft` by name through that `PATH` — and got Vercel's Node File Trace CLI, which prints
`Error: File …/list does not exist` on stderr and exits 0 with nothing on stdout; netavark
parses the empty stdout as JSON and reports exactly the error above. So `podman start` fails
from any process `bun run` started — `bun run -F @deep-wiki/db test`, `bun run e2e` →
`e2e/seed.bun.ts`, and the "heal" itself, which ran with the same `PATH` — and succeeds from a
shell, whose `PATH` has no `node_modules/.bin`. That is the whole of "running the printed
command by hand started it in three seconds". It only ever showed on a fresh worktree or after
a reboot because a stack that is already up is never started; the main checkout's containers
had been up for days. Reproduced deterministically with `CHANGESET_WINDOW_MINUTES=30 bun run
e2e/seed.bun.ts` alone on a torn-down stack, 3/3; not reproduced by CPU load (eight busy loops),
by a cold `nuxt dev` compile beside it, or by `Bun.spawn`'s `stdout`/`stderr` mode. The
2026-09-16 entry below that blamed "the race between `packages/db` and `apps/api` both running
`podman compose up`" was this same failure, misread for lack of the message.

**What changed.** `packages/db/testing/containers.ts` gains `containerRuntimeEnv()`: the
environment with every `node_modules/.bin` segment removed from `PATH`, everything else
untouched; every spawn of the runtime in both provisioners — compose, `ps`, `start` — goes out
with it (`composeProcessEnv()` in `provision.ts` and `services.ts`). Compose's stderr is
captured (tail-bounded to 2000 characters) and raised with the failure under "`podman compose
said:`"; `startContainers` returns `{ started: false, reason }` carrying the runtime's stderr
instead of a bare `false`, and `restartStalledStack` returns `{ healed: false, reason }` which
the thrown error ends with ("The one retry did not help: …"). The one retry stays, for the case
it is honestly good for (compose killed at the bound with the container already created), and
its comments no longer claim the cause was load. `createProvisionDeps({ identity, env })`
builds the real dependencies for any worktree identity; `defaultProvisionDeps` is that for the
running one. The injected tests are kept and extended (stderr in the error, the retry's reason
in the error, `composeProcessEnv` strips `.bin` and carries the compose variables), and one
integration test, `packages/db/testing/provision.integration.test.ts`, runs only with `podman`
on `PATH` (skipped loudly otherwise): it plants its own `node_modules/.bin/nft` that exits 0
saying nothing, puts it first on `PATH` exactly as `bun run` would, leaves a throwaway compose
project's postgres in `Created` with `podman compose up -d --no-start`, and drives the real
`resolveAdminUrl` through real compose, real `ps`, real `start` and the real probe to a running
server on its own free port, tearing the stack down after itself. Red with the old spawn
(`netavark: nftables error: got invalid json`, 31 s), green with the fix (6.6 s). The first
`bun run -F @deep-wiki/db test` on this worktree provisioned its own postgres from nothing,
which no `bun run` had managed on this host before.

**Not fixed here.** `worktree.ts`'s `listPortOwners` still spawns `podman ps` with the raw
`PATH` — `ps` never reaches netavark, so it does not matter, and `worktree.ts` is kept free of
imports for Playwright's Node process. The `-1` that `podman wait --condition=healthy` prints
on stdout for a healthy container (seen in every successful compose run) is podman-compose's,
not ours, and is why compose's exit code was already distrusted in `services.ts`.

### 2026-09-16 — Three e2e failures left on `main` after the regression batch: a stale smoke test, a drag the focus handoff killed, and a compose stack that stayed `Created`

**What happened.** `main` at `d6dcb8a` still failed two e2e specs alone, and the harness that
provisions the e2e's own containers failed a third way under load — three verifiers that day
ran the printed manual command by hand. Fixed on `fix/final-e2e-regressions` (worktree
`fb-fix2`), one commit each, the failing e2e as the red and a unit test where the cause lives.
Screenshots `fb-fix2-front-door-{1280-light,1280-dark,320-light}.png` and
`fb-fix2-tree-after-drag-{1280-light,1280-dark,320-light}.png` in the session scratchpad,
`expectNoHorizontalOverflow` measured on each.

1. **`e2e/smoke.spec.ts`: `getByRole('banner')` timed out.** The test was written for a `/`
   that landed a stranger on the workspace list inside the app chrome. Since the owner's
   2026-09-16 review (`feat/frame-review-shell`) a signed-out `/` goes `/workspaces` →
   `/login?next=/workspaces`, and `AuthShell` deliberately renders no `banner`, no
   `contentinfo`, no `navigation` — a person who has not signed in is not inside the product
   (the shell's own comment; `docs/DESIGN-SYSTEM.md` §14, 2026-09-15). The test was stale, not
   the screen, so the screen was not changed to satisfy it. Rewritten to prove what a boot is
   now: the redirect chain lands on the sign-in `h1` in the one `main`, **with none of the app
   chrome** (the old landmark assertions inverted to `toHaveCount(0)` — an app bar on the
   sign-in screen would be the chrome leaking onto a stranger's screen), and the theme toggle
   changes what is painted, measured on two real properties: the app ground (`body`,
   `docs/DESIGN-SYSTEM.md` §8.3) and the one Filled button (`primary` is tone 40 light / 70
   dark), so both tone tables are proven loaded rather than one plus a class flip. A second
   test lands the same screen at 320 and measures no sideways overflow — the smoke never had a
   phone-width check.

2. **`e2e/tree-writes.spec.ts`: the dragged row never moved (order still `Page One, Page Two`
   while the `PATCH` was held).** The spec was 6/6 on `fix/frame-followups`; on `main` it failed
   on the first drag. Bisected by hand: the only tree change in the range is `ba82a37`, the
   regression batch's own fix 2, which handed focus arriving on a page row's link to the
   `treeitem` from the link's `focus` event (`onLinkFocus`). **Chromium cancels the native drag
   of a link whose mousedown moves focus elsewhere.** Reproduced in isolation with Playwright on
   a bare page (an `<a tabindex="-1">` inside a `draggable` row, a focus handler that calls
   `li.focus()`): with the handoff no `dragstart` fires and no drop lands; without it the same
   drag lands `drop-data:row2`; deferring the handoff to a microtask changes nothing; deferring
   it to `setTimeout(0)` or `requestAnimationFrame` lets the drag start; `preventDefault()` on
   the link's mousedown also kills the drag. So the move is fine — the *moment* was wrong: a
   focus change inside the mousedown's own focus step is what Chromium reads as "this press is
   not a drag". The drop path (`NavigationTree.onDrop`, the below-self normalisation, the drawn
   slot) was never involved; the pointer's drag never started. Fixed in `NavigationTreeNode.vue`:
   the handoff moved from the link's `focus` to the **click, in the capture phase** (a drag
   never produces a click) and to **`dragend`** (so a drag from the link also leaves the tree's
   tab stop where focus is). The `activate` emit on a link click now comes from the item's own
   `focus` handler, once. Capture and not bubble, found by the second attempt: the row's
   bubbling `click` ran with focus already inside "Leave without saving?" — a *native* click
   runs the microtask queue between its listeners, so by the time the row's handler ran, the
   link's `router.push` had run `onBeforeRouteLeave`, `confirm()` had set the pending question,
   Vue had flushed, the dialog had recorded `document.activeElement` (the link) as the control
   that asked, and its focus trap pulled the row's late `focus()` straight back (traced with
   capture-phase `focusin`/`focusout` listeners and a console probe: `focusItem` saw the dialog's
   button as the active element). A synthetic `.click()` runs no microtasks between listeners,
   which is why the bubbling version's unit test passed while `e2e/editor.spec.ts`'s Cancel
   test failed `toBeFocused()` with `inactive`. The unit test now records `document.activeElement`
   from a listener on the link itself and expects the row. Unit tests on the node: focus
   arriving on the link stays on the link; a click puts focus on the row before the link's own
   handler runs; a drag's end hands it to the row. The e2e review material now asserts the
   dragged row's `treeitem` is focused after a refused drag. The 2026-09-16 "Integration
   regressions" entry's fix 2 above still holds — the dialog still finds the row — by a
   different route.

3. **`packages/db/testing/provision.ts` and `apps/api/testing/services.ts`: `podman compose up
   -d --wait` exits 125 (or is killed at the 90 s bound) leaving the container in `Created`, and
   every later attempt fails fast.** Reproduced on this worktree's first run: the api stack's
   two containers `Created` after the 90 s timeout, then the db stack's postgres `Created` with
   exit 125 in seconds; running the printed command by hand started each in 3–4 s and reported
   it healthy, and a fresh project name on an idle host came up first try. `podman-compose`
   1.6.0 creates the container and then starts it; under load the start step fails or is cut
   off, and the deterministic per-worktree project name means the next `up` meets the same
   created-but-not-running container and fails the same way. What the human does — start the
   container that is already there — the harness now does itself, once, logged:
   `packages/db/testing/containers.ts` (Node APIs only, exported as
   `@deep-wiki/db/testing/containers`) lists the project's containers by the compose label
   (`podman ps -a --filter label=com.docker.compose.project=<name>`), `start`s the ones in
   `created`/`exited`/`stopped`, and polls the caller's own reachability probe up to the same
   timeout; a running-but-not-yet-healthy container is waited for, not restarted; nothing left
   behind, a refused `start`, or a container that never answers still throws the original
   failure with the exact manual command. Both provisioning modules take the retry through
   injected deps (`ResolveAdminUrlDeps` gains `projectContainers`/`startContainers`/`log`;
   `ensureTestServices` gains an injectable `EnsureTestServicesDeps`, which it never had), so
   `provision.test.ts`, the new `services.test.ts` and `containers.test.ts` cover healthy first
   try (the runtime is never asked what it left behind), `Created` → started → healthy, running
   → waited for, and genuine failure. The happy path is unchanged and never runs `podman ps`.
   `scripts/checks/compose.ts` untouched and green.

**Found on the way, not fixed.** The Chromium behaviour in 2 is undocumented as far as the
tree's comments can cite: it is stated from measurement (the bare-page reproduction), not from
a spec. The microtask-between-listeners behaviour, by contrast, is the HTML spec's ("clean up
after running script" runs a microtask checkpoint whenever the script stack empties, which it
does between the listeners of a browser-dispatched event and not between those of a synthetic
one) — worth knowing for any handler that races a navigation guard: a unit test with
`dispatchEvent` cannot see the race. After a drag from the link the `treeitem` is focused but Chrome draws no
`:focus-visible` ring for a script focus that follows a pointer — the same as after Cancel in
the previous entry. And the *cause* of the 125 under load is still unobserved: compose's
stderr is discarded by the harness (`stderr: 'ignore'`), so what podman said when it refused to
start the container is not recorded; the retry heals the symptom.

**Stages** (each its own process, the host otherwise idle): `bun run check` 11/11 ok;
`bun run typecheck` 0 errors in every member; `bun run lint` clean; `bun run -F @deep-wiki/db
test` 444 pass / 0 fail across 50 files (the real provisioning path, against this worktree's
own Postgres); `bun run -F @deep-wiki/web test` 105 files / 952 tests passed; `bun run e2e --
e2e/smoke.spec.ts e2e/tree-writes.spec.ts e2e/tree.spec.ts e2e/navigation.spec.ts
e2e/editor.spec.ts` 52 passed, 1 failed, 2 did not run — the failure
`e2e/editor.spec.ts:1180` ("the drawer's toolbar row fills its width", 320): its poll saw
`Rename…` end at the row's edge and the measurement taken right after read 9.7px short, so
the drawer's row changed width once more after the poll settled (the previous batch's
`a979038` polled for exactly this and the window is wider than one settle); the two that did
not run are that serial group's last two (the confirm dialog at 1280 dark and 320 light).
`bun run e2e -- e2e/editor.spec.ts` alone straight after: 26/26 passed, those three included.
The drawer test is a pre-existing flake unrelated to these three items and is recorded here,
not retried into passing inside the run.

### 2026-09-16 — Integration regressions after the eight merges

**What happened.** `main` at `cc88265` (`v0.5.0-rc.8`) merged eight branches in one day. Each
had run its own e2e green; the full suite on `main` left four failures that reproduced alone,
twice, with `--workers 1`. Every one was two branches, each right on its own, wrong together.
Fixed on `fix/integration-regressions` (worktree `fb-fix1`), one commit each, each with the
failing e2e as the red and a unit test where the cause lives. Screenshots
`fb-fix1-{tree-menu,tree-book-menu,edit-confirm,edit-confirm-returned,selection,management}-{1280-light,1280-dark,320-light}.png`
in the session scratchpad, `expectNoHorizontalOverflow` measured on each.

1. **`e2e/book-history.spec.ts`: `menuitem "Book history"` never found.** The dashboard batch
   (`937cca3`) had given a book row a per-row `⋯` menu with one item, "Book history", and the
   spec reached the history screen through it. `feat/tree-context-menu-filter` replaced that
   menu with the row's context menu, whose `treeRowActions` labelled the item "History" on a
   page and on a book alike, and its own tests asked for `/^History/`. Decided with
   `docs/UI-CHECKLIST.md` §5: a screen-reader user hears the menu item, not the row it hangs
   off, so the name has to say what it is the history of on its own — **"Page history" /
   "Book history"**, visible label and accessible name the same words (§4.3). The menu changed,
   not the test (`6331e2d`). Behind that failure the same spec hid a second one: its
   page-switcher locator matched links by name alone, and since `fix/frame-followups` every
   page row in the tree is a link named for its page, so it resolved to three elements; scoped
   to the contextual bar.

2. **`e2e/editor.spec.ts`: after Cancel on "Leave without saving?", `expect(otherRow).toBeFocused()`
   got `inactive`.** `feat/frame-review-shell`'s `ConfirmDialog` returns focus to the element
   that held it when `confirm()` ran — `document.activeElement`, read in a `watch` on the
   pending question — because a promise-opened dialog has no Reka trigger. `fix/frame-followups`
   made a page row's title a `NuxtLink` with `tabindex="-1"`. A mouse click focuses the element
   under the pointer, `tabindex` or not, so the element that held focus was the `<a>` inside the
   `treeitem`, and focus came back to a link the keyboard cannot reach while the tree's one tab
   stop (the `treeitem`) was no longer where focus was. Fixed where the cause is
   (`NavigationTreeNode.vue`, `ba82a37`): focus arriving on the link is handed straight to the
   `treeitem` (`onLinkFocus`), so a click leaves the tree in the state the ARIA tree pattern
   describes and the dialog finds the row; the click still runs on the link, which is what
   navigates; the `⋯` button is not a link and keeps its own focus. Unit test on the node holds
   it; `ConfirmDialog`'s own return-focus test already held and was not the defect.

3. **`e2e/management.spec.ts` at 320: "Open sidebar" opened no `dialog`.** The spec clicked the
   toggle once the reader's denied state was on screen, reasoning that the denied state was the
   client's answer and so proved the page hydrated. `perf/data-layer-icons-bundle` put the
   members listing on the read layer — denied state included, server-rendered — so the wait
   proved nothing and the click landed on a button whose listener did not exist yet. Measured by
   hand: with a real wait the drawer opens on members, on settings and on the dashboard, in
   management mode and in tree mode. `fix/frame-followups` had met the same shape on three
   other screens and answered with `e2e/hydration.ts`'s `waitForHydration` — but that helper's
   signal, `__vue_app__` on the root, is set when the app **mounts**, and Nuxt hydrates a screen
   with asynchronous setup only when its `<Suspense>` resolves, a frame to a second later; the
   toggle is inert in exactly that window. The helper now also waits for Nuxt's own
   `isHydrating` to turn `false` (the flag it clears as `app:suspense:resolve` fires), and the
   management spec uses it (`e955685`). The product's half is pinned in `WorkspaceSidebar`'s unit
   suite: in management mode the drawer holds the management doors and no tree, and closes on
   the same toggle. Writing that test found the suite never unmounted its panes, so every
   earlier pane still answered the group's toggle hook and opened a drawer of its own — torn
   down after each test now.

4. **`e2e/comments.spec.ts`: the floating "Comment" never appeared for a selection.** The spec
   selected words as soon as the heading was visible. Since the read layer the article is
   server-rendered, so that was before hydration — and hydration re-sets the article's `v-html`
   (Vue patches a **dynamic** `innerHTML` while hydrating: `hydrateElement` runs `patchProp` for
   every key in `dynamicProps`), replacing the text nodes the selection was anchored in. The
   browser collapses such a selection (`rangeCount 1, collapsed true`, anchored on the wrapper
   `div` after hydration — measured), and no listener, on the article or on `document`, can bring
   it back; the listener was on `document` all along. Measured by hand with Playwright: after
   hydration a programmatic `Range` and a pointer drag both fire `selectionchange` on `document`
   and both show the action; before hydration neither survives. So it was neither the synthetic
   selection nor the listener's target: the spec now waits for the hydrated app and for the "+"
   that says the caller may comment, then selects (`b157cd3`); the `Range` is kept because it
   names the phrase, and the read screen's unit suite pins that `document` is what it listens to.
   The neighbouring window was real and is closed in the product: the threads response, which
   carries `canComment`, arrives after hydration, and a selection made in between got no
   affordance because the browser fires `selectionchange` when the selection changes, not when
   the screen becomes able to act on it. The screen now reads the selection it already holds on
   mount and when `canStart` turns true; a unit test states it. A selection made *during*
   hydration stays lost — Vue's `v-html` contract, a window of one frame to a second, recorded
   here rather than worked around.

**The general lesson.** Each branch was green alone and `main` was red. A per-branch run
proves the branch against the base it was cut from; the base moved eight times that day. Two
of the four were the read layer moving a screen's content into the server's HTML, which turned
every "the content is on screen, so the page is hydrated" wait in the other branches' specs
into a wait for nothing; one was a link arriving under a dialog that reads focus; one was a
label renamed on a branch whose own tests followed while another spec did not. **The full e2e
on `main` is the gate, not the per-branch runs** — it is what `bun run verify` runs, and it is
the only run that sees two branches at once. Corollaries: an e2e that proxies hydration by
content is wrong the day that content is server-rendered (use `waitForHydration`, which now
waits for the suspense, not the mount); and a locator by name alone breaks the day another
screen names the same thing (scope it to the region).

**Found on the way, not fixed.** At 320, a click on a tree row *in the drawer* while the editor
is dirty opens "Leave without saving?" **behind the drawer**: both are Reka dialogs at
`z-index: auto`, the drawer's portal is appended after the confirm dialog's (mounted once in
`app.vue`), so DOM order puts the drawer on top and `document.elementFromPoint` at the Cancel
button's centre returns the drawer (measured). Escape still answers the dialog; a pointer
cannot. Not one of the four (it predates today's merges — the shell batch's own 320
screenshot was taken, not clicked), and it is a stacking ruling between two overlays, so it is
recorded rather than improvised: either the drawer closes before the guard asks, or the
confirm dialog outranks every other overlay. Also: after Cancel, focus is on the row (the e2e
asserts it) but Chrome draws no `:focus-visible` ring for a programmatic focus that follows a
pointer interaction — a keyboard user, who opened the dialog with Enter, gets the ring.

**Stages** (each its own process, load average < 2 throughout): `bun run check` ok;
`bun run typecheck` 0 errors; `bun run lint` clean; `bun run -F @deep-wiki/web test` 105 files /
950 tests passed; `bun run e2e -- e2e/book-history.spec.ts e2e/editor.spec.ts
e2e/management.spec.ts e2e/comments.spec.ts e2e/tree.spec.ts e2e/frame.spec.ts` 66 passed.

### 2026-09-16 — Frame follow-ups: the presence stream that died every 10 s, one stream per workspace, optimistic tree writes, tree rows as links

**What happened.** Four of the follow-ups the 2026-09-16 latency report and the frame batches
recorded, one commit each on `fix/frame-followups` (worktree `fb-frame2`). Every stage was
run as its own process; the touched e2e specs ran against this branch's `nuxt dev` on the
worktree's ports (load average 22–33 on four cores throughout — timings below are that
host's, counts are exact).

1. **The presence stream dropped every ~10 s** (`ERR_INCOMPLETE_CHUNKED_ENCODING` in every
   browser, `EventSource` reconnecting for as long as a screen stayed open). Cause:
   `Bun.serve`'s default `idleTimeout` is ten seconds — a connection with no bytes in either
   direction for that long is closed — and `routes/presence.ts` wrote its keep-alive comment
   every `PAGE_LOCK_HEARTBEAT_SECONDS` (20 s). Measured with a 20-line `Bun.serve` script on
   Bun 1.4.2: a stream written every 12 s died at ~20 s with "Bun.serve() timed out a request
   after 10 seconds. Pass `idleTimeout` to configure"; one written every 5 s stayed open for
   the 25 s it was watched. *Fix* (`08cd151`): two cadences — a `: keep-alive` comment every
   `SSE_KEEP_ALIVE_SECONDS` (5, a constant with the measurement beside it: a property of the
   server the API runs on, not of a deployment, and a reverse proxy's read timeout counts it
   as traffic too) and the poll over the `presence` view on `pollSeconds`
   (`PAGE_LOCK_HEARTBEAT_SECONDS`, as before), riding every Nth keep-alive so a late tick never
   skips a poll. The route takes an injectable `sleep`, so the route tests drive the clock by
   hand: frames arrive at the constant's interval, and the poll runs on the fourth keep-alive
   and not the first. `e2e/presence.spec.ts` holds the read screen open for 25 s against the
   real API and counts **one** stream request (before: a reconnect every ~10 s). Found on the
   way: the test `FrameReader` raced `reader.read()` against a timeout and lost the chunk the
   abandoned read resolved with; it now carries the in-flight read across the deadline.
2. **One presence stream per workspace, shared across hops** (`bcb1432`). Every screen owned
   its own `EventSource`; a hop closed it in `onBeforeUnmount` and opened a new one once the
   next response had named the workspace — a fresh connection, membership check and poll per
   click. `usePresenceStream` keeps its signature (`start`/`stop` per screen, a page filter per
   consumer) but the connection lives in a module-level registry keyed by workspace: `start()`
   subscribes, `stop()` unsubscribes, and a connection nobody has wanted for 10 s (the linger
   that carries it across a hop) closes. The roster is the connection's, so a hop shows who is
   editing at once rather than after their next heartbeat; the poll fallback, the backoff, the
   expiry and the hidden-tab pause moved onto the connection unchanged; the server still
   authorises every event per subscriber. Measured in `e2e/presence.spec.ts`: two page hops by
   the tree, **one** stream request.
3. **Optimistic tree writes** (`3868c89`). A reorder awaited the `PATCH` and then reloaded the
   whole tree, so the dragged row snapped back until two round trips had landed; a create or
   rename emitted `changed` and the row appeared on the second request. `useTree.reorder` now
   moves the node locally first — the same arithmetic `reorderNode` does (the node leaves,
   `newIndex` counts among the new parent's children without it, clamped, positions
   renumbered) — then writes, and only a refusal restores the previous list; `applyCreated`
   draws the `POST /nodes` response at the end of its parent's list and `applyRenamed` patches
   the `PATCH /nodes/:id` response in place. `useWorkspaceTree` seeds each transport from the
   shared record and mirrors the transport's refs into it synchronously, keeping `success`
   over a refresh so the rows stay up (the existing per-workspace record is still the cache;
   the read layer arriving on `perf/data-layer-icons-bundle` is not duplicated here).
   `NavigationTreeActions` emits `created`/`renamed` with the payload; the refusal keeps the
   chip notice beside the tree. Measured in `e2e/tree-writes.spec.ts` against the real API with
   the `PATCH` held: the rows are in the new order **while the response is held**, **0**
   `GET /tree` after a successful `PATCH` or `POST` (before: one after each), the server's
   tree agrees, and a 403 snaps the row back with the notice.
   **Found on the way, fixed:** a pointer drop *below* the dragged row among its own siblings
   landed one row further than the pointer said — the node reports the slot in the list as
   drawn while the server counts slots once the moved row has left. Dropping the first of
   three pages before the third reached the server as index 2 of a two-page list and landed
   last. `NavigationTree`'s drop handler steps the slot back by one in that case; the keyboard
   and the menu already counted from the row's own place and are unchanged.
4. **Tree page rows are links that warm their route on intent** (`1951fea`). The rows
   navigated with `navigateTo`, so nothing prefetched the read route. A page row's title is
   now a `NuxtLink` — an `<a href>` the browser can open in a new tab, copy or drag, and that
   the router takes over on a plain click — with `tabindex="-1"` so the tree stays one tab
   stop on the `treeitem`; a click on the link records the selection and leaves the navigation
   to the link, while a click elsewhere on the row, and Enter, open the page through the tree
   as before. `NuxtLink`'s own prefetch skips `preloadRouteComponents` under `import.meta.dev`
   (`nuxt-link.js`), so the row preloads the route itself on `pointerenter` and on focus,
   once; the link's viewport prefetch is off so a 400-row tree does not carry 400 observers
   for one shared chunk. Measured in `e2e/perf.spec.ts` on the dashboard in dev: the read
   route's chunk is requested on hover and **0** requests for it follow the click (before: all
   of them). Nuxt's route table also requests every page as `…index.vue?macro=true` at boot —
   `definePageMeta` extraction, no component — which the assertion excludes. `e2e/tree.spec.ts`
   and `e2e/navigation.spec.ts` (keyboard model, context menu, filter, clicking through the
   tree) pass unchanged.

**Not done, deliberately.** The SSR hydration mismatch on `/workspaces/:id` (the sidebar's
"Choose a workspace" state rendered before `enter()`, `NUXT_E7006`) was dropped from this
batch on the owner's instruction: `perf/data-layer-icons-bundle` fixes it (`useSidebarWorkspace`).

**Found, fixed in passing.** The three mocked tests in `e2e/presence.spec.ts` sign in with a
token the API does not know and mock only edit-session, lock and the stream; since the
signed-out redirect landed, the sidebar's tree answered that token with a 401 and
`NavigationTree`'s `useSignInRedirect` left the whole screen for sign-in a second or two after
it opened — the page under test unmounted, its stream with it, and the indicator never
rendered (traced with a stack on the composable's `stop()`: `onBeforeUnmount` of `edit.vue`,
and the failure snapshot on the sign-in screen). `mockFrame()` answers the tree with an empty
one for the mocked pages (`d653fa5`).

**Found, not fixed.**

- **A first visit to the edit route on a cold Vite optimizer cache reloads the page** ("new
  dependencies optimized … reloading" for the ProseMirror set) and the reload can cross a
  held request or a 30 s wait — `e2e/presence.spec.ts`'s displaced-editor test and
  `e2e/tree-writes.spec.ts` both failed once on that before passing; the latter now warms its
  route in `beforeAll`, as `e2e/perf.spec.ts` does. Pre-existing (the perf batch recorded it),
  and only a symptom of a cold dev server.
- **`useWorkspaceTree` keeps one `useTree` transport per composable instance**, and
  `AppShell` and `NavigationTree` each create one for the same workspace. Only the tree's
  loads; the second exists for `pathTo`. Harmless, but the record could own the transport.
- Two `EventSource`s per hop to a *different* workspace overlap for the linger window (10 s)
  before the first closes — by design, and rare (switching workspaces is deliberate).

### 2026-09-16 — No data layer: measured and fixed

**What happened.** The 2026-09-16 performance report (read-only, `main` at `4987cd9`) found
that every read in `apps/web` was a bare `$fetch` from `onMounted`: nothing server-rendered,
nothing kept between screens, nothing deduped, every hop re-skeletoned and the presence
stream reopened. Measured on the dev server with the worktree's own stack (load average
25–45 on 4 cores throughout, so timings are inflated and quoted as ranges; request counts
and ordering are exact): the dashboard's full load reached content only after hydration
plus four requests (30.8–48.0 s); going back to it re-fetched the activity and showed the
skeleton again (1.24–1.68 s, the `activity` response arriving *before* the lists could
paint); returning to a page did the same (0.83–1.76 s, `GET /pages/:id` answered before
the article appeared). Two more findings rode along: icons were fetched at runtime per
screen and fell through to `api.iconify.design` (three of seven icon requests on the
dashboard → page → edit → page path went to the public API, on a product whose config
says air-gapped instances must not depend on Iconify), and the contracts barrel shipped
the server env schema — `AI_KEK_*`, `DATABASE_URL` — to every page (263 KB / 75 KB gzip,
uncompressed on the wire).

**What changed** (branch `perf/data-layer-icons-bundle`, one commit per piece):

- **A read layer**, `useApiRead` (`apps/web/app/composables/useApiRead.ts`): `useAsyncData`
  under a stable key (`app/utils/api-keys.ts`), `getCachedData` over the payload, `dedupe:
  'defer'`, and a server-side fetch when the request carries a session cookie — the Nuxt
  server forwards it with `useRequestHeaders` (`useApiClient`). That works because
  `apps/web` and `apps/api` share the host in dev and e2e (`localhost:<web>`,
  `localhost:<api>`; a `SameSite=Lax` host cookie reaches both); on a deployment where the
  API is on another host the cookie never reaches the Nuxt server and the read waits for the
  browser, exactly as before. A server-side 401 or no response is recorded as "nothing
  known", never cached. Answers are outcomes, not thrown errors: Nuxt's error reducer keeps
  `statusCode` and drops ofetch's `response`, so a thrown server-side 404 would have reached
  `httpStatusOf` as a network failure. A failed outcome is never served from the cache, so
  absence and denial are asked again identically. `load()` on a warm answer refreshes after
  the next frame, behind the content; during hydration it takes the server's answer without
  repeating the request. Moved: `usePageRead`, `useWorkspaceActivity`, `usePageHistory`,
  `useBookHistory`, `usePageDiff`, `useBookDiff`, `useWorkspaceMembers` (fetch only; the
  screen is another branch's). `useSavePage` clears what a save stales (`keysStaledBySave`).
  The tree keeps its own `useState` cache. **Left for after the merge:** `usePageComments`
  — another branch owns its writes; it is the one read composable still fetching bare, and
  the one whose writes (reply, resolve) should also clear `workspace-activity:*`.
- **Measured after** (same stack, same load band): full load of the dashboard 2.1–5.0 s to
  content with 0 browser requests before it (server-rendered); hops 3, 4 and 6 (back to
  the dashboard, back to a page, edit → read) show the content with **0 API responses
  before it** — the content no longer waits on the network; the refresh is dispatched after
  the first frame. The requests still issued in the same mount task are `comments` and the
  presence stream (other branches' composables, above). Absolute time-to-content on these
  hops stayed in the 0.3–1.9 s band on this machine because the dev-mode client is
  CPU-bound under a load average of 30 (fix A of the report, prebundling reka-ui, is the
  other half); the deterministic proof is the request ordering, held by
  `e2e/data-layer.spec.ts` against a real backend (article and lists in the server-rendered
  document; going back shows content while the browser's refresh is still held).
- **Icons** (`nuxt.config.ts` `icon`): `clientBundle.scan` (43 → 85 icons, 22 KB
  uncompressed) and `fallbackToApi: false`. `e2e/icons.spec.ts`: 7 → 0 icon requests
  across dashboard → page → edit → page. `docs/UI-CHECKLIST.md` §4.3 records the gotcha.
- **Bundle hygiene:** `@deep-wiki/contracts/env` is a subpath export and the barrel no
  longer names `env.ts`; `sideEffects: false` on contracts and core;
  `nitro.compressPublicAssets`. `bun run check:bundle` now fails on any client chunk that
  carries `AI_KEK` (red on `main`, green here). Production builds of `main` and this branch:
  the shared chunk 263,207 / 74,839 B gzip → 197,795 / 59,365 B; JS a page loads eagerly:
  read 251.7 → 238.8 KB gzip, dashboard 244.7 → 231.7, edit 298.5 → 285.0; and every
  asset now leaves with `content-encoding` (gzip 59.6 KB / brotli 51.9 KB for that chunk
  instead of 197.8 KB).

**Found along the way, and fixed here.**

- **The frame's sidebar server-rendered "Choose a workspace" on a first visit.** The layout
  renders `WorkspaceSidebar` from `useCurrentWorkspace()` *before* the page's `AppShell`
  enters the workspace, so on a request with no `dw-workspace` cookie the server sent the
  no-workspace branch and the client hydrated the tree — a hydration mismatch, and after it
  every generated id below the sidebar off by one: the dashboard's panels lost their
  `aria-labelledby` names on a first visit (server `v-0-5-1`, client `v-0-6-1`;
  `e2e/frame.spec.ts` caught the unnamed region). It was already there on the dashboard on
  `main` (verified on a build of `4987cd9`, "Hydration completed but contains
  mismatches"); with the read layer, every screen that knows its workspace on the server
  showed it. `useSidebarWorkspace` now keeps the workspace the frame saw at its own setup
  in payload state, hydrates the sidebar from it, and hands over to the live workspace once
  mounted. Verified in dev on first visits of the dashboard, a page and its history: no
  warning, ids in step.
- **Timestamps in the viewer's timezone were only safe while nothing rendered them on the
  server.** `formatRevisionDate`'s own note said so. Server-rendered, they formatted in
  the server's zone and a viewer elsewhere hydrated every one into a text mismatch
  (`e2e/history.spec.ts`: "7:38 AM GMT-5" in the document, "8:38 AM EDT" expected).
  `viewerTimeZone()` answers UTC on the server and during hydration, and the runtime's
  zone once hydration resolves (`plugins/viewer-time-zone.ts`), re-rendering every
  timestamp on screen; the switch lives in the formatter, so it covers the members screen
  this branch does not edit.

- **The tree fetched itself on the server, without a cookie, and serialised the 401.** After the
  rebase onto the tree-menu and signed-out-redirect merges: `NavigationTree`'s immediate watch
  ran `load()` during the server's render pass whenever the frame already knew its workspace
  (every visit after the first, through the `dw-workspace` cookie), `useTree`'s bare `$fetch`
  carries no session cookie there, the 401 landed in the shared `useState` tree record, was
  serialised with the page, and `redirectWhenSignedOut(tree.status)` bounced a signed-in
  reader to sign-in on every reload (reproduced: reload → `/login?next=…` with no browser
  request for the page at all). Latent on `main` — whether the 401 was serialised depended on
  the fetch beating the render — and deterministic once the read layer made the render wait
  for the page. The tree loads on the client only, as it always had.

**Found, not fixed.**

- **Template comments between `v-if` branches were a dev-only hydration mismatch** the
  moment a branch was server-rendered (the dev client keeps them as the branch's first
  node, the server renderer does not). Fixed globally with `vue.compilerOptions.comments:
  false` rather than by moving every comment; noted here because the codebase documents
  its branches exactly there.
- **A server-prefetching component is an async boundary for `useId()`**, on both sides only
  if the client mirrors the server's choice; `useApiRead` reads whether the server answered
  a key from the payload and sets `server` on the client accordingly. Without that, every
  generated id after the dashboard's setup hydrated against a different one. (Fixed inside
  `useApiRead`; recorded because the rule is not written anywhere in Nuxt's docs.)
- **e2e tests now race hydration.** Content is in the HTML long before the dev client has
  hydrated (51 s on `/login` under load 42), so a test that asserts content and then
  presses a key or expects a client-side hop must wait for `waitForHydration`
  (`e2e/hydration.ts`); the three skeleton tests, the history keyboard and timezone tests,
  the frame's focus-mode and drawer tests and the new specs do. Other specs may hit the
  same race under load and should adopt the helper when they do. Separately,
  `e2e/editor.spec.ts` (untouched here) failed a different test on each serial run under
  this load — 30 s waits for an editor that needs a hydrated dev client plus the edit
  session — and passed each of them alone; fix A of the report (prebundling reka-ui) is
  what shortens that wait.
- **Test sessions idle out at 30 minutes** (`SESSION_IDLE_TIMEOUT_MINUTES` in the harness):
  a seeded token unused for half an hour answers 401, which read like a broken cookie
  forward for a while. Re-seed or touch the session first when measuring by hand.
### 2026-09-16 — The block UI on `EditorSurface`: toolbar, handle, tunes, undo/redo (branch `feat/editor-block-ui`)

**What happened.** The Vue half of the Phase 3.5 block-editing item, on the `/mount` API the
entry below describes, `apps/web` only, one commit per piece (`e2e/editor.spec.ts` holds every
one against the real backend; `docs/UI-CHECKLIST.md`'s Review Log has the review entry):

1. `EditorSurface` mounts through `mountEditor()` and holds the `EditorHandle`; the three
   copies of the doc-body skeleton lines (read, edit, the surface) are one `DocBodySkeleton`.
2. Undo and Redo in the contextual bar beside Save, from `update.undoDepth`/`redoDepth`,
   `aria-disabled` with the reason at depth 0, running the handle's commands. At 320 the two
   extra controls clipped the "Editing" crumb; "Read page" is icon-only below `sm` now (its
   label stays for assistive technology), and the bar's own 320 measurement holds.
3. `EditorSelectionToolbar` — Bold, Italic, Strikethrough, Code, Link — over a non-empty text
   selection, placed by `positionToolbar` (above the first line, below the last near the top
   edge, never past a viewport edge; whole at 320), `Ctrl`/`⌘`+`Shift`+`.` to focus it,
   Escape back. Link is a `UPopover` with a labelled URL field.
4. `EditorBlockHandle` — one `⋮⋮`, following the block under the pointer through `blockAt`
   one lookup per frame, dragging through `startBlockDrag`/`endBlockDrag` with the block as
   the drag image; a `UDropdownMenu` of tunes (Turn into…, Move up/down, Duplicate, Delete)
   from dry runs, every refusal `aria-disabled` with its reason; `Ctrl`/`⌘`+`/` opens it for
   the caret's block. `.editor-drop-cursor` is the `primary` role; `.ProseMirror-selectednode`
   the `secondary-container` pair (`main.css` §13).
5. The `/` menu's rows carry icons from one map (`utils/block-tunes.ts`, shared with Turn
   into); `/table` and `/footnote` are driven end to end.

**Found on the way, fixed here (in `apps/web`).**

- **Enter in an open `/` or `@` menu split the block instead of confirming.** Since
  `keymap.ts` bound `Enter` (`ee7fe3e`, 2026-09-14) the keymap plugin — first in
  `buildEditorPlugins`' list, ahead of the menus by design — claims Enter before the mention
  and slash plugins see it, so Enter left `/heading` in place and opened a new paragraph
  under it (the click path, which the 2026-09-14 audit added, was the only one that worked;
  the 2026-09-07 review's "Enter selects" predates the binding). The package is another
  batch's, so the host confirms Enter and Tab on the **capture phase** of its wrapper,
  before ProseMirror's listener on the editor sees the key, through the same one-transaction
  confirm the click uses. The real fix belongs in `packages/editor`: install the menu plugins
  before the keymap, or have the keymap's `Enter` refuse while a menu is active.
- **A click marked the buffer dirty.** `onUpdate` fires for every transaction, a selection
  move included, and the surface reported the (unchanged) document 300ms later, so a click
  enabled Save before any edit. The surface reports only when `state.doc` is a new instance
  — ProseMirror keeps the same `Node` through a transaction with no steps — which is what let
  the e2e wait for Save to enable as the sign that an edit has been reported.
- **The 300ms blind spot before Save is closed.** `EditorSurface.flush()` reports the pending
  document at once and the screen calls it before Save reads the buffer; the two e2e tests
  that raced the window (the real-backend Save test named below; the not-canonical one) wait
  for Save to enable as well. The blind spot before *leaving* (the route guard,
  `beforeunload`) is unchanged: `isDirty` is still set from the report.

**Recorded, not fixed (the editor package is another batch's).**

- `EditorHandle` exposes nothing that moves the selection, and every block command acts on
  the block the *selection* is in while the handle tunes the block under the *pointer*.
  `utils/block-tunes.ts` `placeCaretIn` reaches `Selection.near` through the state's own
  selection instance (every state's selection is a `Selection` subclass; `near` is an
  inherited static) — no `prosemirror-state` import in `apps/web`, which is not a dependency
  of that package. A `selectBlock(pos)` on the handle would retire it.
- The pinned strong spelling is `__x__`, not `**x**`: `selection-plugin.ts`'s doc comment
  lists `**`; `packages/markdown/src/pipeline.ts` pins `strong: '_'`. The e2e asserts the
  bytes the pipeline writes.
- "Turn into" on a list tunes the first item: `turnInto` runs at the caret, `placeCaretIn`
  puts it in the first item, and the chain is Text (lifts that item out) then the target —
  so on a three-item list the first item becomes the heading and the other two stay a list.
  Notion's semantics for a single item; a whole-list conversion needs a package command.
  Task list is the one target that marks the item in place (no chain). Divider, Table and
  Footnote are insertions, not retypes, and stay out of Turn into.
- Below `md` the handle stands over the block's first glyphs (a floating chip on the menu
  rung) while it shows: there is no margin at 320 (the comment gutter's own trade), and it
  shows only on hover, on drag or with its menu open — none of which a touch device does, so
  at phone widths the tunes are the keyboard's (`Ctrl`/`⌘`+`/`) or nobody's. If the owner
  prefers no handle below `md`, that is one class.
- The selection toolbar covers the previous line while shown (the Medium/Docs placement,
  the same trade the comment batch recorded for its floating "Comment").
- Undo/Redo keep keyboard focus on the button after activation (a pointer click cancels
  `mousedown`, so the caret stays); `Ctrl`+`Z` in the editor is the keyboard's road.

**Environment.** `bun run e2e` could not reuse this worktree's dev server within its 120s
`webServer` timeout under the host's load (average 21–30 on four cores, another worktree's
full Vitest run alongside), and the first navigation after a dev-server start compiled the
edit route for longer than the 30s waits; the runs here went through `playwright test
--config playwright.config.ts` against a `nuxt dev` started by hand on the worktree's port,
warmed once. `apps/api/testing`'s compose stack and the test Postgres each failed their first
`--wait` under the same load and came up on a manual retry. `setupNuxt` exceeded Vitest's 60s
hook twice on files this batch did not change, while the other worktree's suite ran.

### 2026-09-16 — The `/mount` API now carries everything a Notion-like block UI needs; the Vue side is the next batch

**What happened.** Branch `feat/editor-block-commands` (worktree `fb-editor`, `packages/editor`
only — `apps/web` untouched, because `perf/edit-chain-and-prebundle` owns `EditorSurface.vue`
until it lands) built the editor half of the Phase 3.5 block-editing item, one commit per
piece, each DOM-free and `bun test`-proven, with GATE-2 growing 168 -> 177 and staying
byte-identical throughout. What `@deep-wiki/editor/mount` now exposes:

- **`mountEditor(options): EditorHandle`** — `createEditorView` plus the command surface,
  bound to the view: `{ view, undo, redo, toggleMark(name), setLink(href, title?), unsetLink,
  moveBlockUp, moveBlockDown, deleteBlock, duplicateBlock, turnInto(slashCommandId),
  blockAt(coords), startBlockDrag(pos, dataTransfer?), endBlockDrag, destroy }`. Every command
  returns `false` and dispatches nothing where it cannot apply. `createEditorView` still returns
  the bare view for the current `EditorSurface.vue`.
- **`onUpdate(view, update: EditorUpdate)`** — the second argument is now
  `{ transactionCount, undoDepth, redoDepth, selection }` (was the bare count). Undo/redo
  buttons disable from the depths; `selection` is the DOM-free snapshot below.
- **Selection state** (`selection-plugin.ts`): `selectionSnapshot(state)` reports
  `{ kind: 'text'|'code'|'node'|'gap', from, to, empty, marks: { strong, emphasis, delete,
  inlineCode, link }, link: { href, title } | null }`; the plugin's `view()` adds
  `coords: { from, to }` from `coordsAtPos` (the only DOM call) and reports through
  `options.selection.onChange` only when the snapshot changed. "Active" over a range means the
  WHOLE range carries the mark; `toggleMark` uses `removeWhenPresent: false` to match, and
  `Mod-b`/`Mod-i` share that factory (`toggleMarkCommand`), so a keystroke and a button agree.
- **Gap cursor and drop cursor** are installed (`plugins.ts`, `buildEditorPlugins`); the drop
  cursor element carries `DROP_CURSOR_CLASS = 'editor-drop-cursor'` and paints no colour of its
  own, so the stylesheet owns it. `Alt-ArrowUp`/`Alt-ArrowDown` move the top-level block.
- **`/` menu**: `text` (back to a paragraph — retypes a heading/code block in place, lifts a
  list item or quoted paragraph one level), `task-list` (`- [ ]`, or marks an existing bullet
  item in place), `table` (2x2, empty cells — the empty spelling `|   |   |` is canonical,
  fixture `table-empty.md`, so no placeholder text), `footnote` (`[^n]` at the caret, empty
  `[^n]:` at the end, caret moved into it; the one command a table cell can run).
  Order: Text, Heading 1-3, Bulleted, Numbered, Task list, Quote, Code block, Divider, Table,
  Footnote. On a plain paragraph `text` is inapplicable and therefore not offered, which is
  why `e2e/editor.spec.ts`'s "second option is Heading 2" still holds.

**Found on the way, fixed on the branch.**

- `setBlockType` (prosemirror-commands) replaces a block's attrs wholesale, so `/heading` on
  `First ^abc123` produced `# First` — the anchor, and every comment on it, gone. Fixed:
  `setBlockTypeKeepingAnchor` (`slash-plugin.ts`), used by the heading and code commands and
  therefore by `turnInto`.
- An empty `blockquote`, `listItem` or `footnoteDefinition` (`>` / `-` / `[^1]:` alone — all
  canonical, all what `/quote`, `/bullet`, `/footnote` leave on an empty line) threw a
  `RangeError` in `fromMarkdown` that the probe reported as an unsupported construct named
  "RangeError" at line 1: a page saved in that state could not be reopened. Fixed
  symmetrically: `fromMarkdown` gives the container one empty paragraph, `toMarkdown` emits
  that sole empty paragraph as zero children (the canonical spelling — `[^1]:`, not
  `[^1]: `). Fixture `empty-containers.md`.
- `duplicateBlock` strips every `blockAnchor` at every depth (a copied anchor is two blocks with
  one id, the tombstone-resurrection class). Duplicating creates ADJACENT siblings, where the
  serialiser must pick a spelling: adjacent lists come back with an alternated marker (`*`, or
  `1)`) and re-open as two lists; each modelled block type is covered in
  `block-commands.test.ts`.

**Limits, recorded rather than hidden.**

- GFM cannot spell an EMPTY task item: `listItem { checked: false }` with no text serialises
  to `-` (a plain bullet) and `- [ ]` alone re-parses as literal text. A task list created on an
  empty line and saved before anything is typed comes back as a bullet. Same class as the
  existing `/bullet`-on-empty-line, and not fixable below the pipeline.
- `turnInto` runs the slash command AT THE CARET, exactly as typing `/` there would: a caret
  in a list item turned into a heading yields `- # Title` (a heading inside the item), not a
  heading in place of the list. The tunes menu should offer `text` first for that case, or the
  Vue batch can chain `text` then the target.
- The drop cursor's `move` decision is ProseMirror's at drop time (`dragMoves`: the Ctrl/Alt
  modifier copies), so `startBlockDrag`'s `move: true` is the default, not a lock.
- `mountEditor` lives in `create-editor-view.ts`, the one DOM-bound file, exempt in
  `test-coverage.ts` under its existing entry; everything it binds is tested through fake
  views, and it stays a thin composition so the exemption covers nothing else.

**What the Vue batch must build** (after `perf/edit-chain-and-prebundle` lands on
`EditorSurface.vue`; read `docs/UI-CHECKLIST.md` and `docs/DESIGN-SYSTEM.md` in full first):

1. Switch `EditorSurface.vue` from `createEditorView` to `mountEditor`, keep the handle.
2. A `role="toolbar"` bubble positioned from `selection.onChange`'s `coords` via
   `positionMenu`, shown for `kind === 'text' && !empty`: Bold, Italic, Strikethrough, Code
   (`toggleMark`, pressed state from `marks`), Link (`setLink`/`unsetLink`, prefilled from
   `link`), and a "Turn into" select over `SLASH_COMMANDS` minus `BLOCK_COMMANDS_NOT_TURNABLE`.
3. Undo/redo buttons in the contextual bar, disabled from `update.undoDepth`/`redoDepth`.
4. One absolutely-positioned handle (`mousemove` -> `blockAt(coords)` -> `rect`), `draggable`,
   `dragstart` -> `startBlockDrag(pos, event.dataTransfer)`, `dragend` -> `endBlockDrag()`,
   plus a `⋮` menu outside the contenteditable (`@mousedown.prevent`) with move up/down,
   delete, duplicate, turn into. Style `.editor-drop-cursor` from the design tokens.
5. e2e: select text -> toolbar appears -> Bold -> markdown updates; `page.dragAndDrop` between
   two paragraphs asserting the emitted order; `/table` and `/footnote` land the caret where
   this batch says they do.

**Impact.** None of `apps/web`, `apps/api` or `packages/markdown`'s code changed; three fixtures
and their chunk goldens were added. The `onUpdate` second-argument change is source-compatible
with the one caller (`EditorSurface.vue` reads only `view`).
### 2026-09-16 — Edit-mode latency: measured causes and fixes

**What happened.** The owner's eighth finding above ("entering edit mode is slow to load")
was measured before it was touched: a read-only session drove `/pages/:id/edit` in a real
browser (Playwright, CDP network log, `performance` marks from a `MutationObserver` installed
before navigation) against the dev server the owner runs and against a production build, 3
cold + 3 warm runs each. The whole report — numbers, the dev-mode request breakdown, the
serial open chain, the "feels fast" audit of every screen, and a plan for a block-editor UX
on the current ProseMirror — is in the session scratchpad (`perf-report.md`); what follows is
what it found about edit mode and what this batch did about it. Four fixes, one commit each,
each proved by the measurement the report named, on branch `perf/edit-chain-and-prebundle`.

**Caveat on every wall-clock number below.** The machine carried a load average of 30–38 on
four cores throughout (other agents' Vitest and dev servers), against 10–25 during the
report's runs. Request counts, bytes and *order* are deterministic and exact; times are
inflated 5–10× and are quoted only as the same instrument's before/after on the same load.

**Cause 1 — dev hydration was a 1,030-request waterfall, 565 of them `reka-ui`.**
`@nuxt/ui` pushes `reka-ui` onto `build.transpile` (`node_modules/@nuxt/ui/dist/module.mjs:109`);
`@nuxt/vite-builder` turns every transpile pattern into `optimizeDeps.exclude` for the client
and then, in its `nuxt:dev-server` plugin, drops any `optimizeDeps.include` entry that is also
excluded (`dist/index.mjs:1115-1124`). So the obvious `vite.optimizeDeps.include: ['reka-ui']`
in `nuxt.config.ts` is silently discarded, and Vite serves the package as ~565 raw ESM files
over HTTP/1.1, spanning 0.78 s → 3.04 s of the load on their own. Hydration was 80–88% of the
time to an editable surface in dev.
*Fix A* (`02c8844`): `apps/web/modules/perf-prebundle.ts` hooks `vite:extendConfig` on the
client config and moves `reka-ui` from `exclude` to `include`; dev only; listed in
`nuxt.config.ts` beside the reason. Measured (2 cold + 2 warm): resources **1051–1053 →
455–457**, requests before the session request left **1026–1032 → 431–432**, `reka-ui`
**565 → 2** (one 6 MB prebundle, cached after the first load). Proof: `e2e/perf.spec.ts`
asserts fewer than 500 resource entries on the edit route, with the resource-timing buffer
raised past the browser's 250-entry default (which would have hidden the waterfall and passed
the assertion on main).

**Cause 2 — the open chain was serial where nothing depended on anything.** Hydration → `GET
…/edit-session` (fired from `onMounted`) → `EditorSurface` mounts → *only then*
`import('@deep-wiki/editor/mount')` (dev: 14 requests, 1.04 MB) → first `fromMarkdown` (98 ms,
lazy processor init) → view. And `EditorSurface.vue` statically imported `fromMarkdown`/
`toMarkdown` from `@deep-wiki/editor`, so the whole remark/micromark/mdast stack rode in the
edit route's pre-hydration chunk (dev: 21 module requests before hydration by this batch's
count; prod: most of the 199 KB `DBjEgo5p.js`) although nothing can parse until the session
and the mount chunk have both arrived.
*Fix C*: `packages/editor/src/mount/index.ts` re-exports the two converters (same bindings —
`mount/index.test.ts` holds them identical to the `"."` export's, so there is still one
parser); `apps/web/app/utils/editor-mount.ts` is the one importer of the mount chunk, cached,
warming `fromMarkdown('')` inside the same promise; `pages/[id]/edit.vue` calls it in
`onMounted` *before* `load()`; `EditorSurface` awaits it and takes the converters from the
module, dropping its static import. Measured: the mount chunk's first request now leaves in
the same millisecond as the session request (`24519` vs `24520`, `20583` vs `20620` — before,
it left 2.2–2.9 s *after* the session response); module requests before the session request
**431–432 → 402–403**, and the markdown-stack requests before hydration **21 → 0**. Proof:
`e2e/perf.spec.ts` holds the session response and asserts the chunk request is on the wire
before it is released — impossible on main, where the import waited for the response.
`bundle-isolation` and `single-parser` stay green: the import is still dynamic, and the
re-export is a binding, not a second pipeline.

**Cause 3 — no route-change feedback, and nothing prefetched in dev.** `NuxtLoadingIndicator`
was not mounted anywhere; `NuxtLink` skips `preloadRouteComponents` under `import.meta.dev`,
so a read → edit hop paid all 52 of the route's module requests on the click.
*Fix D (partial)*: `app.vue` mounts `NuxtLoadingIndicator` once for every route — `primary`
role at 3px, `error` for a failed hop, off for any hop under its 200 ms throttle, and under
`prefers-reduced-motion` drawn full at once instead of creeping
(`apps/web/app/utils/loading-progress.ts`; `docs/DESIGN-SYSTEM.md` §14). The read screen's
"Edit" control preloads the edit route's components and starts the editor chunk on
`pointerenter` and on `focus` (`pages/[id]/index.vue`), through the same importer fix C added.
Measured, read → edit hop in dev (2 runs each, load average ~22): without intent, **49–50
module requests after the click**, click → editable 1.1–2.3 s; with a hover first, **49
requests during the hover and 0 after the click**, click → editable 0.85–1.26 s. Proof:
`e2e/perf.spec.ts` asserts the route chunk and the mount chunk are requested on hover and on
focus before any click, that a hop whose chunk is held shows the indicator at opacity 1 in
the computed `--ui-primary` at 3px and hides it once the screen lands, and — with
`reducedMotion: 'reduce'` emulated — that the bar's transform is the identity matrix from its
first visible frame. Out of this batch, deliberately: turning the tree rows into
`NuxtLink`s (the `feat/tree-context-menu-filter` branch owns `NavigationTree.vue`), and the
presence `EventSource` reopened on every hop. Two things learned on the way, worth their own
line: "Edit" is server-rendered and visible tens of seconds before Vue attaches a listener to
it under load, so a browser test that hovers it must first wait for something only hydration
can render (the article's title); and `NuxtLink`'s own `prefetchOn="interaction"` would not
have done this in dev, because `nuxt-link.js` skips `preloadRouteComponents` under
`import.meta.dev` — the owner's environment is exactly the one it would have left cold.

**Cause 4 — small serial costs at open.** `useLockHeartbeat.start()` sent a `PATCH …/lock`
the instant the editor opened, renewing a lock the session response had acquired 100 ms
earlier; and `EditorSurface`'s box was in the DOM 120–730 ms before ProseMirror attached to
it, an empty well where the page's skeleton had just been.
*Fix H*: `useLockHeartbeat.start()` schedules the first beat one interval away instead of
sending one at once — the session response is the first beat; `e2e/editor.spec.ts`'s
lock-lost test advances Playwright's clock one interval rather than expecting the notice the
instant the editor opens. And `EditorSurface` keeps the skeleton's `doc-body` lines up and
hides (never removes) its own box until `createEditorView` has attached, so the empty well
never shows. Measured: no `PATCH …/lock` in the first seconds of an open (before: one, in
the same instant as the session response), and the surface is `display: none` from the
moment it enters the DOM until ProseMirror is in it. Proof: `e2e/perf.spec.ts` counts lock
PATCHes for 1.5 s after the editor is live and expects none; `EditorSurface.test.ts` holds the
mount import back and sees the skeleton and the hidden box, then the swap;
`useLockHeartbeat.test.ts` runs on fake timers. The `min-h-64` well still opens the moment
the surface appears — a layout step below the text, not under it — and is the same step the
page skeleton (three lines) already made before this batch; not changed here.

**What this batch did not do**, recorded so it is not mistaken for done: the report's fix B
(a cached, SSR-capable read layer — every screen still `$fetch`es in `onMounted` and shows its
skeleton again on every hop), E (optimistic tree writes), F (icons bundled offline —
`@nuxt/icon` still falls back to `api.iconify.design`), G (bundle hygiene — the server
`envSchema` and zod still ship to every page, 75 KB gzipped, and Nitro serves no
`content-encoding`), and the second half of D.

**Impact.** In dev, the owner's stack, the first two causes were ~80–90% of the time to an
editable surface; both are removed at the request level. The remaining wait on this machine
is CPU under load, which no request-shaped fix can reach. Production gains are smaller and
structural: −150 KB from the pre-hydration route chunk and one fewer serial hop per open.

### 2026-09-16 — Owner review of the workspace frame: eight defects, all in flight

**What happened.** The owner reviewed the workspace frame shipped across the 2026-09-15
batches and returned eight defects. Agents are assigned to each already — status **in
flight** on all eight, not "found, not yet picked up":

1. **Signed-out `/workspaces` shows a "Sign in to see your workspaces" card.** Wanted:
   redirect straight to `/login`, returning to `/workspaces` afterwards.
2. **The invite form on Members is a permanent column, and management screens keep the
   navigation-tree sidebar.** Wanted: the invite form as a modal; and inside management
   screens (members, registration, future settings) the sidebar should switch to a dedicated
   **management sidebar** instead of the tree. The management-sidebar decision is also now a
   Phase 3.5 roadmap item.
3. **Tree rows have no context menu, and there is no filter/search box.** Wanted: a context
   menu on rows (folders and pages) for actions, and a toggleable filter/search box like VS
   Code's explorer filter.
4. **Edit mode's contextual bar (breadcrumb + "Read page" + "Save") crowds the top; the
   document loses importance.** Wanted: clean, Notion-like editing — a block handle, inline
   floating tools, `/` to insert tables/headings/etc. The editor-direction decision behind
   this (stay on ProseMirror, build Notion-like block UX on the existing schema) is also now
   a Phase 3.5 roadmap item.
5. **`pages/[id]/edit.vue` uses a native `window.confirm`.** Wanted: an internal dialog
   component; no native alerts/confirms anywhere in the product.
6. **The sidebar toolbar's "+ New…" button does not fill its row.**
7. **Starting a comment thread from read mode does not exist** — only reply/resolve do — so
   the owner could not comment on a document from Read. This blocks gate 10.8
   (`openspec/changes/versioning-and-collaboration/tasks.md`).
8. **Entering edit mode is slow to load** (being measured). Wanted: an nprogress-style top
   progress bar, skeletons for every request-backed area, correct caching, optimistic
   updates, and deferred loading — "the UI must feel fast."

The same review also settled eight product decisions that do not describe defects — these
are recorded as new roadmap items, not here: ZEN mode and the `Ctrl`/`⌘`+`K` command palette
(Phase 3.5), the bookshelves-with-covers workspace dashboard (Phase 3.5), the management
sidebar as the future home for team and personal settings (Phase 3.5), the ProseMirror
editor-direction confirmation (Phase 3.5), inline image/SVG support (Phase 4), post-AI
selection interactions — ask about a selection, comment on a selection (Phase 5) — and
user-contributed colour themes (Phase 8).

**Impact.** None of the eight defects are fixed by this entry; it is the record of what was
asked, on 2026-09-16, and that work on all eight is already in flight. `apps/web/PRODUCT.md`'s
"Not yet" list and Product Principles are updated to match the decisions above.
### 2026-09-16 — Threads can be started from read mode; the anchor is the server's; `data-derived-block-id`

**What happened.** The owner tried to comment on a document and could not: the overlay drew
marks, the panel replied and resolved, and the only way to *start* a thread was
`POST /pages/:id/comments` by hand — recorded as out of scope on 2026-09-14, and the reason gate
10.8 could not be exercised. Branch `feat/new-thread-from-read`, worktree `fb-comments`.

**What the client could not name.** `render()` emits `data-block-id` only on a block with a
persisted anchor (comment-overlay spec: "an unanchored block MUST carry no such attribute"), so
a block that had never been commented on had *no identity in the HTML at all*, and the read
screen never parses. The API already accepted a derived id (`d:<hash>#<n>`) for exactly this
case — nothing could send one. The render now emits **`data-derived-block-id`** on every
top-level paragraph and heading with no anchor, carrying `sliceBlocks`'s derived id, under its
own attribute so the spec's sentence about `data-block-id` stays literally true and the two
never have to be told apart by their value's shape. Grammar-pinned in `SANITIZE_SCHEMA` like
`dataBlockId`. Only anchorable blocks get one: a list, code block, table or raw-HTML block
cannot carry ` ^id`, so an identity for one would be an affordance that fails at the mint —
**comments on those block kinds are not offered**, and that is a limit to record, not a bug.
`CURRENT_PIPELINE_VERSION` is 4; `backfill:render` carries the attribute to the existing
corpus, and until it reaches a page its unanchored blocks simply offer no "+".

**Why a derived id and not a slot index.** A derived id is a hash of the block's text: a
page saved between the reader's load and their post makes it stop resolving, and the route now
answers **409** ("that block has changed since this page was loaded") instead of falling
through to `createRootComment` with an unresolved id and surfacing `comments_block_fk` as a
500. A slot index would silently land on whichever block now sits there — the one failure
`docs/UI-CHECKLIST.md` §4.7 forbids outright.

**The anchor is the server's to compute.** The client selects *visible* text off cached HTML
(`bold word`) and has no offsets into the canonical source (`__bold__ word`). Save-time
reconciliation compares the stored quote to the block's source by exact substring first and
trigram containment at 0.8 second, so a quote that is not a source substring would skip the
exact rows on every later save and could orphan a comment on a block nobody touched. New
`locateQuoteInBlock` (`packages/markdown/src/anchor-quote.ts`): exact occurrence (nearest the
client's offset hint when repeated) → smallest source window containing the selection as a
subsequence (`Hello world` over `Hello __world__` stores `Hello __world`) → the whole block
minus its trailing ` ^id`. `CreateCommentRequestSchema`'s `offsetStart`/`offsetEnd`/`quote`
are optional; offsets are a hint, never stored as sent. The consequence to know: a selection
across inline markup stores the *source* window, so its excerpt can show `__`/`[](…)` — a
markdown wiki's honest excerpt, but not the reader's exact words.

**`canComment` on the threads response.** The API answered `{ threads: [] }` identically to a
reader and to a commenter on a page with no thread yet, so no page's first thread could ever be
started from the client. The response now carries `canComment`, the caller's *own* grant —
which a POST tells them anyway. Non-disclosure is unchanged and tested: a reader's response is
byte-identical whether the page has threads or none.

**`mintAnchorAtBlock` now receives `reservedIds`** — the page's full `page_blocks` registry,
every status — closing the 2026-09-13 "still open" follow-up below; a test drives
`crypto.getRandomValues` into a tombstoned id and asserts the second draw is taken.

**The 403 stays.** The task asked that a caller without `comment` get the same answer as a
nonexistent page. Verified against the route and its tests: absence and denial already answer
identically at the *read* gate (404 for an unreadable page, tested byte-for-byte), and a caller
who can read the page learns nothing from a 403 for the stronger action — the route's own
comment and `comments.test.ts` ("a subject who holds read but not comment still gets 403, not
404") say so deliberately, and the client's message for a revoked commenter depends on it. Not
changed.

**Read mode.** `CommentGutter` offers a "+" (`i-lucide-message-square-plus`, "Comment on this
block", tooltip, 32px) beside every commentable block without a mark, quiet (`opacity-0`) until
its block is hovered or it is focused; the gutter is **one tab stop with a roving tabindex**
(arrows, Home, End; stated in an `aria-describedby` description) rather than a control per
paragraph in the tab order. A selection inside one block floats a tonal "Comment" above it
(`data-testid="comment-selection-action"`). Both open `CommentComposer` at the top of the panel
(`useNewThread` holds the draft): labelled `UTextarea`, Post (Filled) and Cancel (Outlined),
Ctrl+Enter. Posting is **optimistic**: `usePageComments.create` inserts a `pending:*` thread —
counted by the gutter, marked "Posting…" in the panel, not yet repliable — and the server's
list replaces it; on failure it is withdrawn, the composer keeps the text, and the notice says
"Your text is still here". When the server mints an anchor for a derived id, the screen
**adopts it in the DOM** (`adoptMintedAnchor`) and moves the panel's focus to the new id before
the reload, so the thread just posted is placed without a page reload.

**Mentions in the composer.** The editor's menu was markup inside `EditorSurface.vue`, not a
component; it is now `MentionMenu.vue`, used by both (§4.1). The composer's trigger is
`utils/mention-trigger.ts` (pure), not the ProseMirror plugin, so the read path never loads the
editor chunk — `bundle-isolation` and `bundle-isolation-build` both exit 0. People only:
a comment's mention notifies a person; a page has no inbox. Access is checked the way the
editor's is, with the same chip.

**Seen on the way, not fixed.**
- The Nuxt **dev** server on this machine takes ~60s to hydrate a page in a fresh browser
  context (1017 module requests, two other worktrees running e2e at the same time), so every
  30s first-visit timeout in `e2e/comments.spec.ts` fails against `bun run e2e`'s dev
  `webServer`. The suite was run against a production build served on the harness's web port
  (`bun run -F @deep-wiki/web build` then `node apps/web/.output/server/index.mjs`, with
  `bunx playwright test` directly, `reuseExistingServer`): 8/8. `scripts/e2e.ts` refuses when a
  dev lock is held, so this is a documented workaround, not the command.
- Two `apps/api` suites (`s3-blob-store`, `smtp-mail-sender`) failed once with "podman compose
  did not bring up a reachable Mailpit/MinIO within 90000ms"; the same stack came up in 16s when
  started by hand. Environmental.
- The floating "Comment" stands 8px above the selection and therefore over the previous line's
  text while it is shown — the Medium/Docs pattern, transient, gone on the next click. Whether
  the owner wants it in the gutter column instead is a review question.
- The "+" is offered to a commenter below `md` inside the column, so every page a commenter
  reads at 320px gives up 40px of end padding, not only pages with threads.
- A provisional thread is shown as authored by "You": the client holds no `me`.
### 2026-09-16 — The tree's context menu and its filter (branch `feat/tree-context-menu-filter`)

**What shipped.** Two owner-review items on the navigation tree, one commit each,
in the sidebar's tree region only — the toolbar row (`NavigationTreeActions.vue`'s
template) is untouched because a parallel branch restyles it.

1. **A context menu on every row** (`NavigationTree.vue`, `useTreeRowActions.ts`).
   Right-click, a `⋯` button at the row's end (visible on hover and focus within the
   row, always in the tab order on the row that holds the tree's tab stop), `Shift+F10`
   and the `ContextMenu` key all open **one** `UContextMenu` wrapped around the tree
   (`bg-accented`, §9.6, `rounded-md`, §3.4). The `⋯` and the keyboard both dispatch the
   same `contextmenu` event right-click sends, anchored under the control, so there is
   exactly one way a menu opens. Items are `treeRowActions()`: "New <child>…" from
   `legalChildTypes()` over the row's type — the one `LEGAL_PARENT_TYPES` table read
   backwards, never a second list; "Rename…"; "Move up"/"Move down"; "Open" (pages);
   "History" (books and pages); "Copy link" (live on a page, disabled elsewhere with
   "Only a page has an address to copy yet."). An action the row cannot take *right now*
   stays in the menu, `aria-disabled`, with the reason as its visible description —
   "Already first among its siblings." — never behind a hover (§3, §5). No delete: the
   three open questions (Findings 2026-09-09) come first. **One path for the writes:**
   `NavigationTreeActions` now `defineExpose`s the two functions its buttons call
   (`openCreate(type?)`, `openRename()`); the menu selects the row and calls those, so
   "Rename…" from the menu and from the toolbar is the same dialog, fetcher and failure
   classification. Moves are the same `reorder` the `Alt`-arrows make. Focus: Reka's
   `FocusScope` dispatches `closeAutoFocus` while its trap is still listening, so the
   return to the row is queued behind the unmount (`setTimeout(0)`, as Reka queues its
   own default); a dialog the menu asked for is opened *after* that return, so the
   dialog's own focus return lands on the row too.
2. **A toggleable filter** (`useTreeFilter.ts`). Hidden by default; the header's
   "Filter tree" button (`aria-expanded`, `aria-controls`) and `Ctrl`/`⌘`+`Shift`+`F`
   while the sidebar has focus show it. The chord is *registered* only while focus is
   inside `#dw-frame-sidebar-workspace` (a `computed` config to `defineShortcuts`), so
   elsewhere it is neither swallowed nor answered; `Ctrl`+`F` stays the browser's and
   `Ctrl`+`K` is untouched. Typing prunes the tree to title matches (case-insensitive)
   **and every ancestor of a match**, ancestors open; the matched text is a `<mark>` in
   the secondary family (`secondary-container`/`on-secondary-container`, and the accent
   pair on the selected row, whose fill is already `secondary-container`); the count is
   announced from a live region always in the DOM ("2 matches for “auth”."); "no
   matches" is its own state with "Clear filter" beside it, distinct from first-run
   empty (§3). **Folds are never written to by the filter:** while a query is active
   the tree reads a per-query fold set that starts empty, so clearing the query gives
   the person's folds back by construction, not by a snapshot restored at the right
   moment. Escape in the box clears, hides and hands focus back to the tree's row. The
   field is `h-10` (the tree row's height, §7.2) at 16px text (§9.5) — a design-system
   ruling for a text field in chrome, recorded in `docs/DESIGN-SYSTEM.md` §14.

**Found while building, fixed.**

- **`group` on the `<li>` lit every ancestor's `⋯`.** The tree item element holds the
  whole subtree, so `group-hover`/`group-focus-within` there matched when any descendant
  was hovered or focused: hovering a page three levels down showed three `⋯` buttons.
  Seen in the first 1280 screenshot. `group` moved to the row `div`, which is what the
  button sits in. Pre-existing structure; it only had one book row's button to show
  before.
- **At 320 the menu ran off the screen.** Measured x+width = 474 in a 320 viewport: the
  reasons under the items are longer than the pane and the content had no cap, so
  `avoidCollisions` had nothing it could do. Capped at the popper's own
  `--reka-context-menu-content-available-width` (the twin of the `max-h` Nuxt UI's theme
  already carries) with `collisionPadding: 8`, and the descriptions wrap rather than
  truncate — "Already first …" is not a reason. Asserted at every width in
  `e2e/tree.spec.ts`.
- **Playwright's role queries go blind while a modal menu is open.** Reka's modal menu
  sets `aria-hidden` on the rest of the page, so `getByRole('treeitem')` finds nothing
  — correctly. Assertions about the page under an open menu use CSS locators, with a
  comment saying why.
- **A `treeitem`'s centre is a child.** `getByRole('treeitem', …).click()` on an
  expanded book lands on the page inside it, because the item element holds the
  subtree. Clicks go to the row `div` (`[draggable="true"]`), as `e2e/navigation.spec.ts`
  already did.

**Found, not fixed (outside this branch's files).**

- **SSR of the dashboard renders the sidebar's "Choose a workspace" state and the client
  hydrates the tree over it.** With no `dw-workspace` cookie yet, the server renders
  `WorkspaceSidebar` with a null workspace while `AppShell` sets it during the same
  render; the console shows `[NUXT_E7006] Cookie dw-workspace was previously set to null
  and is being overridden` plus Vue hydration mismatches at `<NavigationTree>` and the
  Members link. Reproduced with the writer fixture on `/workspaces/:id`; visible only in
  the console. `AppShell.vue`/`useCurrentWorkspace.ts` are not this branch's files.
- **No per-node permission reaches the client** (Open Questions, amended below), so the
  menu cannot grey out "Rename…" or the moves for a `read`-only member; the server refuses
  and the same dialog shows the same sentence the toolbar shows.
- **Unit and e2e timings on a shared host.** With five other worktrees' suites running
  (load average 27–35, 13 of 15 GB used), `@nuxt/test-utils`'s environment boot
  regularly exceeded the 60s hook timeout (`--hookTimeout 240000` was needed to run the
  composable suites at all), the dev server took over 120s to answer Playwright's
  `webServer` probe, and the first hydration of `/workspaces/:id` was measured past 30s.
  `e2e/tree.spec.ts` waits up to 90s for the first row for that reason and says so; a
  quiet host pays nothing.

**Verified.** See the branch report; every stage run as its own process.

---

### 2026-09-16 — The management sidebar, and the invite form as a dialog

**What happened.** Two owner-review items from the 2026-09-15 frame review, one commit each
on `feat/management-sidebar` (worktree `fb-manage`):

1. **A management sidebar** (`40cffbc`-lineage; see the branch). "In a settings area the
   sidebar should switch to everything that is management, not stay on the tree." One
   mechanism, typed: `definePageMeta({ sidebar: 'management' })` — `useSidebarMode.ts`
   augments `PageMeta`, `WorkspaceFrame` reads the route and hands `WorkspaceSidebar` a
   `mode`, and the sidebar swaps *only its middle region* (`ManagementSidebar.vue`) and lets
   its two footer doors (Members, Registration settings) step out because the sections now
   hold them. The header (the switcher) and the theme toggle are unchanged in both modes: the
   person is still in the workspace, and a second copy of its name under the switcher would be
   the eyebrow defect of `docs/UI-CHECKLIST.md` §4.4, so the region starts with "Back to
   workspace" instead. `ManagementSidebar` is `UNavigationMenu` vertical — sections
   Workspace (Members · Settings · AI & models), Instance (Registration settings), You
   (Profile) — with `exact` links so `aria-current="page"` lands on the open screen's door
   and never on the way back (a prefix of every management address).
   - **Placeholders are routes, not disabled items.** `/workspaces/:id/settings`,
     `/workspaces/:id/ai` and `/account` each render `PageHeading` + a `PageNotice`
     "Not built yet" with what is true today and a real next action (Members; back to the
     workspace; the password-reset link). The disabled alternative was rejected on a measured
     ground: `UNavigationMenu`'s `disabled` renders the link through `ULinkBase` with
     `tabindex="-1"` — out of the tab order, its reason behind a hover a keyboard user cannot
     perform — which is exactly the §5 failure the checklist names. Three thin screens, each
     with a test.
   - **Two library defaults corrected centrally** (`app.config.ts`, `navigationMenu`): the
     active pill is `before:bg-elevated` and the hover `before:bg-elevated/50` — on the
     `bg-elevated` pane the list stands in, the pane's own tone painted over itself, the
     2026-09-07 tree-row defect in a second component. Active is now `secondary-container`
     with its `on-` pair (the tree's selected fill; opaque, identical in both themes) and
     hover/focus/pressed the `currentColor` layer at 0.08/0.12/0.12. The focus ring joins the
     global 3px `secondary` (stated on the colour variant — §7.4's ordering trap).
   - **`/admin/registration` and `/account` follow what is remembered.**
     `middleware/management-frame.ts` sets the `workspace` layout when the last-workspace
     cookie names one and leaves the document frame otherwise (the operator who holds no
     workspace — `e2e/navigation.spec.ts`'s Super Root — keeps the chrome's icon door and the
     document frame). The page reads the same cookie for its `AppShell`, so the layout and
     the pane cannot disagree. Registration keeps its "Instance" eyebrow in both frames:
     neither the bare `<h1>` nor a breadcrumb that starts with the workspace's name says it.
   - **The `is_super_root` gap is unchanged.** "Registration settings" renders for every
     caller in the Instance section, as the footer door did, because no response carries the
     flag and there is no `GET /me` (Open Questions, 2026-09-14). Checked again on
     2026-09-16: `apps/web/app/composables` has no `useSession`, `packages/contracts` has no
     `capabilities` field on any response, and `apps/api/src/routes/admin.ts` is the only
     reader of `users.is_super_root`. The destination's 403 state gates it. A hidden-on-a-
     guess link would be the dishonest one.

2. **The invite form is a dialog** on the members screen. It was a permanent column beside
   the roster ("saturates"); it is now a `UModal` behind the screen's one primary action,
   "Invite someone", Filled at the bar's size in `AppShell`'s `header-end` slot — where edit
   mode's Save stands. Every field, description and the access radio group are unchanged;
   the submit moved to the dialog's footer beside Cancel (`form="invite-form"` — the dialog is
   never server-rendered, so `AuthSubmit`'s hydration guard has nothing to guard). The dialog
   is *controlled*: Escape, the close control, the backdrop and Cancel all go through one
   handler; with the email empty it closes, with an address typed the footer swaps to
   "Discard this invitation?" with Keep editing (focused) / Discard — inside the dialog, not
   `window.confirm`, not a second dialog, because `ConfirmDialog.vue` + `useConfirm()` is
   arriving on another branch and this screen must not grow a copy (§4.1). When that lands,
   this footer pair is what it replaces. A sent invitation closes the dialog, focus returns
   to the button (Reka's focus return), and the confirmation is announced from a live region
   on the screen — always in the DOM, never inside the dialog that just closed. The two
   lists are now the screen's single column on the `measure` (Members, then Pending): a
   roster row is one line read left to right, the tree's own §2.4 reasoning, and a 1216px
   row is the scanning problem the measure exists to solve. Measured and decided against
   two columns at `@2xl`: two lists of one-line rows side by side would each be ~490px in a
   1000px pane, and a pending row (icon · email · badge · expiry) wraps at that width.

**A tailwind-merge trap, recorded, not fixed.** While placing the section headline
(`title-small text-muted`, §9.2) it was verified with the installed `tailwind-merge@3.6.0`
that a project `--text-*` role inside a `:ui` slot override is read as a *colour* and
dropped against a neighbouring colour class — the same mechanism `app.config.ts` already
documents on `authForm.description`. Two existing sites are affected today:
`WorkspaceSwitcher.vue`'s `:ui="{ label: 'truncate text-title-medium text-highlighted' }"`
resolves to `truncate text-highlighted` (the room's name renders at the `sm` button's own
size, not the `title-medium` the comment above it intends — not re-measured here), and `AppShell.vue`'s
breadcrumb `link: 'text-label-large'` keeps the role and drops the library's link *colour*.
The central fix is `ui.tv.twMergeConfig` in `app.config.ts` (Nuxt UI's `tv` passes
`appConfig.ui.tv` to `createTV`), registering the `--text-*` roles as font-size classes —
one line, but it changes the rendered size of a control on every screen the owner reviewed,
so it is a ruling to make deliberately, not inside this batch. `ManagementSidebar` sidesteps
it by rendering the headline through the item's slot on an element of its own.

**Seen on the way, pre-existing.** On a first load of a workspace screen with no
`dw-workspace` cookie, the server renders the sidebar's "Choose a workspace" state (the
layout renders before the page's `AppShell` calls `useCurrentWorkspace().enter()`), the
client renders the named workspace, and Vue reports "Hydration completed but contains
mismatches" (text `Choose a workspace` vs `Workspace`, plus the node mismatches for the
switcher and the Members door). Nuxt also warns `[NUXT_E7006] Cookie dw-workspace was
previously set to null and is being overridden`. Harmless in effect — Vue patches — but it
is a hydration mismatch on the frame every screen stands in, and the mechanism predates
this branch: in the SSR pass the layout's sidebar renders before the page's `AppShell`
setup runs, and nothing re-renders on the server. Observed on this branch, not re-measured
on `main`. Not
fixed here; the fix is for the layout to learn the workspace from the route on the server
(`useCurrentWorkspace` seeded from `route.params.workspaceId` in `layouts/workspace.vue`)
rather than from the page's later `enter()`.

**Not done, deliberately.** The management sidebar names no `aria-label` of its own on the
pane (`role="navigation" aria-label="Workspace"` stays); the region inside is a nested
`nav` labelled "Management", which is how `e2e/management.spec.ts` finds it. The three
placeholder screens have no e2e of their own beyond the click-through in that spec.

**Verified.** See the branch's report; each stage run as its own process per the OOM note
under Known gaps.

---
### 2026-09-16 — The owner's three frame requests: the signed-out bounce, native confirms, edit mode's bar

Branch `feat/frame-review-shell`, one commit each; the Review Log entry of the same date in
`docs/UI-CHECKLIST.md` carries the measurements.

- **A 401 had no rule.** Four screens answered it with a card and a button that forgot where
  the person was; eight composables (`useTree`, `useWorkspaceActivity`, `usePageRead`,
  `useEditSession`, `usePageHistory`, `usePageDiff`, `useBookHistory`, `useBookDiff`) folded
  it into `network-error`, so a signed-out visit to any screen inside the frame said "Cannot
  reach the server" — false, and with a Retry that would 401 again. Now one composable,
  `useSignInRedirect` (`localReturnPath`, `signInPath`, `redirectWhenSignedOut`), and one
  query, `next`, read by `pages/login.vue`. The tree's own request is hooked too
  (`NavigationTree`), so the frame bounces even when the screen's composable has not resolved.
  `next` is read straight off the address bar: only a same-origin path passes, never `/login`,
  so a sign-in can never end on another site or loop. Vue Router leaves `/` unencoded in the
  query, so the address reads `/login?next=/workspaces`; `e2e/navigation.spec.ts` asserts
  through `searchParams`, not a literal.
- **`pages/[id]/diff.vue` rendered its loaded branch for any status it did not name.** A bare
  `v-else` read `diff!.from` off `null` for the new `unauthenticated` status on the way out.
  Now `v-else-if="diff"`. Worth a look on the other screens' last branches; none failed the
  same test, but a `v-else` that assumes success is the shape.
- **`UBreadcrumb` (Nuxt UI 4.11) has no overflow.** The generated theme
  (`apps/web/.nuxt/ui/breadcrumb.ts`) has no ellipsis slot and the component no collapse
  prop; the condensed bar's `…` is composed from the item slot and `UDropdownMenu`. If a
  later Nuxt UI ships one, replace the composition rather than keep two.
- **Reka's dialog returns focus to a trigger, and a promise-opened dialog has none.**
  `DialogContentModal` prevents `FocusScope`'s default restore and focuses
  `triggerElement`, which is `undefined` for `UModal v-model:open` with no trigger slot — so
  focus fell to `body` on close. `ConfirmDialog` reads `document.activeElement` when a
  question appears and restores it in `onCloseAutoFocus` (passed through `UModal`'s
  `content` prop), preventing the default so the two do not race. `ConfirmDialog.test.ts`
  holds it.
- **`useState` cannot carry the promise's resolver.** `useConfirm` keeps the question
  (serialisable) in `useState('dw-confirm')` and the resolver in a module-scope `Map` keyed
  by the question's id; a second question while one is pending answers the first with
  `false`.
- **The dialog headline is now central.** `app.config.ts` sets `UModal`'s `title` to
  `headline-small` (DESIGN-SYSTEM §2.3, "Chrome": 24px / 32px / 400); the description the
  library ships (`text-sm text-muted`) already is `body-medium`. The tree's New/Rename
  dialogs take it too — recorded so the change to those two unreviewed dialogs is a
  decision, not a side effect. Spelled as `text-2xl font-normal`, not `text-headline-small`:
  the first build shipped the token and the dialog rendered its headline at 16px semibold,
  because tailwind-merge reads a project `--text-*` role in a slot override as a colour and
  drops it — the caveat `app.config.ts` already documents on `authForm.description`, met
  again.
- **A dirty editor has a 300ms blind spot.** `EditorSurface` reports its document 300ms
  after the last keystroke, and `isDirty` is set from that report; a person who types and
  leaves within the window is not asked. `beforeunload` has the same window. The e2e waits
  for Save to enable before navigating; the product does not mark the buffer dirty on the
  first keystroke. Small, and the editor surface is another batch's — recorded, not fixed.
- **`e2e/editor.spec.ts`'s real-backend Save test races the same window.** It types and
  clicks Save; against a fast server the click landed inside the debounce once in four
  runs and the PUT carried the pre-edit document, so the reload read back the original.
  Pre-existing; it should wait for Save to enable the way the new dirty-editor test does.
  **Closed 2026-09-16** (`feat/editor-block-ui`): the test waits for Save to enable, and
  Save itself flushes the surface's pending report before it reads the buffer.
- **This host under six worktrees.** Load average 25–38 on 4 cores while this batch ran
  (`fb-editor`, `fb-comments`, `fb-manage`, `fb-perf1`, `fb-perf2`, `fb-tree` each with a dev
  server, typecheck or vitest up). Consequences seen: Playwright's 120s `webServer` timeout
  missed the dev server's first response (110s measured by hand), `e2e/auth.spec.ts`'s
  untouched tests timed out at `networkidle` on cold compiles, and `setupNuxt` exceeded
  vitest's 60s hook on files this batch did not touch (`useFocusMode.test.ts`). Every
  failure named in the report was re-run alone; what stayed red is listed there as
  environmental with the evidence. `bun run e2e` refuses to reuse a dev server one started
  by hand (the Nuxt lock preflight), so the runs here went through `playwright test
  --config playwright.config.ts` directly with the server up — the same command the script
  spawns after its preflight. Even so, a `nuxt dev` page load measured 29–35s to the
  editor surface under load (about a thousand module requests per navigation), against
  the suite's 30s waits, so the touched specs were finally run against a **production
  build served by `node .output/server/index.mjs`** on the suite's web port, with the API
  and database provisioned by the suite's own global setup as always: `editor.spec.ts`
  14/14, `navigation.spec.ts`, `auth-layout.spec.ts` and `auth.spec.ts` 53/53. The
  assertions are the same; what differs is that a page arrives in seconds. The full
  `apps/web` unit suite passed 702/702 with `--hookTimeout=300000 --maxWorkers=2` — the
  60s hook is the setup-under-load failure the 2026-09-06 review already recorded.

### 2026-09-15 — `ai-provider-foundation` integrated into `main`, 204 commits after its base

**What happened.** The branch (24 commits, base `ef94aab`, dated 2026-09-06) was merged onto
`main` at `48ffdab` as `1493381` on `merge/ai-provider-foundation`, in its own worktree. Twenty
paths conflicted; the merge message records each resolution. The non-textual work:

- **Migrations renumbered.** The 2026-09-06 Finding below predicted this exactly: the branch
  claimed `0008`–`0012`, `main` had taken `0008`–`0016`. The five AI migrations became
  `0017_ai_settings_and_credentials`, `0018_ai_usage_ledger`, `0019_ai_capability_observations`,
  `0020_embedding_indexes_and_chunks`, `0021_embedding_reindex_jobs` — files, `down/` files,
  `meta/_journal.json` entries (`idx` 17–21, `when` monotonic) and every reference in tests and
  doc comments. Their SQL depends only on `workspaces`, `users`, `plans`, `subject_kind`,
  `nodes_id_workspace_id_unique` and the `vector` extension, none of which `main` changed since the
  base, so no statement needed rewriting. Proven on a fresh database: `bun run db:migrate` applies
  `0000`→`0021` (22 rows in `drizzle.__drizzle_migrations`), and the five `down/` files applied in
  reverse leave exactly `main`'s table set, zero `ai_*`/`embedding_*` enum types and no
  `plans.max_ai_cost_micro_usd_monthly`.
- **`apps/api/src/index.ts`.** The branch's `composeApp()` (the composition root a test can drive
  through `app.request()`) was kept and widened rather than dropped: `AppAdapters` now carries
  `main`'s `mailDispatcher`, `presenceBroadcaster` and `presenceStreamRegistry`, `AppSettings` its
  `pageLockTtlSeconds`, `pageLockHeartbeatSeconds` and `changesetWindowMinutes`, and every one of
  `main`'s fourteen route modules is mounted inside it beside `createAiCredentialRoutes`.
  `index.test.ts` keeps all of `main`'s tests and adds the branch's composed-app credential test
  against the widened signature.
- **Checks.** `main`'s `core-purity` (static-specifier sweep plus forbidden globals) already
  covers the branch's raw-source scan (`eb98c21`), so the branch's implementation was dropped and
  its `type-only-imports` fixture and tests kept against `main`'s. `query-boundaries` is `main`'s
  six rules plus the branch's SDK-import and decryption boundaries as rules 7 and 8; the branch's
  hand-listed camelCase denylist entries collapsed into `main`'s snake_case-root derivation
  (`api_key`, `api_key_ciphertext` added as roots). `routes-mounted` — both sides wrote one
  independently — is `main`'s for script and test: a strict superset (arrow-const factories,
  comment/string stripping, whole-identifier matching, recursive collection), sharing the
  branch's header verbatim.
- **What no longer held on `main`.** `test-coverage` now covers every file per test and refuses
  type-only credit; ten branch files had no test naming them (`build-cipher`, the gateway's
  `errors`/`finish-reason`/`messages`, the two contracts schemas, and the four CLI wrappers) and
  gained one in the merge itself, because `.githooks/pre-commit` runs `bun run check` and a
  bypassed hook was not an option. The CLIs are driven as child processes and asserted on their
  refusals, not put on `ALLOW_LIST`. And `e2e/global-setup.ts` had to name the AI keyring for the
  spawned API (`4386666`) — `refineEnv()` requires it under the default driver, the same shape as
  `CHANGESET_WINDOW_MINUTES` before it; now guarded by `e2e-api-env.test.ts`, which holds the
  harness's env to `parseEnv()`.
- **`env.example`.** The `AI_KEK_*` block appended; `APP_URL` stays `3001` (the branch's `4173`
  was stale). `scripts/checks/env-example.ts` accepts `AI_KEK_KEYRING=dev:KioqKio…` as written:
  `KEYRING` is not one of its secret words (rule 3a keys on the last segment), and the value —
  base64 of 32 `*` bytes — matches none of rule 3c's credential shapes. Stated so nobody assumes
  the check vetted it: it is an obvious placeholder by inspection, not by mechanism. An empty
  keyring was not an option, because `AI_KEK_DRIVER` defaults to `env` and a fresh clone must boot.

**Verified, each stage its own process** (`bun run verify` chained is OOM-killed on this
machine): `bun run check` 11/11; `bun run typecheck` 0 errors; `bun run lint` 0; `bun run test`
2631 passing across every member plus `scripts/checks` (db 422, api 358, web 645, core 124,
contracts 141, markdown 325, editor 318, landing 5, checks 293), 0 failing;
`bun run gate-2-round-trip` 168/168; `bun run e2e` 115 passed in 10.4 minutes. One environment
note: the first `bun run test` on a worktree whose harness containers do not yet exist lost the
race between `packages/db` and `apps/api` both running `podman compose up` for the same project
(exit 125, containers left `Created`) — `bun run --filter '*' test` runs members in parallel and
`podman-compose` is unsafe under concurrent invocation (RUNNING.md §6). Bringing the stacks up
once by hand, then rerunning, was green; the main checkout never sees this because its containers
have been up for days.

### 2026-09-15 — Document-level overflow checks are blind inside the frame

**What happened.** `f2fe61b` (`e2e/onboarding.spec.ts`) found that
`document.documentElement.scrollWidth` never grows inside the workspace
frame: `UDashboardPanel`'s generated body carries `overflow-y-auto`, and per
the CSS spec a non-`visible` `overflow-y` on an element whose `overflow-x` is
`visible` computes that axis to `auto` too — so the `[data-slot="body"]`
ancestor of `#content-main`, not `document.documentElement`, is the real
horizontal scroll container an overflowing screen clips into. A pane can
overflow by hundreds of pixels while the document-level number reads exactly
equal to the viewport. `f2fe61b` fixed this for the members screen only;
every other frame screen's "nothing scrolls sideways at 320" assertion still
measured just the document — tests passing for the wrong reason, the class
this file already tracks.

**The fix.** `e2e/overflow.ts` (new): `measureOverflow(page)` reads both the
document and the pane; `expectNoHorizontalOverflow(page, label)` asserts
both, with messages that print the numbers. Proven with a red test first, in
`e2e/frame.spec.ts`: a 600px div injected into `#content-main` at 320x900
leaves the document check blind —
`document.documentElement.scrollWidth === innerWidth` still held — while
`expectNoHorizontalOverflow` rejected, quoting `the content pane scrolls
sideways: scrollWidth 616 vs clientWidth 320`. Migrated every document-only
"no horizontal scroll at 320" assertion onto the helper: `e2e/frame.spec.ts`,
`e2e/diff.spec.ts`, `e2e/history.spec.ts`, `e2e/read.spec.ts`,
`e2e/editor.spec.ts`. Each spec's element-level checks (the contextual bar's
own `scrollWidth`/`clientWidth`, the breadcrumb's clipped-crumb check) were
left as they were — those never had the document's blind spot.
`e2e/auth-layout.spec.ts` was checked and left alone: `AuthShell` renders no
`UDashboardPanel` (no header, no footer, no dashboard body), so
`document.documentElement`/`document.body` genuinely is the scroll
container there.

**Verified.** `bun run check` 11/11 (`e2e/overflow.ts` is value-imported by
five specs with assertions, satisfying `test-coverage.ts`'s per-file rule),
`bun run typecheck` 0 errors, `bun run lint` 0, and
`bun run e2e -- e2e/frame.spec.ts e2e/read.spec.ts e2e/editor.spec.ts e2e/history.spec.ts e2e/diff.spec.ts e2e/onboarding.spec.ts`
55/55 passing — including the new red test. **No real pane-level overflow
turned up on any migrated screen**: every screen that previously passed the
document-only check also passes the pane check now, so this batch is a test
fix with no accompanying `fix(web)` commit.

---

### 2026-09-15 — Members, the chooser, book history and diff, edit mode, and page history and diff move onto the frame

**What happened.** The six document-page screens the two entries below left outside
`layouts/workspace.vue` ("only the dashboard and the read page were migrated") are in, each
its own commit:

- **Members** (`8fe04ef`) opts in. The breadcrumb now carries the workspace's name, so the
  hand-written eyebrow and the "Workspace home" button are gone and the heading is a bare
  `<h1>` — the same contract read mode's `PageHeading :heading="title"` keeps. The invite
  form, its pending list and the roster take the *pane's* width as columns (`@container`, the
  dashboard's own rule): stacked narrow, the invite form beside the roster from `@2xl`, so the
  layout holds with the sidebar open, closed or resized. `e2e/onboarding.spec.ts`'s
  workspace-name assertion moved from `<main>` to the breadcrumb, which is where the name lives now.
- **The workspaces list becomes a chooser** (`84337d3`). Now that `/` opens onto the last
  workspace (previous entry), `/workspaces` is reached only when there is none yet, or by
  choice from the switcher's "All workspaces". Its job flipped from reading to choosing: "New
  workspace" is now the screen's one Filled button (`docs/DESIGN-SYSTEM.md` §9.1), not an
  outline meant not to compete with the rows. No last-activity signal on each row —
  `GET /workspaces/:id/activity` is per-workspace, and adding one to every row would be an
  N+1 this screen does not pay for a nice-to-have.
- **`/admin/registration` deliberately stays in the document frame** (`2a26cfe`, comment only,
  no behavioural change): registration is an instance setting, orthogonal to "one workspace at
  a time", and its heaviest user — the Super Root — may hold no workspace at all.
- **Book history and book diff** (`8a5673d`, screenshots and e2e in `25c23ba`). The frame's own
  breadcrumb now carries "workspace / shelf / book / History" and "... / History / Changes
  since `<date>`", so the hand-built "Workspace home" and "Back to history" buttons are gone —
  the breadcrumb's own crumbs are the links — and `PageHeading` is replaced by a single
  `sr-only` `<h1>` per screen. History gains "Compare since…" in the contextual bar; diff's page
  switcher (previous / current name / next) moves from the pane into the bar, wired to
  `buildTreeOrderIndex` (`940cfb4`) so the switcher's order matches the sidebar's tree instead
  of `GET /books/:id/diff`'s random `page_id` order (see "The book diff's happy path passed on
  a coin toss" below) — a client-side stand-in; **the server should order instead**, unresolved.
- **Edit mode** (`b5a7f55`). The tree survives Read → Edit → Read; the breadcrumb ends in the
  page and an "Editing" crumb; the contextual bar carries the presence chip, "Read page" and
  Save. **This closes the 16px read/edit column step** `docs/UI-CHECKLIST.md`'s 2026-09-07
  review recorded (x=310.5 read vs. x=326.5 edit): both modes now stand on the frame's
  `bg-default` pane, so the editor's own canvas is the same tone as its ground, and the
  article and the editor's first paragraph measure identical in x, width and y
  (`e2e/editor.spec.ts`). Closure recorded in `docs/UI-CHECKLIST.md`'s Review Log and
  `docs/DESIGN-SYSTEM.md` §14.
- **Page history and page diff** (`613e274`). Same breadcrumb treatment; the bar carries "Read
  page" (history) and "Back to history" (diff). The revision pair being compared moved out of
  the bar and into a caption above the block list — at 1280 with the 280px sidebar, two zoned
  timestamps beside "Back to history" left the breadcrumb 400px short and it truncated to
  "E2E Wor... > His... > Com...", the identity the bar exists to show.
- Two test-infrastructure fixes surfaced while migrating (`2b1658c`): `last-workspace`
  middleware now reads the `dw-workspace` cookie directly (`rememberedWorkspaceId()`) rather
  than through `useCurrentWorkspace`'s shared state, which in the test environment is
  initialised once, before any test sets a cookie; and three screen tests (edit, members,
  book history) that took the page's first `role="status"` as their own notice are now scoped
  to `main`, because the contextual bar's sidebar-toggle live region now precedes it.
  `162c470` separately fixed an `e2e/frame.spec.ts` flake under a shared workspace (a tree long
  enough to put the clicked row above the fold) and a race in the drawer's animation wait.
- `b9680dd` moved the presence e2e's locator from `getByRole('status')` to
  `data-testid="presence-indicator"`, for the same reason as `2b1658c`'s `main`-scoping: the
  sidebar toggle's own live region now also matches `role="status"`, so counting them by role
  stopped measuring what the assertion's name claimed — the same shape as the 2026-09-08
  centring-test finding this file already carries.

**Full verification, on `b9680dd`, run as separate stages** (`bun run verify` chained is
killed for memory on this machine — see Known gaps, below): `bun run check` 11/11,
`bun run typecheck` 0 errors, `bun run lint` 0, `bun run test` 2384 passing,
`gate-2-round-trip` 168/168, `bun run e2e` 111/111.

**Found on the way, fixed here.** `docs/DESIGN-SYSTEM.md`'s change-log table carried two stray
lines — a literal `</content>` and `</invoke>` — sitting inside the 2026-09-14/2026-09-15 rows,
apparently pasted in from a tool transcript rather than written. Removed; no row's content was
lost, only the two extraneous lines between them.

**What this leaves open, on purpose.**

- **Known 320px defect on members: the invite card overflows.** Not yet fixed; see
  `docs/UI-CHECKLIST.md`'s Review Log entry for this batch.
- **The book-diff page order is still a client-side stand-in** (`940cfb4`); `GET /books/:id/diff`
  itself should order by tree position, and the 2026-09-14 Finding on the point stands
  unresolved.
- All six owner-review gates (10.2, 10.4, 10.6, 10.8, 10.10, 10.12 in
  `openspec/changes/versioning-and-collaboration/tasks.md`) are still open; this batch adds no
  ticks. Phase 3 sits at **88 of 97 tasks ticked**, unchanged by this batch — the six gates
  remain the long pole to 11.4/11.5.
- **`packages/db/seed.ts` still prints a dead URL.** Its `tree:` line
  (`console.log(\`  tree:  /workspaces/${workspace.workspaceId}/tree\`)`) advertises
  `/workspaces/<uuid>/tree`, the frontend page route this batch's predecessor deleted; the
  workspace's tree now lives in the sidebar at `/workspaces/<uuid>` (the dashboard). Fixed the same
  day: the seed now prints `open:  /workspaces/<uuid>`, and the two `packages/db` header comments
  that still named the route (`readable-workspaces.ts`, `list-readable-workspaces.ts`) follow it.

---

### 2026-09-15 — The frame is mounted once; focus mode; the comments toggle; `/` reopens the room

**What happened.** The owner passed the workspace frame ("ha mejorado mucho la UI y UX… más
profesional") with two requests — a sidebar toggle "para poder tener una interacción más limpia
con el documento", and the same for the comments — and the batch also cleared the structural
debt the frame's own report flagged. Four things shipped, each its own commit:

- **The frame is mounted once.** `layouts/workspace.vue` mounts `WorkspaceFrame`
  (`UDashboardGroup`, the skip link, `WorkspaceSidebar`) once and provides a context
  (`useWorkspaceFrame`); a screen opts in with `definePageMeta({ layout: 'workspace' })` and
  its `AppShell` renders only the content pane, handing the frame the node it is about. A
  screen that has not opted in gets the same `WorkspaceFrame` from `AppShell` per route, so
  `AppShell`'s props and slots are unchanged — opting in is one line. The dashboard and the
  read page are in; **edit, history, diff, members, book history and book diff are not yet**
  and still rebuild the sidebar per route. `e2e/frame.spec.ts` proves the claim the way a
  component test cannot: after a click on a tree row the sidebar is the same DOM node, and
  the tree keeps its scroll offset and a fold. There is deliberately no `layouts/default.vue`.
- **`/` opens onto the last workspace** (Obsidian reopens the last vault). `useCurrentWorkspace`
  writes a cookie (`dw-workspace`, one year, SameSite=Lax) and initialises from it; the
  `last-workspace` middleware routes `/` on the server, so the list never flashes by. A cookie
  rather than storage because the decision is made before any screen renders. It is the
  browser's, not the account's — the same scope as the sidebar width — and a remembered
  workspace the next person cannot open lands on the dashboard's own "does not exist" state.
- **Focus mode.** The sidebar hides to nothing, not a rail: `WorkspaceSidebar` is `collapsible`
  bound to `useFocusMode`, Nuxt UI persists the collapse beside the width in
  `dw-frame-sidebar-workspace`, and the root is hidden outright from `lg` up while collapsed
  (the library's collapse leaves a `min-w-16` rail). `SidebarToggle` stands at the sidebar's
  edge of the contextual bar: name + tooltip, a live region that names the keys, and
  `Ctrl`/`⌘`+`\` — Notion's binding and the default Obsidian's users ask for (Obsidian ships
  it unbound; `Ctrl+B`, VS Code's, is bold in an editor). Focus that was in the sidebar moves
  to the content bar. Below `lg` the drawer is unchanged.
- **The comments toggle.** `useCommentsVisibility` (cookie `dw-comments`) hides the marks, the
  panel and the "not placed yet" chip; the orphan chip stays. It changes nothing about what
  is fetched — `GET /pages/:id/comments` runs on every read — and nothing a read-only caller
  sees: the toggle is offered only when there are threads, and `e2e/read.spec.ts` drives a
  reader with both cookie values. While hidden, the toggle counts the open threads on the page
  that mention the caller (`usePageMentions`, read off `GET /workspaces/:id/activity`'s
  `mentionsYou`, asked for only in that state), in its name and as a `UChip` badge.

**What this leaves open, on purpose.**

- **A user with no display name renders as "Someone" with a `?` avatar** in Recent changes.
  Decision: display name should be required at registration — `PRODUCT.md` says a mixed team,
  and "Someone" is a hole in the team's pulse. That is an API and registration-screen change
  (`POST /auth/register`, the invitation-accept form) for the next batch; not done here.
- **The contextual (third) pane is still an overlay.** The thread panel remains a `USlideover`;
  §6's third pane at ≥1280 is not built.
- **The mention count can under-report on a busy workspace.** `GET /workspaces/:id/activity`
  caps threads at twenty across the workspace; a page's mentions beyond that are not counted.
  A `mentionsYou` on the comments response itself would remove the cap and the second request,
  and needs the API to know the caller's display name at that route.
- **The sidebar's resize handle is pointer-only** (`UDashboardResizeHandle`, `role="separator"`
  without a tab stop). Pre-existing since the first frame batch; §5 asks for a stated keyboard
  equivalent. Double-click resets the width; nothing sets it by keyboard.
- **The contextual bar's live region moved a test.** `edit.test.ts` grabbed the first
  `[role="status"][aria-live="polite"]` on the page; the sidebar toggle's announcement now
  precedes the save banner, so the three selectors are scoped to `main`. Any screen test that
  counts live regions globally will meet the same thing.
- **Below `sm` the breadcrumb shows the last crumb only.** At 320 the bar holds the drawer
  toggle, up to four controls and the breadcrumb, and the workspace crumb rendered as "E."
  (clipped text, §6). The ancestors stay `sr-only`; the workspace is one tap away in the
  drawer. `e2e` does not measure it; the 320 screenshot in the review material shows it.
- **Two-icon-pack requirement (§4.3)** still untested; only `lucide` is installed.

---

### 2026-09-15 — The app frame was a document page, and the tree screen is gone

**What happened.** Every screen was built as a document page — a centred 72ch column, a
`PageHeading`, a card — and that model was applied to the app frame, so the workspace's
tree was a card in the middle of a wide viewport, the app bar was a global strip that
accumulated "Book history: A B C" links wrapping onto two lines, and `/` led to a list of
workspaces rather than into one. The owner rejected it on sight. The frame is now the
workspace frame (`AppShell` with a `workspace-id`): a persistent sidebar (`WorkspaceSidebar`
— switcher, `NavigationTree`, doors), a content pane, and a contextual top bar (breadcrumb +
the screen's own `header-end` actions), built on Nuxt UI's `UDashboard*` set exactly as
`docs/DESIGN-SYSTEM.md` §8.3 prescribed and nobody had built. The workspace root
`/workspaces/:id` is a dashboard — `GET /workspaces/:id/activity` (new) plus the
workspace-wide presence stream — and **`/workspaces/:id/tree` no longer exists**: the tree is
the sidebar, on every screen. Links that pointed at it now point at the workspace root.

**What this leaves open, on purpose.**

- **Every route still mounts its own `AppShell`.** The tree, the fold state, the selection
  and the workspace directory live in `useState` (`useWorkspaceTree`,
  `useWorkspaceDirectory`, `useCurrentWorkspace`) so a navigation inside the workspace
  shows the loaded tree at once and refreshes behind it — but the sidebar's DOM is still
  rebuilt per route, so its scroll position resets and a resize-drag mid-navigation is
  lost. The full fix is a Nuxt layout that mounts the frame once; that changes how all
  thirteen screens compose and is the next batch's, not this one's.
- **Only the dashboard and the read page were migrated.** Edit, history, diff, members,
  book history and book diff render inside the frame (their `header-end` moved into the
  contextual bar; page history and page diff learn no workspace from their responses and
  stand on the last one the person was in) but keep their document-page layouts.
- **There is no sign-out in the sidebar's footer** because there is no sign-out (PRODUCT.md,
  "Not yet"). The footer holds Members, Registration settings and the theme toggle.
- **"Threads for you" matches `@<display name>` as plain text.** Comments carry no
  structured mentions; the dashboard says "Names you" and the API documents the convention.
  A structured mention model would replace the `strpos` in `listOpenThreadsForUser`.
- **`/` still redirects to the workspace list**, not to the last workspace the person was
  in. Obsidian reopens the last vault; doing that here needs the current workspace
  persisted beyond `useState`.
- **`BookDiffBlockChanges.vue` carries `border-l-4` accents** (the impeccable detector's
  one finding across `apps/web/app/components`, lines 123 and 138). Not this batch's
  screen; recorded for the diff screen's own review.
- **The keyboard path to a screen's actions now crosses the sidebar.** A "Skip to content"
  link is the frame's first tab stop and focuses the contextual bar; measured in
  `e2e/history.spec.ts` (skip → breadcrumb → history → Edit).

---

### 2026-09-14 — The edit screen's e2e mocked the one endpoint the bug lived behind, and two more tests that could not see what they named

**What happened.** "Edit mode cannot save an existing page from a browser" was reachable from
`/pages/:id/edit` on `main` while `e2e/editor.spec.ts` — thirteen tests, "includes
edit-session/lock/take-over behind can()" by its own header — stayed green. It stayed green
because the spec answers `GET /pages/:id/edit-session` itself: `page.route(\`${apiOrigin()}/pages/${PAGE_ID}/edit-session\`, …)`
at four sites (lines 55, 98, 136, 200 at the time of writing), and three more in
`e2e/presence.spec.ts`. The browser never asked the real API for the one response the save
path is built from, so the suite proved the screen against the fixture it wrote, not against
the server it ships with. The fix to the save bug is a sibling agent's, in `apps/**` and
`e2e/**`, and is recorded there; this entry is about the test. It is the **twenty-third
recorded instance** of a test passing for a reason unrelated to its name.

**Two more of the same class, the same day, neither numbered because each is a smaller cut of
the same shape.**

- *`app.request()` never preflights.* `PATCH` was missing from the CORS `allowMethods` list in
  `apps/api/src/index.ts`, so in a real browser the lock heartbeat, node rename and reorder,
  and thread resolution were all refused at the preflight — while every route test passed,
  because Hono's in-process `app.request()` sends the request and nothing before it. Commit
  `a4bec8c` adds the method and a test that sends the `OPTIONS` a browser sends, with
  `Access-Control-Request-Method: PATCH`, and asserts the answer lists it. Verified today
  against a running API: `204`, `GET,POST,PUT,PATCH,DELETE,OPTIONS`.
- *The book diff's happy path passed on a coin toss.* `GET /books/:id/diff` lists changed
  pages in `SELECT DISTINCT` order over `page_id` (`packages/db/src/changesets/book-diff.ts`,
  no `ORDER BY`), the seed mints those ids at random, and `e2e/book-history.spec.ts` asserted
  that "Alpha" came first. Commit `741ceb9` reads the focused page's title off the screen and
  asserts that page's own content, then drives Next and Previous against the other one.

**Impact.** An e2e spec may stub a route only when the spec is *about* the stubbed failure
(a 500, a network drop) and says so beside the stub; a spec named for a feature must reach
that feature's endpoints on the real backend the harness already provisions —
`e2e/comments.spec.ts` (commit `f4f9c3b`) is the shape to copy. A CORS claim is proved by an
`OPTIONS` request, never by a route test. A test that depends on server-side order must
either read the order off the response or the screen, or the route must declare an
`ORDER BY` — the route still does not, and that is recorded below under "seen on the way".

### 2026-09-14 — Four ways one agent erased another's work on a shared tree, and four environment quirks that read as application bugs

Several agents worked the same checkout in one session. These are the incidents, each with
the rule it earned. They are now in `docs/RUNNING.md` §7 and `CLAUDE.md`'s non-negotiables.

1. **`pkill` on a broad pattern — three incidents.** Three times in one session a
   `pkill -f <pattern>` matched a process the agent had not started — another agent's dev
   server or test run, or another project's on this host (the `nuxt dev` case was already a
   warning in `docs/RUNNING.md`) — and killed it mid-run. Rule: never kill a process you did
   not start. Find the listener with `ss -ltnp | grep :<port>` and kill that pid, or the pid
   you recorded when you spawned it. And the older finding still applies: killing the
   `bun run -F` wrapper leaves the real server running — measured again today, the wrapper
   died and `nuxt dev` (reparented to pid 1) kept port 3001.
2. **`git add -A`, and `git add` on a shared barrel.** `-A` staged another agent's
   half-written files into a commit whose message described none of them. The subtler one:
   adding a package's `src/index.ts` staged a sibling's hunk in the same barrel file,
   because a barrel is the one file every change in a package touches. Rule: `git add` the
   paths you changed, run `git diff --cached` before every commit and read it, and if a
   shared file carries hunks that are not yours, `git add -p` it.
3. **`git stash` on a shared tree.** One agent stashed "its" changes to get a clean tree;
   the stash took every uncommitted change in the checkout, including a sibling's completed
   task, which was then lost when the stash was dropped. One full task, rewritten from
   scratch. Rule: never `git stash` on a tree you do not own alone. If you need a clean
   tree, you need your own worktree.
4. **Backticks in `git commit -m`.** A message that quoted a command in backticks was
   passed in double quotes; the shell substituted it, and the quoted command was the e2e
   suite — a full Playwright run started as a side effect of committing. Rule:
   `git commit -F <file>`, always — the message is a document, not an argument.

The environment quirks, each verified against the tree or by running it today:

- **One `nuxt dev` per checkout.** Nuxt's lock is `apps/web/.nuxt/nuxt.lock`, keyed by
  checkout, not by port, so `DEEPWIKI_TEST_SLOT` — which moves every *port* the harness uses —
  cannot route around it (`scripts/e2e.ts`, `checkNuxtLock()`, commit `26fd09e`). A second
  dev server, or a second `bun run e2e`, in the same checkout needs a second worktree.
- **`podman compose up --wait`'s exit code is not the health signal.** A sibling observed
  exit `125` with every container healthy; the 2026-09-06 finding below observed `0`; the
  bring-up run for `docs/RUNNING.md` today observed `0`. Read `podman ps` for `(healthy)`
  and do not gate a script on the exit code alone.
- **`expect(sql\`…\`).rejects` hangs `bun test`.** A postgres.js query is a thenable, not a
  native Promise, and Bun's `.rejects` never settles on it. `packages/db/src/schema.test.ts`
  carries `assertRejects()` (plain `try`/`await`/`catch`) for exactly this; use it, and treat
  a `bun test` that never finishes as this before treating it as a deadlock in the code.
- **`bun test` does not typecheck.** `e2e/global-setup.ts`'s `SeedResult` was missing every
  onboarding and book-history field the seed actually printed and every test passed,
  because the values were spread untyped into `JSON.stringify` (commit `95b4e73`). `bun run typecheck` is a separate gate
  and a green `bun test` says nothing about types; the fix added a type-level test that
  fails to *compile* when the two shapes drift.

**Impact.** The four rules are non-negotiable for any agent or person on a shared checkout,
and the cost of each was a sibling's work, not the offender's — which is why a rule is the
only fix: nothing in the tooling can tell a process or a hunk you own from one you do not.

### 2026-09-14 — `PORT` in the environment moves `nuxt dev` off `devServer.port`

**What happened.** Running the documented bring-up for `docs/RUNNING.md` on a private
stack, `bun --env-file=<env> run -F @deep-wiki/web dev` — the same `--env-file` form the API
command uses — did not start on 3001. Nuxt logged `[get-port] Unable to find an available
port (tried 14606 on host "localhost"). Using alternative port 3000.`: `14606` was that
env's `PORT`, the *API's* port, and it was busy because the API was on it. Nuxt reads `PORT`
from the environment ahead of `devServer.port` in `nuxt.config.ts`. With the shipped
`env.example` (`PORT=3000`) the same command puts the web server on 3000 if the API is not
yet up, or on a random free port if it is — and either way `APP_URL=http://localhost:3001`
no longer names the page's origin, which is the CORS sign-in failure of 2026-09-09 all over
again, by a different door. Run as documented — `bun run -F @deep-wiki/web dev`, no
`--env-file`, `PORT` not exported — it listened on 3001 and `/login` answered 200.

**Impact.** `docs/RUNNING.md` §1 now says why the two terminal commands differ in shape: the
API needs the file, the web server must not see it. `bun run env:check` cannot catch this —
it compares `.env` to `nuxt.config.ts`, and the mismatch is created at launch, not in
either file.

### 2026-09-14 — 81 `dw_test_*` databases leaked because a seed-only guard ran before `--drop` was read

**What happened.** `e2e/seed.bun.ts` validated `CHANGESET_WINDOW_MINUTES` at module level,
before `main()` looked at its arguments. `--drop` never calls `savePage()` and so never
needs the value, and `global-setup.ts`'s teardown never sets it — so every e2e run's
teardown threw before dropping anything, and the per-run database stayed behind. Found as
**81 leaked `dw_test_*` databases** on the local harness Postgres (port 55432); dropped after
the fix was verified. Commit `e9a1c78` moves the requirement to the seed path only,
threaded through `seedFixtures()` as a parameter, and adds
`scripts/checks/__tests__/e2e-seed-drop.test.ts`.

**Impact.** A script that dispatches on a mode must validate per mode, after dispatch. An
import-time guard is a guard on every mode, including the one that exists to clean up — and
a cleanup that fails quietly is how a disposable resource becomes permanent. The count
above is the measure of "quietly": 81 runs, no failure anyone read.

### 2026-09-14 — An optional `changesetWindowMinutes` was a save that silently skipped its changeset

**What happened.** `SavePageInput.changesetWindowMinutes` was `?: number`, and
`writeRevision()` skipped changeset resolution entirely when it was `undefined` — no error,
no log, a `page_revision` with no `changeset` behind it, invisible to `GET /books/:id/history`.
The deviation that made it optional was justified by "49 call sites"; the real count when it
was made required was **125 call sites** (10 production, 115 test — commit `8c89a06`), and
the type is now `readonly changesetWindowMinutes: number` in
`packages/db/src/content/save-page.ts`. `packages/db/testing/provision.ts` exports
`TEST_CHANGESET_WINDOW_MINUTES` so tests state the value once.

**Impact.** A value the save transaction needs is a required field, and the cost of making
it required is paid once at the call sites; the cost of leaving it optional is paid by every
book history that quietly omits a revision. And a count used to justify a shortcut is a
claim like any other: measure it, do not carry it.

### 2026-09-14 — A workspace could exist with no admin, `POST /invitations` answered whether a workspace existed, and nobody the product creates can create a workspace

**Three defects on the same route family, found while building the new-workspace and members
screens.**

1. **`createWorkspace()` never granted the creator `manage`.** The grant lived in
   `packages/db/seed.ts`, written *after* the call — so any other caller produced a
   workspace nobody could manage. Commit `17aed6c` writes the grant inside the same
   transaction through `insertGrants`, and a test proves `can(creator, manage, root)`
   immediately after creation against a stranger the same resolver denies.
2. **`POST /invitations` was an existence oracle.** A workspace that did not exist and a
   workspace the caller could not manage answered differently. Commit `dcc9766` routes both
   through one `notFound(c)` — `404 { error: 'not found' }` — from one call site, so the
   two are indistinguishable, the property the 2026-09-08 finding below made the rule.
3. **A user without a plan cannot create a workspace, and nothing assigns one.**
   `createWorkspace` joins `plans` on `users.plan_id` and throws `NoPlanAssignedError`
   (`403 { reason: 'no_plan' }` from `POST /workspaces`) when the row is null. Self-
   registration and invitation acceptance both `INSERT INTO users` without `plan_id`
   (`packages/db/src/auth/invitations.ts`); only the two seed scripts set it. So every
   account the product itself creates is refused at the one screen that creates a
   workspace, with a message that states the fact — and there is no admin route to change
   it, because the Super Root plan-authoring route is the Phase 1 bullet still unticked.

**Impact.** (1) and (2) are fixed. (3) is a product decision and goes to Open Questions:
`docs/SPECS.md` §2 makes plans the Super Root's to author, and it says nothing about what a
new account gets by default. Until that is answered, the new-workspace screen is reachable
only by a seeded account, and the refusal is the honest state.

### 2026-09-14 — The client cannot learn `manage` or `is_super_root`, so two links render for everyone and the destination refuses

**What happened.** Two new entry points shipped: a **Members** link on the navigation tree
(`apps/web/app/pages/workspaces/[workspaceId]/tree.vue`) and a **Registration settings**
link in the app chrome (`AppShell.vue`). Both are meant to be gated — `manage` on the
workspace root, `is_super_root` on the user — and both render unconditionally, because no
response the client holds carries either fact: there is no `capabilities` field on any
response, no `is_super_root` anywhere outside `apps/api/src/routes/admin.ts`, and no
`GET /me`. The code says so at both sites ("a deliberate fallback, not a permission
check"). The destination screens gate instead: `/admin/registration` on the API's `403`
(`useInstanceSettings.ts`), and `/workspaces/:id/members` on the API's deliberately
ambiguous `404` — `GET /workspaces/:id/members` answers "no such workspace" and "not yours
to manage" identically, so the members screen shows its not-found state to a member without
`manage`, and cannot show anything more honest.

**Impact.** Open Question: which signal to add. A `capabilities` object on the responses a
screen already fetches (`GET /workspaces`, `GET /pages/:id`) keeps one request and keeps
non-disclosure — the server decides per resource what to name; a `GET /me` carrying
`is_super_root` is one request for a global fact. Both are cheap; neither is decided, and
until one is, every screen that reaches a gated destination must degrade the way these two
do — reach it, and let the server refuse — rather than guess.

### 2026-09-14 — Tonal fills measured 1.00–1.09:1 against their own containers; every tonal control now carries an outline-role ring

**What happened.** The cross-screen audit measured Nuxt UI's `variant="soft"` at **1.02:1**
on a `PageNotice`, **1.09:1** on the app bar and **1.00:1** as a diff badge on its own
container row — a chip painted the same tone as the row it sits on is not a chip, it is
text. The cause is structural: M3's filled-tonal container (`secondary-container`) and this
project's container rungs (§1.4's ladder) are drawn from the same tone band, so wherever a
tonal control lands on a container it disappears. Commit `d41ae67` fixes it once, in
`apps/web/app/app.config.ts`: `TONAL_BOUNDARY = 'ring ring-inset'` and
`tonalFill(color) = bg-{color}-container text-on-{color}-container ring ring-inset ring-{color}`,
applied to `soft` and `subtle` on `UButton` and `UBadge`. Measured from the tone tables: the
ring is ≥ 4.47:1 against the fill and against every surface, both themes, every alias.

**Impact.** Recorded as a deviation in `docs/DESIGN-SYSTEM.md` §9.1 and §9.7 and change-logged
in §14: M3's filled tonal button has no outline, and this project's does. The alternative —
a tonal rung that is never a container rung — would cost a sixth surface level §1.4 forbids.

### 2026-09-14 — Five notice shapes in nineteen hand-rolled copies, now three tiers in one file

**What happened.** The same audit counted five distinct notice shapes across nineteen
hand-rolled copies on the auth, read and edit screens. Commit `861afa0` states the tiers once
in `apps/web/app/components/InlineNotice.vue`: **panel** (`PageNotice`, replaces a screen's
content — denied, missing, locked, empty, failed), **bar** (`InlineNotice tier="bar"`, stands
in for or beside a form — a result, a dead link, a refusal, with an opt-in focus move), and
**chip** (`InlineNotice tier="chip"`, one line about the thing directly below it, at most one
action). Edit mode's six save banners and the editor's mention-mismatch line moved to the
chip tier. Today `<InlineNotice` appears at 25 sites in `apps/web/app`; the nineteen were the
copies it replaced.

**Impact.** `docs/DESIGN-SYSTEM.md` §14 change-logs the tiers. A notice that fits none of
the three is a design question, not a fourth `div`.

### 2026-09-14 — `ContentStore` followed `BlockRegistry` out, a block is top-level only, and one of the tombstone follow-ups is still open

**Closing the loose ends of the tombstone finding below.**

- **`ContentStore` deleted** (commit `cb467e5`), for the reason the finding gave for
  `BlockRegistry`: a port with zero implementers, tested only by a stub in its own test
  file. `rg "BlockRegistry|ContentStore" packages apps` now finds comments only. The
  category stands: a port in `packages/core` earns a contract test when an adapter
  implements it, and a stub-only port is deleted, not carried.
- **A block is a top-level child, and both walkers say so** (commit `1d0a325`).
  `buildBlockIndex` walked the whole tree with `visit()` and found a `^id` on a list item;
  `sliceBlocks` walked `tree.children` and never saw it, so the anchor landed in
  `page_content.block_index` with no `page_blocks` row behind it — the double-record the
  earlier entry saw on the way. Both now share `topLevelBlocks()` in
  `packages/markdown/src/blocks.ts`, and a regression test proves a list-item anchor
  produces no index entry. Consequence: the `listItem` case in
  `extensions/block-anchor.ts`'s `findBlockAnchor` is unreachable from either indexer. It
  is *not* dead — `applyBlockAnchors` and `markCaretsForEscaping` still `visit()` the whole
  tree so a list-item `^id` round-trips byte-for-byte — but it is a branch the registry
  never takes, and a reader who assumes otherwise will look for a row that cannot exist.
- **`PUT /pages/:id` now answers a reintroduced dead anchor with `409` and `corrected`**
  (commit `40f9844`, `apps/api/src/routes/pages.ts`), and the edit screen no longer reports
  it as a stale save (`87979d5`). Done.
- ~~**Still open:** `mintAnchorAtBlock` in `apps/api/src/routes/comments.ts` is called with
  the markdown and the block id only — it does not receive the page's full id set as
  `reservedIds`, so the comment-creation mint path can still collide with a tombstoned or
  superseded id by chance. The refusal in `savePage` would then reject the comment's own
  save with a `DeadAnchorError` the comment route does not catch. Follow-up, `apps/api`.~~
  **Closed 2026-09-16:** the route passes the page's full `page_blocks` id set; see the
  Finding of that date.

**Impact.** As the tombstone entry states, plus: when a finding lists follow-ups, the next
entry says which ones closed and which did not, by commit — otherwise "recorded here rather
than acted on" reads as done a week later.

### 2026-09-14 — Seen on the way, not fixed

Small facts an audit or a build surfaced that nobody has acted on. Each is real today;
none is a decision.

- **The indicators endpoint has no client.** `GET /pages/:id/comments/indicators` counts
  `anchored` roots only. The read screen fetches `GET /pages/:id/comments` once and derives
  its own indicators, because orphaned threads would be invisible to the endpoint
  (`usePageComments.ts`, and the comment there says so). The route is tested and mounted
  and nothing calls it.
- **`GET /books/:id/diff` orders pages by uuid, by accident.** `SELECT DISTINCT pr.page_id`
  with no `ORDER BY` (`packages/db/src/changesets/book-diff.ts`). Postgres sorts to
  de-duplicate, so the order is by id in practice and by nothing in contract. A reader
  navigating "changed pages" sees them in a random-looking order; the route should declare
  one (position in the book, or title).
- **The app bar wraps the brand at 320px with four controls.** The read screen's own
  comment measures three controls beside the brand at 320×900 with "no headroom for a
  fourth"; the Registration settings link (`541856f`) is the fourth. The measurement in
  the comment predates it and is stale.
- **The tree skeleton omits the toolbar row.** `tree.vue`'s loading state is four bars; the
  loaded state has a `NavigationTreeActions` toolbar above the rows, so the layout shifts
  on load — checklist §3's "skeleton occupies the loaded box" for the rows, not for the
  toolbar.
- **No affordance to start a thread from read mode.** The read screen shows, replies to and
  resolves threads; its pre-build contract records starting one as out of scope for that
  batch. The only `POST /pages/:id/comments` call in `apps/web` sends `{ parentId, body }`.
  A comment system nobody can open a thread in from the product is half a feature, and the
  roadmap bullet above says so.
- **Page diff options (a) and (c) are the owner's call.** The audit read the page diff as
  "a highlighter pass over source, not a document" and laid out three directions
  (`apps/web/app/pages/pages/[id]/diff.vue`, header comment): (a) render each block as
  `doc-body` prose with a left rule and a badge, (b) keep the slabs and fix the badge, (c) a
  "moved from here" ghost at the old position. (b) shipped in part — the badge, via the
  tonal ring above; the before-text under a modified block needs the diff contract to carry
  it. (a) and (c) go to Open Questions.
- **Raw HTML in read mode** is now real elements through `rehype-raw` behind a hardened
  sanitiser (`12b4870`, recorded in the 2026-09-09 "Two pipelines" entry), and
  `docs/SPECS.md` §5.1 carries the paragraph that says read mode is a second pipeline whose
  output the round-trip buckets do not describe.

**Impact.** None of these blocks a gate. Each is here so that the next person to touch the
file finds the fact beside the code and not in a transcript.

### 2026-09-14 — A tombstoned block id could be resurrected, and a superseded chain severed, on the only markdown write path

**What happened.** `upsertActiveBlock` in `packages/db/src/content/rebuild-derived.ts` was
`INSERT … ON CONFLICT (page_id, block_id) DO UPDATE SET status = 'active', superseded_by = NULL`
with no `WHERE`. The composite primary key did not reject a retired id — it turned the insert into
a resurrection. The guard in front of it could not see the row: `existingActiveIds` was built from
`status = 'active'` alone, so to the first-time-registration loop a tombstoned row and no row at
all looked identical. Path: `PUT /pages/:id` → `savePage()` → `reconcileDerived` →
`reconcileBlocks` → that loop → that statement, with no probe, validation or branch between the
document bytes and the write.

**Reproduced, red on `main`, for an assertion reason** (`rebuild-derived.test.ts`, against a
provisioned Postgres, both fixtures on the *same* page — the conflict is on `(page_id, block_id)`,
so a two-page fixture exercises nothing):

```
a tombstoned id stays tombstoned when its anchor is pasted back into the same page
  Expected: "tombstoned"   Received: "active"
a superseded id keeps pointing at its survivor when its anchor is pasted back
  Expected: "superseded"   Received: "active"
```

The superseded variant is the damaging one: `superseded_by` is exactly the pointer
`reconcile-comments.ts` walks to migrate a thread onto the surviving block. Clearing it detaches
the thread, and orphaning is one-way. Pasting an old paragraph back with its literal ` ^id` is an
ordinary thing to do now that history and diff screens show old revision content verbatim.

**What a returning anchor means — decided: refuse the save, hand back the correction.** Three
options were on the table. *Resurrect deliberately* contradicts markdown-pipeline's "A tombstoned
ID MUST NOT be reused for a new block" outright and detaches live comment threads. *Make the
upsert a silent no-op* (`WHERE status <> 'tombstoned'`) leaves the document carrying an anchor whose
row says the block is dead — a comment placed on it would be orphaned by the next save, silently.
*Mint a fresh id and rewrite the markdown inside the save* was the recommended option and it does
not work from inside `savePage`: the function returns a content hash, not the markdown, so the
client would keep bytes that no longer match the row it is now pinned to, re-submit the dead anchor
on the next save, and the server would mint again — every pass leaving a permanently stale
`active` row behind. Fixing that means changing the `PUT /pages/:id` contract and the editor, and
the whole point of "markdown is the source of truth" is that the server does not edit the author's
bytes behind their back. `savePage` already has one precedent for "these bytes cannot be stored as
given": `NotCanonicalError` refuses and carries the corrected form for the client to adopt.
`DeadAnchorError` follows that shape exactly — it carries the retired ids with their statuses and
`corrected`, the same document with the dead anchors *removed*. Removed, not re-minted: block ids
are assigned lazily, so pasted text nothing references yet should carry no persisted id until a
comment or citation asks for one. The refusal runs before any `page_blocks` statement and inside
the transaction, so the `page_content` write rolls back with it. Both the DDL comment on
`page_blocks` (0008) and the markdown-pipeline requirement now say something true; neither needed
changing.

**The storage layer now refuses it on its own.** 0008's comment claimed "UNIQUE (page_id,
block_id) spans every status … so a tombstoned id can never be reused". Uniqueness forbids a second
row, not a status flip on the existing one. Migration `0016_page_blocks_no_resurrection` adds a
`BEFORE UPDATE` trigger that raises on `tombstoned → anything else`, `superseded → active`, and
`superseded_by` being cleared on a superseded row. A guard in one module is not the guarantee that
comment asserts; the next writer of the table would inherit none of it. Two tests drive raw
`UPDATE`s at the trigger.

**The mint path was blind to the same ids.** `matchBlocks`' split minting seeded its exclusion set
from `previous` — active records only — and `mintAnchorAtBlock` from the anchors in the current
markdown, which are the live ids only. Neither excluded a tombstoned or superseded id, so the only
protection was the 32^10 id space: a probability, not a mechanism, and with the refusal in place a
collision would have become a baffling refusal of a legitimate save. Both now take an optional
`reservedIds` set; `reconcileBlocks` passes the page's full id set, every status. The tests drive
`crypto.getRandomValues` deterministically so the exclusion is observable — "the id it happened to
mint differed" would have proved nothing. **Follow-up (apps/api, not this change):** the
`mintAnchorAtBlock` call in `routes/comments.ts` should pass the page's known ids too, and
`PUT /pages/:id` should catch `DeadAnchorError` and answer 409 with `corrected`, exactly as it does
for `NotCanonicalError`. Until it does, a reintroduced dead anchor is a 500 — visible and safe,
where before it was silent corruption.

**The vacuous guard — a new category, the twenty-second recorded instance.**
`packages/core/src/content/block-registry.test.ts` asserted "reusing a tombstoned id is rejected"
against `StubBlockRegistry`, defined in the same file, which satisfied the rule by construction.
`BlockRegistry` had zero implementers: the interface, a barrel re-export, and that stub. Deleting
every tombstone protection in `packages/db` left the test green. The category: **a port-contract
test for a port nothing implements, standing in for a guarantee the real adapter does not
provide.** It does not state a guarantee; it states the stub. The port, its error type and the test
are deleted; the guarantee lives where the write happens (the db-backed tests above) and in the
trigger. `ContentStore` in the same file is in the identical position — a stub-only port with no
implementer — and is recorded here rather than acted on. **Impact:** a port in `packages/core`
earns a contract test when an adapter implements it; until then the test is a liability, because
it reads as coverage of something it cannot reach.

**Seen on the way, not fixed:** `buildBlockIndex` walks the whole tree (`visit`) and indexes an
anchor on a list item; `sliceBlocks` walks `tree.children` and does not see it. So a list-item
anchor lands in `page_content.block_index` but never gets a `page_blocks` row, and a comment on it
would be orphaned on the next save. Out of scope here; the refusal and the trigger are consistent
with `sliceBlocks`, so neither can fire on an anchor the registry never registered.

### 2026-09-14 — GATE-2 verified one direction over one producer's inputs, and the product's only real producer is the other one

**What happened.** Open `_x y z_` in the editor, select `y`, press `Mod-b` (the real binding in
`create-editor-view.ts`), save. The serialiser wrote `_x&#x20;____y____&#x20;z_`. The page could
then never be reopened in edit mode — the probe refused its own output as `not_byte_identical` —
and every further pass added two more underscores. The same happened bolding a word inside `~~…~~`
(`~~x ~~__~~y~~__~~ z~~`), inside a link (`[x ](/a)__[y](/a)__[ z](/a)` — one link became three),
and bolding a line containing a `[[wiki-link]]`, a `#tag`, an image or a hard break
(`__a&#x20;__#ta&#x67;__&#x20;b__`).

**Why 162 green tests could not see it.** GATE-2 runs `md → doc → md` over a 57-file corpus, and
every one of those documents was produced by the *parser*. A parsed document's mark sets always
arrive already nested the way the source nested them. A document the *editor* built is a different
shape: a ProseMirror mark set is sorted by declaration rank (`strong` before `emphasis` before
`delete` before `link`) and carries no memory of which of two overlapping marks was written
outermost. `toggleMark(strong)` over `y` inside an emphasis run leaves three text nodes marked
`[emphasis]`, `[strong, emphasis]`, `[emphasis]`; `to-markdown.ts` matched those sets as a common
*prefix*, found none between `[emphasis]` and `[strong, emphasis]`, and so closed `emphasis` and
reopened it around the bolded word — three sibling wrappers where the user made one run.
`mdast-util-to-markdown` then did exactly what that tree asked: an `emphasis` ending in a space
cannot carry a right-flanking `_`, so the space became `&#x20;`, and two adjacent `_`-delimited
wrappers had to grow their delimiter runs apart from each other. The `&#x20;` and the quadrupled
underscores were not an escaping bug and not a delimiter bug — they were a correct rendering of a
wrong tree. The second half of the same defect: an inline atom (`wikiLink`, `tag`, `break`,
`verbatimInline`) was read as carrying no marks at all, in both directions — `from-markdown.ts`
dropped the surrounding marks when it built the atom, and `to-markdown.ts` hard-coded `[]` for any
non-text child — although `addMark` marks an atom inside the selection exactly as it marks text.

**The shape.** A gate that verifies one direction (`md → doc → md`) over inputs from one producer
(the parser), while the product's only real producer is the other one (the editor). The number was
honest about what it measured and silent about what it did not: nothing tested a document that came
from `toggleMark`, which is the only kind of document a real save ever contains. This is the
twenty-first recorded instance of a test passing for the wrong reason, and it is the one with the
highest cost: markdown is the source of truth, the user owns the file, and the gate's own claim is
"round-tripping must not alter it".

**The fix.** `orderMarksByExtent` in `to-markdown.ts` orders a child's marks outermost-first by the
*extent* of the run each mark covers (earliest start, then furthest end), which reconstructs the
nesting the mark set threw away; declaration rank remains only the tiebreak for two marks covering
exactly the same run. Atoms carry marks in both directions. `editor-round-trip.test.ts` (GATE-2b)
now runs `doc → md → doc` over documents built by driving `EDITOR_KEY_BINDINGS` — the exact record
`createEditorView` installs, split out into `mount/keymap.ts` so a DOM-free test can execute it —
and asserts four things per case: the saved bytes, that `probe()` re-opens them, that re-parsing
yields the same document (`Node.eq`), and that a second save is a fixed point. Twelve cases, all
red on `main`. Two new fixtures (`modelled/emphasis-around-inline-atoms.md`,
`verbatim/image.md`) cover the parse direction of the same shapes; GATE-2 is 168 cases.

**What it resolves of the "mark nesting is fixed by declaration rank" open question.** The
`~~removed __bold__~~` half is resolved — that is an extent difference, and it now round-trips
byte-identical. The `[__bold link__](url)` half is **not**: `strong` and `link` there cover exactly
the same run, `__[a](b)__` and `[__a__](b)` are the same mark set, and only one spelling can come
back. Rank keeps `strong` outside, so the first opens and the second is refused by the probe. That
is fail-closed on a document the user did not write in the editor, not corruption of one they did:
whichever spelling the editor emits re-parses to the same mark set and re-serialises identically.
It stays an open question, narrowed to coextensive marks only.

**Two more ways a page became permanently uneditable, found alongside.** `probe('')` returned
`{ok: false, reason: 'unsupported_construct'}` with no `construct` and no `line`: `doc`'s content
expression is `block+`, so `schema.node('doc', null, [])` threw a bare `RangeError` that fell into
`probe`'s catch-all. Reachable — `markdown: z.string()` has no minimum and `canonicalise('') === ''`
— so clearing a page and saving stored a document edit mode refused forever, and told the author
nothing. Fixed by making an empty document one empty paragraph (`stringify()` emits zero bytes for
it, so the probe accepts `''`) and by making `construct` and `line` *required* on the
`unsupported_construct` variant so the catch-all cannot compile without naming something.
And `![alt](url)` threw `UnsupportedConstructError` — recorded before as a construct the editor
could not represent, but its consequence is that any page with one inline image rendered perfectly
in read mode and could never be edited again. Now carried verbatim as `verbatimInline`, the bucket
SPECS §5.1 already assigns to "reference-style links and images": modelling it would add a new
spelling surface (alt escaping, title quoting) to pin and fixture before it bought anything, and
refusing-with-a-reason would leave the page uneditable, which is the defect. The image is an opaque
atom the author can move or delete but not retype in place; a real `image` node can replace the
carrier later without changing the bytes.

**Impact:** `bun run gate-2-round-trip` proves the parser's documents survive; `editor-round-trip.test.ts`
proves the editor's do. Both run in `bun run -F @deep-wiki/editor test`. A future mark, inline node
or binding needs a GATE-2b case built by driving the command, not a hand-built node — a hand-built
node is a guess about what the editor produces, and this defect lived exactly in that gap.
`apps/api/src/routes/pages.ts` narrows on `reason` before forwarding `construct`; `line` is now on
every refusal.

### 2026-09-09 — Three routes authorised the object and never the subject, and they chained

An adversarial audit reproduced three authorisation holes against a real Postgres. They are the
same defect wearing three costumes, and the second one hands an outsider the id the first one needs.

**1. `GET /mentions/subjects` performed no authorisation on the caller at all.** The handler read
`workspaceId` and `pageId` off the query string and never called `c.get('session')`. The `auth`
middleware requires *a* session; nothing required it to relate to that workspace. A user with no
grant anywhere, no cell membership and no workspace of their own got
`{"subjects":[{"id":"…","displayName":"alicesecret"}]}` back. `q` defaults to `''`, which
`packages/db/src/permissions/candidates.ts` turns into `ILIKE '%'` — the entire roster, 50 rows at
a time. Both sibling handlers in that same file were already correct: `/mentions/pages` filters by
the session subject, and `/pages/:id/mentions/:userId/check` carries an explicit caller read-gate
with a comment explaining why.

**2. `GET /workspaces/:id/tree` had no membership or read gate.** `readableResourceIds` emptied
`nodes` for an outsider, which *looked* like the gate — but `rootId` was returned unconditionally,
and 200 (exists) versus 404 (does not) was itself the oracle. `exists → 200
{"rootId":"1becec0e-…","nodes":[]}`, `absent → 404`. That root id is a valid `resourceId` for
`can()`, which is exactly the `pageId` hole 1 wanted and the `newParentId` hole 3 wanted. Any
authenticated user — a self-registered one on an `open` instance included — who held or guessed a
workspace UUID got it. `apps/api/src/routes/workspaces.ts` is scrupulous about this exact class
("Absent, never marked"; "Reading nothing is a 200"), which is what marks this as an oversight
rather than a decision.

**3. `PATCH /nodes/:id/position` authorised `write` on the moved node and nothing on the
destination.** `reorderNode` accepts `newParentId` and reparents, guarded only by
`CrossWorkspaceMoveError`, `CyclicMoveError` and `assertLegalParent` — none of which is about the
caller. `reorder-into-unreadable-parent → 200 {"ok":true}`, with the new parent the secret shelf.
Two directions of damage: **disclosure**, since moving your book under a shelf you cannot read
publishes it and its whole subtree to that shelf's readers, performed by someone holding only
`write`; and **concealment**, since moving a book the team depends on into a subtree they cannot
read makes it vanish from their tree, indistinguishable from the deletion this product has
deliberately not built. `POST /nodes`, one function further down the same file, has always called
`authorizeWrite(parentId)` because creating a child requires `write` on the parent.

**The shape.** *A route that authorises the object but not the subject, or the source but not the
destination.* Hole 1 authorised the page's candidates and never the caller. Hole 2 authorised each
node and never the workspace. Hole 3 authorised the node and never either branch the move rewrites.
In each, something was checked, which is why each read as finished.

**What the gates are now.**

- `/mentions/subjects` requires `read` on `pageId` and requires that page to belong to
  `workspaceId` — the two ids arrive independently and nothing else related them, so a page
  readable in one tenant could otherwise be held up to ask for another tenant's roster. Absence,
  denial and tenant mismatch are one 404, as on the check endpoint.
- `/workspaces/:id/tree` gates on `readableWorkspaceIds` — the same question `GET /workspaces`
  answers, so the set of ids a client is handed is exactly the set that opens. Deliberately *not*
  `can(read)` on the root node: a member with a grant on one shelf and none on the root reads that
  shelf's tree today, and rooting the gate there would revoke it. A member reading nothing still
  gets `200 {rootId, nodes: []}`; a non-member gets a 404 byte-identical to a workspace that was
  never created.
- Reorder requires `write` on the node, on the destination parent, **and** on the old parent when
  the node actually leaves one. Against `packages/core/src/permissions/actions.ts`
  (`read < comment < write < manage`), `write` is the least action that may change content;
  `manage` administers grants and would refuse ordinary drag-and-drop to the writers the spec means
  to allow. `write` implies `read`, so the gate cannot be passed by someone who cannot see the
  branch. The old parent is included because **removal is addition seen from the branch that loses
  the child** — its child list is what its readers navigate, and `POST /nodes` already charges
  `write` on a parent for adding one. A same-parent reorder needs no second check, the destination
  being the source. The natural consequence is that dragging a shelf among its siblings needs
  `write` on the workspace root, which is exactly what creating a shelf there already needs.

**Also closed:** `PATCH /nodes/:id/position` answered 403 for exists-but-unreadable and 404 for
absent — the last case of the 2026-09-08 existence-oracle finding, recorded there as a follow-up.
It now reuses `authorizeWrite`, which has answered this correctly for creation and rename since.

**Why the suite missed all three.** Each test varied the wrong variable.
`mentions.test.ts`'s two `/mentions/subjects` cases both vary the *candidate's* access while the
caller happens to hold a grant on the page — neither can fail if the caller is never consulted.
`tree.test.ts` asserted non-disclosure of a hidden *chapter* to a member, never the
outsider-versus-nonexistent-workspace case, so its subject could always read something.
`reorder.test.ts` (`packages/db`) tests reparenting for correctness of `position` and `path` and
has no permission dimension at all, and `tree.test.ts`'s two reorder cases both keep the node under
the parent it already had, so `newParentId` never named a branch the caller had no right to.

**Impact:** the rule to carry forward is **authorise the subject, not just the object, and both
ends of a move, not just the source**. Concretely, when reviewing a route: name the caller's right
before naming the resource's filter; if the handler never reads `c.get('session')`, it has no
authorisation whatever else it checks; and if a request names two resources, both are gated. For
the tests: a non-disclosure test must seed a subject who genuinely holds *nothing* — this batch
added an `outsider` to `tree.test.ts`'s fixture for exactly that reason — and a mutation test must
vary the parameter the mutation travels through, not merely exercise the endpoint.

### 2026-09-09 — Two pipelines, one verified and one not, agreeing on the bytes and disagreeing on what the user sees

An author writes a collapsible runbook as `<details><summary>Rollback steps</summary>…</details>`.
`probe()` returns `{ok: true}`, so edit mode opens. The save succeeds. The markdown in
`page_content` is correct to the byte, and `canonicalise()` is a fixpoint on it. SPECS §5.1
classifies raw HTML as **Verbatim** — "carried opaquely through the schema… byte-identical round
trip; edit mode opens" — and every one of those clauses was true. Every reader saw an empty gap.

**The mechanism.** `parse()` emits native mdast `html` nodes for raw HTML.
`remarkRehype({allowDangerousHtml: true})` turns those into hast `raw` nodes — strings of
unparsed HTML. `rehypeSanitize` handles `root`, `element`, `text`, comment and doctype, and
nothing else, so it dropped every `raw` node wholesale. `rehype-raw` — the plugin that reparses
those strings into real elements the allowlist can then vet — was never in the pipeline. Block
raw HTML lost its text entirely (`"<div>hello world</div>"` rendered as `""`); inline raw HTML
lost only its tags (`"Some <b>bold</b> inline."` rendered as `"<p>Some bold inline.</p>"`), which
is why nobody noticed — the common case degrades quietly instead of vanishing.

**The shape, which is the reason this is written down.** Markdown has two consumers here, and
they are separate pipelines: `markdown → ProseMirror → markdown` (the editor) and
`markdown → HTML` (`render()`, cached and served to read mode). GATE-2 is a real gate with a
69-fixture corpus, and it measures the first one only. It never calls `render()`. So the corpus
proved, rigorously and correctly, that the bytes survived — and proved nothing whatsoever about
whether anyone could read them. Two pipelines fed by one canonical artefact, one of them
verified to a high standard, the other not verified at all, agreeing on what is stored and
disagreeing on what is shown. A green gate on the wrong pipeline reads exactly like a green gate
on the right one. The `verbatim/html-block.md` and `verbatim/html-inline.md` fixtures were both
green throughout.

**The fix, and the security argument it had to survive.** `rehype-raw` now runs between
`remarkRehype` and `rehypeSanitize`. The alternative — refusing raw HTML at the probe so the
editor never accepts what the reader cannot see — is honest but contradicts §5.1's Verbatim
classification and would reject documents that already exist; a visible placeholder was rejected
too, because it leaves the runbook unreadable, which is the actual complaint. Parsing raw HTML
does change the attack surface: read-mode HTML is cached and injected with `v-html`, so anything
surviving `SANITIZE_SCHEMA` reaches every reader's DOM, and eleven XSS probes that passed before
passed **partly because raw HTML was dropped entirely** — a pass for the wrong reason, in the
security tests specifically. Fifteen probes were re-run against the parsed pipeline and all
fifteen are clean (script; `img onerror`; `javascript:`, `vbscript:` and `data:` hrefs; `iframe`;
`object`/`embed`; `svg`+`use` with a `data:` URI; the `math`/`mtext`/`table`/`mglyph`/`style`
mXSS sequence; `details ontoggle`; `style` exfiltration; `base`/`meta`/`link`;
`xlink:href`/`formaction`/`srcset`; a `data:text/html` image; `template`/`noscript`/`textarea`
escapes; and two DOM-clobbering shapes). Each probe in `render.test.ts` now pairs its negative
assertion with a positive one proving the surrounding HTML *did* render, so none of them can
ever go green again by the pipeline throwing the input away.

**`clobberPrefix: ''` had to be re-derived, not re-justified.** It was safe only incidentally:
raw HTML was the single route to an author-chosen `id`, and raw HTML was dropped, so there was
nothing unprefixed for a prefix to defend against. Parsing raw HTML retires that reasoning
completely. Re-enabling the sanitiser's own prefix is not the answer and never was — it rewrites
`id` but never `href`, so it breaks the footnote pairs `mdast-util-to-hast` already prefixed,
which is why it was disabled in the first place. The new reasoning is positive instead of
residual: `name` is no longer allowed on any element, and `id` is allowed only when it matches
one of the shapes `remark-rehype` itself mints (`user-content-fn-*`, `user-content-fnref-*`,
`footnote-label`). None of those is a valid JavaScript identifier, so none can become a
`window.<name>` handle by named access, and `name` — the `document.currentScript` and
form-scoped-named-access route — is gone outright. `span`'s open `className`, which existed only
so `wikiLinkHandler`/`tagHandler` could carry their own class, is narrowed to those two literal
values; `dataBlockId` is pinned to the block-anchor grammar `[0-9A-Za-z]+`; and `style`, `svg`,
`math`, `iframe`, `object`, `embed`, `noscript`, `template`, `textarea` and `title` are now
*stripped* with their children rather than unwrapped, since their child text is stylesheet
source or notation markup, never prose.

**What is deliberately left open.** `rehype-raw` reserializes and reparses the whole document —
it must, because a `<details>` block arrives as two unbalanced `html` nodes that cannot be parsed
in isolation — and that erases node identity. Marking machine-minted nodes beforehand does not
survive it (verified: every element comes back with its `data` gone). So the sanitiser can bound
the *shape* of an `id` but not its *origin*: an author can still write
`<div id="user-content-fn-1">` and duplicate a footnote's jump target, or wear `class="wiki-link"`.
Both are bounded to the author's own page, whose entire text they already control, and neither has
any script consequence, so the per-render nonce that exact provenance would cost was not spent.
`render.test.ts` pins that boundary in both directions — no other `id` shape or class survives,
and these do — so widening it cannot pass unnoticed.

**The bump that carries the fix to pages that already exist.** `CURRENT_PIPELINE_VERSION` goes
2 → 3. This is the case that constant was created for and the easiest one to forget: the Markdown
of an affected page does not change, so `content_hash` is byte-identical and every already-cached
`rendered_html` still holds the empty gap. Without the bump the fix would reach only pages saved
after it ships — and the author who reported a blank runbook would still see a blank runbook.
`backfillStaleRenders` re-renders every row with `pipeline_version < CURRENT_PIPELINE_VERSION`,
which is the mechanism that carries it to the existing corpus.

**A silent regression the narrowing itself introduced, caught only by adding the test.** Pinning
`id` to `/^user-content-fn(?:ref)?-/` alone drops `id="footnote-label"` from the footnote
section's heading while leaving every reference's `aria-describedby="footnote-label"` pointing at
it — an orphaned aria reference, invisible in rendered output and in every existing assertion.
The pre-existing footnote test asserted the four `id`/`href` halves and `class="footnotes"`, and
stayed green through it. It now asserts both halves of the aria pair too.

### 2026-09-09 — A foreign key that constrains the tenant while the code depends on a narrower scope

Two defects, one shape. A composite foreign key existed, was correct about the *tenant*, and
was read as if it were correct about everything — while the application's own logic depended
on a narrower scope the key never mentioned and nothing else checked either.

**`comments.parent_id` — the page.** `createReply` inserted `(workspace_id, page_id,
parent_id, ...)` with `page_id` from the URL and `parent_id` verbatim from the request body,
and `comments_parent_fk (parent_id, workspace_id) -> comments (id, workspace_id)` reconciled
only the first two. The route gated `can('comment')` on the URL's page and never looked at the
parent's. Every *reader* of a thread, however, attributes a reply to its **root's** page:
`listCommentIndicators` joins `reply.parent_id = root.id` with no page predicate on the reply
side, so a reply written with `page_id = A` and a parent rooted on page B raised page B's
indicator count from 1 to 2 — reproduced at the data layer, and over HTTP with a caller who had
no grant of any kind on page B. It was latent only because a root comment's uuid is returned
solely to its own author; `comments_thread_idx ON (parent_id, created_at)` is already built for
the thread-read endpoint that would turn it into content injection, listing an attacker's reply
body to readers of a page she cannot open.

**`POST /uploads/avatar` — the workspace.** `workspaceId` arrived in the multipart form,
validated only as a non-empty string, and was interpolated straight into
`workspaces/${workspaceId}/avatars/...` with no membership check at all. A first pass called
this contained — `FsBlobStore.#resolveKey` rejects `..`, backslashes, nulls and absolute paths
and then re-verifies the resolved path under its root — and that was wrong twice over.

It was wrong at the route: `workspaceId: "../../../../etc"` returned **HTTP 200**, producing
the key `workspaces/../../../../etc/avatars/u/x.webp`, and so did a non-UUID and a foreign
workspace's id. The test that was supposed to pin the key shape asserted
`/^workspaces\/.+\/avatars\/.+\/.+\.webp$/` — and `.+` matches `/`, so the traversal
satisfied it.

It was wrong about the store: containment was one adapter's property, not the system's.
`S3BlobStore.put/get/delete` handed the key to `Bun.S3Client` with no key policy whatsoever.
`FsBlobStore` had five rejected-key tests; `S3BlobStore` had none, so every rejection its suite
observed came from MinIO rather than from the adapter — live against MinIO, `/etc/passwd` and
`a\b.txt` were accepted and round-tripped. Its one "contract proof" was
`const _typeContract: BlobStore = new S3BlobStore(...)`, a type annotation the compiler checks
and no test run can fail.

**Impact.** For the reply, both halves, because they answer different questions. Migration
`0015_comment_parent_page_scope` re-keys `comments_parent_fk` to `(parent_id, page_id,
workspace_id) -> comments (id, page_id, workspace_id)` behind a new
`comments_id_page_workspace_unique`: a cross-page reply now has no referenced row, exactly as
`comments_block_fk` already makes a cross-page block reference unrepresentable rather than
merely unqueried. It subsumes the old tenant guarantee — `page_id` still travels with
`workspace_id` — and its up migration first deletes any reply whose page already disagreed with
its parent's, rows that are illegitimate by construction. The route additionally looks the
parent up scoped by `page_id` and `workspace_id` and answers `notFound` on a miss, which is not
a second guard so much as the difference between a 404 and a constraint violation surfacing as
a 500; scoping the lookup also makes "a parent on a page you cannot read" indistinguishable
from "a parentId that names nothing". A route check *alone* was rejected: it leaves the
database able to hold the bad row, and the reader that miscounts it is a query, not a route.
For the upload, three layers, because the traversal crossed all three. The route validates
`workspaceId` as a uuid and gates the handler on `isWorkspaceMember` before the size, sniff and
`sharp` work; a malformed id gets the same 403 as a workspace the caller is simply not in,
since `workspace_id` is a uuid column and there is nothing to disclose by distinguishing them.
The key assertion's `.+` became `[^/]+`, so it can no longer match a separator. And the key
policy moved out of `FsBlobStore` into `blob-key.ts`, which both adapters now call on every
`put`, `get` and `delete` — the filesystem adapter keeps its own resolve-and-recheck on top,
because reasoning about characters and reasoning about a resolved path fail differently.

The two adapters are held to one policy by `blob-store-key-contract.ts`, a suite both test
files run over the same key list. Its discriminating assertion is `error.reason ===
'invalid blob key'`, never `ok === false`: an adapter with no policy at all still *fails* on a
bad key whenever its backend is unreachable, which is how an empty S3 policy stayed green, and
the S3 factory deliberately points at `http://127.0.0.1:1` so any key reaching the network
proves the adapter did not refuse it. A trailing accepted-key case pins the other side, so a
guard that rejected everything could not pass either. The type-only `_typeContract` is gone,
replaced by a suite that exercises all three port methods at runtime.

**The trap in the tests.** A reply test whose parent sits on the same page exercises nothing;
an upload test whose caller belongs to the target workspace proves nothing; and a store test
whose "rejection" is the backend's refusal proves less than nothing, because it reads as
coverage. All three were live here. The new tests seed the other case deliberately, and the
five pre-existing upload tests were posting a `crypto.randomUUID()` workspace that existed
nowhere — they now seed a real member, which is the same hole in miniature.

### 2026-09-09 — `login_attempt` retained an address the caller chose, on a public endpoint

The login route logged `{ event: 'login_attempt', email, outcome }`. The invariant everyone
checked held — no plaintext password, no hash, and `auth.test.ts` asserts both — so the field
beside them was never questioned. But `email` on a **failure** is not the instance's data: it
is whatever an unauthenticated caller typed. A script walking a list of addresses writes that
list into stdout, and from there into whatever aggregator collects it, at one line per guess.
The value bought in return is telemetry nothing reads: the outcome alone already says a login
failed, and the abuse question ("who is doing this, how fast") is answered by a rate limit
keyed on the caller — a gap this file already carries — not by retaining third-party
addresses in a log.

**Impact.** `login_attempt` now logs `outcome`, plus `userId` on success only — the
application's own identifier, enough to correlate with the session that follows, and never
attacker-supplied. The choice is stated in a comment at the log line rather than left as an
absence someone re-adds. Two tests pin it, for the failure and the success path.
`openspec/changes/archive/2026-09-06-tenancy-and-permissions/verify-report.md` quotes the old
line as evidence; it is an archived record of what was true then and stays as it is.

### 2026-09-09 — The non-disclosure guarantee was enforced in the payload and broken by the work before it

`POST /auth/password-reset` returns a byte-identical 202 whether or not the address has an
account, and a test proved it. What no test looked at was what each branch *did* before
producing that byte-identical answer. The hit branch ran `createPasswordReset` and then
`await deps.mailSender.send(...)` **inside the request**; the miss branch ran
`simulatePasswordResetWork`, one SHA-256 and one `DELETE`. `SmtpMailSender` builds an
unpooled transport, so every send is a fresh TCP connect, EHLO, optional STARTTLS and
MAIL/RCPT/DATA. Measured against this repository's own local Mailpit — same host, no TLS,
the best case that exists:

```
avg sendMail ms:    13.6
avg dummy hash ms:   0.0898
```

A 150x separation on the friendliest possible relay. A self-hoster pointing at a real one
pays 100 ms to 1 s; a dead one pays the transport's full 5 s `connectionTimeout`, at which
point the address oracle is readable with a stopwatch — and nothing bounds the rate, because
"no rate limiting on login or password reset" is a gap this file already carries forward.
The code comment beside the dummy branch claimed it kept "the two response paths' latency
comparable"; it kept the two *database* paths comparable and had never seen the mail.

The test that was supposed to catch this is the more instructive half. `auth.test.ts` had a
wall-clock test, "timing is comparable between a known and an unknown account", asserting the
known/unknown ratio stayed under 5 — and it passed, on `main`, at the moment of the
measurement above. It passed because it built the route with `RecordingMailSender`, which
pushes to an array and returns. It mocked away the single cost it existed to bound, then
compared two ~1 ms numbers whose ratio is mostly scheduler noise. Twenty instances now of a
test passing for a reason unrelated to its name.

**Impact.** Mail is handed off, never awaited. `apps/api/src/adapters/mail/background-mail-dispatcher.ts`
introduces `MailDispatcher`, whose `dispatch` returns `void` — the route holds nothing it
*can* await, so the guarantee is carried by the type rather than by a reviewer noticing a
missing `await`. `BackgroundMailDispatcher` is the safety half of the hand-off: it starts the
send on a later tick (nothing of it runs in the caller's tick), catches a returned `err`
*and* a thrown rejection, logs one `mail_dispatch_failed` line naming the purpose and the
recipient so an operator can still answer "the reset mail never arrived", and can never
become the unhandled rejection that takes a process down. `SIGTERM`/`SIGINT` drain it for up
to two seconds so a hand-off does not become a silent drop at shutdown.

The replacement is structural first. The primary test drives *both* paths against a transport
whose send is never allowed to finish while the requests are in flight, and asserts both
respond — and that the hit path did hand the message off while the miss path never touched the
sender. It is an assertion about what the handler waits on, not about how long anything took:
a handler that awaits the send cannot respond at any machine speed, and one that does not
responds regardless of what the transport is doing. What it proves is that the mail transport
is off the response's causal path for the account that exists, exactly as it is for the one
that does not. What it does not prove is constant time — the residue is one `INSERT` against
one `DELETE`, sub-millisecond, and closing that needs a fixed response deadline rather than a
dummy. A second, temporal test *injects* 250 ms into the transport and bounds the known path's
excess over the unknown path's median; it is named `secondary:` and its comment says it is
corroboration and not the guarantee, because an absolute-bound version of it failed at 205 ms
with the fix in place, under a load average of 59. A wall-clock test measures the host.

**The rule.** A guarantee about a response is a guarantee about everything the handler does
before sending it. When a test asserts that two paths are indistinguishable, ask what each
path *did*, and never let the test double remove the cost under investigation: a stub that
returns instantly turns a latency test into a test of the stub. Injected latency, or an
ordering assertion, or nothing.

### 2026-09-09 — `LEGAL_PARENT_TYPES` existed twice before it existed once

The table that says a book's parent is a shelf — `Workspace -> Shelf -> Book -> {Chapter ->
Page, Page}`, `docs/SPECS.md` §3.1 — was declared in full in **two** files:
`packages/db/src/nodes/move.ts` and `packages/db/src/nodes/reorder.ts`. Character-identical,
each with its own `type NodeType` union beside it, and `reorder.ts`'s copy even carried the
comment "kept identical to move.ts's table" — a promise with nothing checking it. This is
this repository's own named recurring defect (*the same fact in two places with nothing
comparing them*), and it was about to become four copies at once: node creation needs the
same table, and the tree screen needs its inverse to offer "what can I create here?".

**Impact.** The table moved to `packages/core/src/nodes/hierarchy.ts` — the only package
every consumer can already reach (`db` and `contracts` both depend on it, `web` reaches it
through `contracts`, and `core` imports nothing). `move.ts`, `reorder.ts` and the new
`create.ts` all go through one `assertLegalParent()`; `apps/web`'s create menu is built from
`legalChildTypes()`, which is the same table read the other way round rather than a list.
`packages/db/src/nodes/single-source.test.ts` is the guard: it scans every module under
`nodes/` for another `LEGAL_PARENT_TYPES = {` or another `NodeType` union and names the
offending file, and it compares the object the writers actually call by **identity** against
core's export — because a textual scan proves nothing about what runs, and an identity check
proves nothing about what the next person types.

### 2026-09-09 — Node deletion is not a missing feature, it is three unanswered questions

Creation, rename and reorder now exist; **deletion deliberately does not**. It cannot be
built from what the schema and specs currently say, because three product decisions are
owed and none of them has a default that is obviously right:

1. **Children.** `nodes_parent_fk` is `ON DELETE CASCADE`, so deleting a shelf silently
   deletes every book, chapter and page under it — the whole subtree, with no undo, from a
   tree row. Either that cascade is the product decision (and the UI owes a confirmation
   naming the count, not a toast), or deletion must refuse a non-empty node, or it must
   re-parent the children somewhere. The database currently answers "cascade" by accident
   rather than by choice.
2. **Revisions and comments.** `page_revision` rows are immutable by trigger and are the
   product's history; `comments` carry threads other people wrote. Both hang off
   `page_content`, which cascades from the node. Deleting a page therefore destroys other
   users' comments and the entire audit trail of a document — which is the opposite of what
   a wiki is for. A soft delete (a `deleted_at` column, filtered out of the tree and the
   RAG surface) preserves both and is probably the answer, but it is a schema change and a
   permissions question, not an afternoon.
3. **What a deleted node discloses.** Absence and denial are deliberately indistinguishable
   across this API. A hard delete makes a previously-readable id start answering 404, which
   is fine; a soft delete makes it answer 404 while the row still exists, which the tree,
   the backlinks, the mentions and the MCP surface must all agree about.

**Impact.** Nothing is shipped for deletion, and the tree screen's pre-build contract records
it as an explicit non-goal rather than an omission. Guessing any of the three would be worse
than not having the feature: the wrong answer to (2) destroys data that cannot be recovered.

### 2026-09-09 — Refusing a duplicate sibling name tells a writer that *something* holds it

`nodes_parent_slug_unique (parent_id, slug)` means two siblings cannot share a slug. Creation
and rename therefore have to answer for a name that is taken, and there were two candidates:
uniquify silently (`overview` → `overview-2`) or refuse and say so. They refuse
(`DuplicateSiblingSlugError` → HTTP 409, the message quoting the name the user typed),
because a wiki that stores a different name than the one typed, without saying so, produces a
tree with two rows reading "Overview" and a URL nobody predicted.

The cost is a bounded disclosure. A caller with `write` on a parent but an explicit `deny` on
one of its children learns that *some* sibling already holds that slug — they cannot see
which, or what it is called beyond the name they themselves typed. It is unavoidable while
the constraint exists (the INSERT would fail either way, and a silent uniquify would leak the
same fact through the suffix it chose), and it is strictly narrower than the parent-level
non-disclosure this API does guarantee: creating under a parent the caller cannot read is
byte-identical to creating under one that does not exist, asserted through
`apps/api/testing/expect-no-disclosure.ts` with the headers scanned as well as the body.

**Impact.** Recorded rather than hidden. If per-child read denial under a writable parent ever
becomes a case the product cares about, the fix is a soft-uniquify *for that case only* — and
that is two behaviours for one fact, so it needs a decision, not a patch.

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

### 2026-09-06 — Per-provider embedding support: OpenAI, Gemini and OpenRouter remain unverified this session

`ai-provider-foundation`'s Phase 18 built `apps/api/src/ai/probe.ts` and the opt-in
`bun run -F @deep-wiki/api ai:probe` specifically to answer the question the 2026-09-03 Finding
below ("Chat providers and embedding providers are not the same set") left open: which of OpenAI,
Google Gemini and OpenRouter expose a first-party embeddings endpoint. Anthropic and DeepSeek are
already excluded — both vendors' own documentation confirms neither offers one — and are not
reprobed here.

The probe ran in this session against all three. **No provider API key was available** (checked
`AI_PROBE_OPENAI_KEY`, `AI_PROBE_GOOGLE_KEY`, `AI_PROBE_OPENROUTER_KEY`, and the shell environment
directly — none set), so the actual, honest outcome is:

| Provider | Outcome | Evidence |
|---|---|---|
| OpenAI | **unknown** | probe did not run — no key available |
| Google Gemini | **unknown** | probe did not run — no key available |
| OpenRouter | **unknown** | probe did not run — no key available |

**Impact:** `packages/core/src/ai/registry.ts` keeps `embeddings: false` for OpenAI, Gemini and
OpenRouter — unchanged from before this Finding, and correctly so: an unrun probe is *unknown*,
never *unsupported* and never *supported*. `offeredEmbeddingProviderIds()` (Phase 15.11) therefore
still offers none of the five providers for `embedding_provider` selection; this is the honest
state of a workspace configuring embeddings today, not a bug. Whoever runs `ai:probe` next with a
real key for one of these three providers **updates the registry's `embeddings` field strictly
from that run's output**, per Phase 18.3 — never from assumption, and never by copying this table
forward without re-running the probe.

### 2026-09-06 — No local embedding model exists that emits 1536 dimensions: air-gapped RAG has no path today

The 2026-09-04 Open Question ("Embedding provider and model to standardise on") settled the
dimension at 1536 and named the unresolved half as Phase 5's job: find a local embedding model
that emits exactly 1536 dimensions, or record that self-hosted air-gapped RAG is unavailable.
`ai-provider-foundation` Phase 15 built the seam (`registerEmbeddingModel`, `resolveLocalFallback`
in `packages/core/src/ai/embedding-registration.ts`) and tested it against the two obvious
open-source candidates: **bge-m3 and e5-large both emit 1024 dimensions**, not 1536, and are
rejected by the registration guard rather than silently accepted at the wrong width.

No third candidate was identified or evaluated in this session. `resolveLocalFallback()` therefore
returns "none available" unconditionally today — not a placeholder, not an approximation.

**Impact, stated as a product limitation rather than left implicit in a design document: a fully
air-gapped deep-wiki instance has no RAG path today.** A workspace with only a self-hosted
chat-capable local model still has no way to produce embeddings, and `embedding_configuration.ts`'s
`resolveEffectiveEmbeddingProvider()` correctly resolves such a workspace to `none-available`
rather than fabricating one. Closing this gap needs either (a) identifying a 1536-dimension local
model, (b) adding a supported dimension-reduction path for a larger local model the way OpenAI's
`text-embedding-3-large` already has one (Phase 15.4), or (c) accepting a per-deployment migration
to a different `dimensions` value for air-gapped operators specifically (design.md D14's own
"what would reverse it" column). None of the three is decided here; this Finding exists so the gap
is visible rather than discovered later by an operator with no network egress.

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

### 2026-09-09 — Schema-versus-`env.example` agreement is a `bun run check` rule, not a `bun test` one

`scripts/checks/env-example.ts` compares `Object.keys(envSchema.shape)` against the template, and
checks that every `.default()` agrees with the value the template assigns, only under
`import.meta.main` — so it runs from `bun run check` and the pre-commit hook, and never from
`bun test`. That is deliberate and follows `CLAUDE.md`: the drift rule is a structural guard
rail, and the exported `checkEnvExample()` that the unit tests exercise takes its inputs as
arguments precisely so the tests do not depend on the repository's own template. Worth knowing
when reading a green `bun test` run: it says nothing about `env.example`.

Its own test for a missing template asserted only `ok === false`, which a present-but-drifted
fixture satisfies identically; it now asserts the exact error, so "no such file" and "no such
line" cannot be confused. (Tightened 2026-09-09.)

### 2026-09-09 — `PAGE_LOCK_HEARTBEAT_SECONDS` may be set at or above `PAGE_LOCK_TTL_SECONDS`

Noted while bounding the numeric env variables, not fixed. Both are independently validated as
positive integers and nothing relates them, but the design (content-and-editor design.md, "The
soft lock, coherent without presence") depends on the client heartbeating *well inside* the TTL:
with `PAGE_LOCK_HEARTBEAT_SECONDS >= PAGE_LOCK_TTL_SECONDS` an active editor's lock lapses under
them and another user can take the page. This is a cross-field rule, so it belongs in
`refineEnv()` alongside the mail and blob-store conditions rather than on `envSchema` — the
module comment explains why. Left out of the audit's scope deliberately; it is a behaviour
change, not a test fix.

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

### 2026-09-09 — Every structural check had a hole, and each one was proved by construction

Symptom: none observed in use. An audit constructed one violation per check and ran the
check against it. Every check returned ok. Twenty instances of tests passing for the wrong
reason were already on record here; these are the gates that were supposed to catch that.

Cause: not one bug but one recurring shape — a rule written against a *spelling* rather
than against the property it means. Enumerated, with the fix for each:

**`core-purity`** — three ways into the framework-free package.
`import { type Root, type Content } from 'mdast'` passed: `scanImports()` elides an inline
`type` specifier exactly as it elides `import type … from`, and the supplementary backstop
regex demanded the `type` keyword *before* the clause, so both mechanisms were blind to the
same line. `process.env.HOME` and `Buffer.from('a')` passed with no import at all — "not
even a Node built-in" was enforced only against import specifiers, and the globals that make
the built-in unnecessary are ambient. And `src/helper.mts` importing `hono` passed because
`SOURCE_FILE_PATTERN` read only `.ts`/`.tsx`, so the file was never opened. Fixed: the
backstop no longer asks whether an import is type-only, it sweeps every static
`import`/`export … from` specifier; a `FORBIDDEN_GLOBALS` sweep runs over comment- and
string-stripped code (every occurrence of `Bun`, `process`, `crypto`, `window`, `module` in
`packages/core` today is prose in a doc comment, so telling prose from code is the whole
job); and every extension Bun, tsc and Node execute is read.

**`single-parser`** — four. `import { remark } from 'remark'` passed: the denylist named
`remark-parse` and `remark-stringify` but not the meta-package that *is* both of them.
`mdast-util-from-markdown` + `mdast-util-to-markdown` passed in a non-owner file, and both
are installed here — together a full round trip with none of this repository's GFM,
frontmatter, wiki-link, tag or block-anchor extensions. `` import(`@milkdown/core`) ``
passed because the matcher compared each specifier against `'x` and `"x`, missing the third
quote character JavaScript has. Fixed by extracting specifiers instead of string-matching
the raw text — which also stops a package named in a doc comment from counting as an import,
and that is how the reasoning in these files gets written down at all.

The fourth was not a regex. `single-parser.test.ts:29` **blessed** `prosemirror-markdown`
inside `packages/editor` — a package that ships `defaultMarkdownParser` and
`defaultMarkdownSerializer`, a complete second markdown parser, in the one package whose
entire job is markdown↔ProseMirror conversion — and **no justification was written down**.
Compare `bundle-isolation.ts`'s `prosemirror-model` exemption, which carries its reasoning
and a stated reversal condition. The blessing was also not paying for anything:
`packages/editor/package.json` does not depend on `prosemirror-markdown`, and
`src/to-markdown.ts` converts through `packages/markdown`'s mdast. **Decision: the blessing
is removed**, `prosemirror-markdown` is forbidden everywhere via a new `FORBIDDEN_EVERYWHERE`
list with no owner exemption, and the reasoning and reversal condition are recorded in the
module header. The old test is replaced by its inverse, marked as a deliberate reversal.

**`single-source` (`LEGAL_PARENT_TYPES`)** — the only structural invariant that ran neither
in `bun run check` nor in `.githooks/pre-commit`, because it was a test inside
`packages/db` and therefore needed a Postgres. Placement caused both of its holes, and both
were measured rather than argued. Its textual scan read one directory non-recursively:
planting a second copy at `apps/api/src/routes/tree.ts` — exactly where a "the client needs
the table too" copy lands — its own regex matches the copy (`true`) while the scan reports
`offenders = []`, because it never reads the file. And its semantic assertion was
`legalParentTypesUsedBy()[c].includes(p)` against `isLegalParentType(c, p)`, where the
accessor *returns* `LEGAL_PARENT_TYPES` and the predicate *reads* it: one object read twice,
`X.includes(p) === X.includes(p)`. Rewriting `LEGAL_PARENT_TYPES.page` to every node type
leaves its 25-iteration loop reporting `mismatches = 0`.

Fixed as `scripts/checks/single-source.ts`, in `bun run check` with the rest: a recursive
scan over every workspace member, and a semantic half stated as *properties* the table must
have — one entry per node type, every named parent a real type, an unparented root, no type
legal under every type, no cycles — rather than as a second literal of the table, which
would be the checked defect wearing a hat. The `packages/db` test is owned elsewhere and is
left as it stands; it is now redundant rather than load-bearing.

**`bundle-isolation`** — the import closure stopped at every workspace-package boundary, so
reverting the exact regression its own doc comment records (`@deep-wiki/markdown/pipeline` →
`@deep-wiki/markdown`, transitively reaching `node:crypto`) returned ok. A static
`export … from '@deep-wiki/editor/mount'` and a bare `import '@deep-wiki/editor/mount'` were
both invisible. And extensionless relative edges resolving to `.vue`/`.mts` were **silently
dropped** rather than erroring — a resolution failure that drops an edge is worse than one
that fails loudly, because the dropped edge is exactly where a forbidden import hides.

**`test-coverage`** — `test.skip('…', () => { expect(…) })` and a top-level
`function neverCalled() { expect(…) }` both counted as full coverage while `bun test` ran
zero assertions over that tree. An aliased import (`~/utils/retry.config`) made a real
module read as exempt tool configuration, while the same file imported relatively was
correctly reported — `apps/web` uses `~/` 9 times and `#` 88 times today. And the
member-level rule that `CLAUDE.md` and `.githooks/pre-commit:6` both advertise — "a
workspace member has no executing test" — **no longer existed**: the per-member rewrite
dropped it, so `"test": "echo no tests"` passed. Restored rather than documented away.

**`routes-mounted`** — `routes-mounted.ts:39` still said "A bare mention is enough", so a
factory named only inside a `// TODO:` comment counted as mounted: precisely the artefact a
developer leaves *because* the module is not wired. `readdirSync` was non-recursive, so
`routes/admin/users.ts` was never read at all. And `export const createXRoutes = …` missed
the factory regex.

**`diff-input-purity`** — the rule was per file, so splitting defeated it entirely:
`anchors.ts` reads `block_index`, `diff.ts` calls `diffBlocks(loadAnchors(a), …)`, neither
trips. `import { diffBlocks as diff }` defeated the call regex on its own.

**`query-boundaries`** — `DENYLISTED_FIELDS` was snake_case only, so a contracts schema
declaring `passwordHash`/`sessionToken`/`resetToken` passed the layer where those names are
actually spelled. Rules matching SQL verb text missed every Drizzle builder call.
`'%' + term + '%'` defeated the leading-wildcard rule.

**`env-consistency`** — a missing or portless half **silently disabled** the rule, so a
`DATABASE_URL` with no port beside `POSTGRES_HOST_PORT=25432` returned ok — the header's own
worst-case scenario, and the check was quiet about it. And `APP_URL` was compared on port
only, leaving the host — what CORS and mailed reset links actually depend on — unchecked.
`env-consistency.test.ts` pinned both open as intended behaviour; both pinning tests are
reversed deliberately and say so.

**`workspace-shape`** — four evasions at once: `vitest` under `peerDependencies`; a
`vitest.config.ts` with no declared dependency (Bun hoists it, so it runs); `pnpm-lock.yaml`
inside a *member* directory; and `package-lock.json`/`yarn.lock`, not banned at all despite
"Never pnpm. Never npm."

**`compose`** — omitting `type: bind` from a long-form volume (still a valid bind mount)
skipped the SELinux rule entirely, so deleting one line disabled it. `privileged: true` and
`network_mode: host`, both fatal under rootless podman, were in no banned list.

**`env-example`** — "must never contain a secret" had **no mechanism at all**. See the
separate entry below for what was chosen and what it honestly cannot see.

Fix: each hole closed under strict TDD — the fixture was written first, run against the
unmodified check, and observed to pass (that is, to fail the new test) before anything was
changed. Fixtures are kept permanently under `scripts/checks/__fixtures__/`.

Impact: no real file in `apps/` or `packages/` needed changing; every strengthened check is
green against real source. `bun run check` gained `single-source.ts`; `verify` gained
`check:bundle`. `CLAUDE.md`'s check list and `.githooks/pre-commit`'s header were corrected
to describe what now runs.

---

### 2026-09-09 — Two structural checks were reachable from no locally-runnable gate

Symptom: `bun run scripts/checks/bundle-isolation-build.ts apps/web` exits 1 —
`no "pages/pages/[id]/index.vue" entry in the build's client chunk graph`. Nobody had
noticed. It is layer 3 of "read mode never reaches the ProseMirror bundle", the only layer
that inspects a real build's chunk graph, and it had never executed against a real build.

Cause: `compose-smoke.ts` and `bundle-isolation-build.ts` had one caller between them —
`.github/workflows/ci.yml` — and this repository has no git remote, so that workflow has
never run and cannot. Expanding the root scripts, `verify` was `check` + `env-consistency` +
`lint` + `typecheck` + `test` + the GATE-2 round trip + `e2e`, and neither check appeared
anywhere in it. This is exactly the defect `e2e-wiring.test.ts` was written to close for
`e2e/`, left unclosed for the checks themselves. The immediate cause of the red exit was a
`.output` stale since 2026-09-04, from before the read route existed — but a stale build is
what "nothing runs it" looks like from the outside.

Fix: `scripts/checks/__tests__/checks-wiring.test.ts` enumerates `scripts/checks/*.ts` with
`readdirSync` — never a hand-maintained list, because the unreachable check is precisely the
one nobody remembers to add to a list — and asserts three things per check: a root script
names its path; `verify` transitively reaches it, unless it is in a `PREREQUISITE_GATES`
table that names both the prerequisite and the committed command that does run it; and it
has an executing test of its own. `compose-smoke.ts` is the one entry: it asserts against
live Mailpit and Kroki endpoints and cannot run in a gate that starts no containers.
`check:bundle` now builds `apps/web` before inspecting its chunk graph — a gate that skips
is a gate that does not exist — and `verify` runs `check:bundle`.

Impact: adding a check to `scripts/checks/` without wiring it now fails the suite.

---

### 2026-09-09 — `SMTP_SECURE=false` in env.example arrived as `true`

Symptom: not observed in use — found by a test-quality audit of `packages/contracts`, which
noticed the schema could not disagree with the template.
Cause: `packages/contracts/src/env.ts` declared `SMTP_SECURE: z.coerce.boolean()`.
`z.coerce.boolean()` is `Boolean(value)`, not a parser: every non-empty string is `true`, so
the `SMTP_SECURE=false` line `env.example` ships coerced to `true`, and `apps/api/src/index.ts`
passed it straight into `SmtpMailSender`'s `secure`. A fresh clone therefore opened SMTP with
TLS against the compose stack's Mailpit, which does not speak it. `e2e/global-setup.ts` sets
`SMTP_SECURE: 'false'` and was reading `true` for the same reason.
Fix: `envBoolean()` in `packages/contracts/src/env.ts`. `true`/`1` are true, `false`/`0` are
false, an empty assignment is false, case and surrounding whitespace are ignored, and anything
else is **refused** — silently truthy is what caused this, so an unrecognised word now fails at
boot naming the accepted ones. Built on `z.enum` deliberately, so the failure is a real
`invalid_enum_value` issue: that is the one zod code `describeZodIssue()` re-words into "must be
one of: …" without echoing what was typed, which matters because these variables carry
credentials.
Impact: `SMTP_SECURE` was the only `z.coerce.boolean()` in the repository — checked; `comments.ts`
and `diff.ts` use plain `z.boolean()` on JSON bodies, where the value really is a boolean and no
coercion happens. `apps/api` already typed the field `boolean | undefined`, so nothing there
changed. An operator who had written `SMTP_SECURE=yes` or `on` now gets a boot failure instead of
silent TLS; that is the intended trade.

### 2026-09-09 — `PORT=70000` parsed

Symptom: not observed — found by the same audit.
Cause: `PORT` and `SMTP_PORT` were `z.coerce.number().int().positive()` with no upper bound. A
port is a 16-bit unsigned integer; anything above 65535 was accepted by the schema and failed
later, from the socket, as something else entirely.
Fix: `.max(65535)` on both, and tests naming the variable and the limit.
Impact: contained. The other numeric variables — the session/token TTLs, the page-lock window,
`CHANGESET_WINDOW_MINUTES` — were checked and deliberately left unbounded: a duration has no
protocol maximum, and inventing one would be a guess rather than a rule. `env.example`'s
"keep this at 1024 or above" note is likewise left as advice, not a schema rule: it is true of
rootless podman, not of every deployment.

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

- **Should a page's title live in its markdown, as the document's first heading?** The owner
  asked for the title to be edited on the page, "como en obsidian" (2026-09-23), and half of
  that shipped: the title is editable in place at the top of read and edit, and editing it
  renames the node (`PageTitle`, `usePageTitle`). The other half — the title *being* the
  document's first `#` heading, the way Obsidian's title is its filename and many wikis' is
  their `h1` — was deliberately **not** built, and this is the argument, for the owner to
  answer.

  **What it would cost.** Markdown is the source of truth and the round trip through the
  editor is byte-identical (`PRODUCT.md`); a page's title is `nodes.title`
  (`docs/SPECS.md`). Making the body carry the title means:
  - **Every page's canonical bytes change.** A `# Title` line and a blank line are prepended
    to every stored document in every workspace — a migration over `page_content` and every
    `page_revision` row, or a divergence between what the editor writes and what history
    holds. GATE-2's 182 fixtures are all about bytes, and each would need its own answer.
  - **Every block anchor shifts.** Anchors are per block and stable across edits, which is
    what comments, diffs, RAG chunk provenance and AI selections all hang off. Inserting a
    block at the top of every document changes what the first anchor is about, and a
    comment's "moved, not deleted and inserted" claim is about exactly that.
  - **Two writers for one fact.** The tree renames a node, the editor edits a document. If
    the title is in both, then either the editor's first heading is authoritative (and the
    tree's rename becomes a document edit, taking a revision, a lock and a changeset with it)
    or `nodes.title` is (and the document's own first line is a lie the renderer has to
    suppress). Obsidian has neither problem because its title *is* the filename and the body
    never repeats it.
  - **The read screen renders the title twice** until the renderer learns to drop the first
    heading — which is a rule about content that the sanitising render pipeline does not have
    and that every export, chunk and diff would have to share.

  **What the smaller half already buys.** The person edits the title where they read it, in
  one field, and the name changes everywhere at once. Nothing about the document's bytes
  moves. If the owner wants the heading in the body as well, the cheapest honest shape is
  probably the reverse of the intuition: keep `nodes.title` authoritative and *offer* to
  insert a matching `# Title` block on the first save of a new page, as content the author
  then owns — no migration, no anchor shift, and no second writer.

- ~~**Should every frame screen's bar condense, or edit mode's alone?**~~ **Answered
  2026-09-17: edit mode's alone.** `AppShell`'s `condensed` folds the breadcrumb to its last
  two crumbs behind an overflow menu, and that stays scoped to edit mode; in read mode the
  tree highlights the open document and the full path stays on the read, history, diff and
  members screens. Recorded in Findings 2026-09-17. Superseded original text follows.
  `AppShell`'s `condensed` folds the breadcrumb to its last two crumbs behind an overflow
  menu. Edit mode takes it (the owner's request, 2026-09-16); the read, history, diff and
  members screens keep the full path. The tree beside every one of them already shows the
  path, which is the argument for condensing everywhere; the read screen passed review with
  the full path, which is the argument for asking first. (Findings 2026-09-16.)
- **Dialog corner: 16px or M3's 28px?** Every dialog ships at `UModal`'s `rounded-lg` (16px,
  the container rung); DESIGN-SYSTEM §3.4 says dialogs keep `corner-extra-large` (28px), and
  the radius ladder has no 28px rung (`rounded-xl` is 24, `rounded-2xl` 32). A central ruling
  on `app.config.ts`'s `modal.slots.content`, once, or an amendment to §3.4. (Findings
  2026-09-16.)
- ~~**Default plan policy — what a new account gets.**~~ **Answered 2026-09-17.** A
  per-instance default plan is assigned automatically to a self-registered user; the owner
  of a workspace chooses which plan applies to it, and the workspace's limits derive from
  that owner's plan, not from a plan handed to the workspace directly. The Super Root keeps
  authoring plans, now from a dedicated root panel listing every workspace in the instance.
  `docs/SPECS.md` §2 amended; recorded in Findings 2026-09-17. **Not yet built** — the
  Super Root plan-authoring route (Phase 1, still unticked) and the root panel (Phase 3.5,
  below) remain. Superseded original text follows.
  `createWorkspace` refuses a user whose `plan_id` is null (`NoPlanAssignedError` →
  `403 no_plan`), and both paths that create an account — self-registration and invitation
  acceptance — leave it null; only the seed scripts set one. `docs/SPECS.md` §2 made plans
  the Super Root's to author and was silent on a default. Options were: a per-instance
  default plan assigned at account creation; a plan chosen on the invitation; or no default,
  with the Super Root plan-authoring route (Phase 1, still unticked) as the only assignment
  path. Until decided, only a seeded account could reach `/workspaces/new` successfully.
  (Findings 2026-09-14.)
- **Whether to teach tailwind-merge the project's type roles.** `ui.tv.twMergeConfig` in
  `app.config.ts` would stop a `--text-*` role inside a `:ui` slot override being dropped as
  a colour (Findings 2026-09-16). Cheap, central, and it changes what `WorkspaceSwitcher`'s
  name and the breadcrumb links render at on every screen — so it is the owner's call, with
  a re-measure of both.
- **Which signal tells the client `manage` and `is_super_root`.** No response carries a
  `capabilities` field and there is no `GET /me`, so the Members and Registration-settings
  links render for everyone and the destinations refuse. Either a `capabilities` object on
  the responses screens already fetch, or a `/me` for the global flag — or both. Whichever
  is chosen must not become an existence oracle: a capability the server names on a
  resource the caller cannot read is a disclosure. (Findings 2026-09-14.) **Amended
  2026-09-16:** the tree's row context menu is the third surface waiting on this — with
  no `write` signal per node it offers "Rename…" and "Move up/down" to every caller and
  lets the server refuse, where a `read`-only member should see the item disabled with
  the reason. The same `capabilities` answer, per node on `GET /workspaces/:id/tree`,
  would close it. **Amended 2026-09-17:** decision 10 on plans (below) makes this a
  prerequisite rather than a standing question — "no longer a question" in the owner's own
  words. Whichever of `capabilities` or `GET /me` is built, it must exist before the plans
  work can show a workspace's own plan and limits to its owner, or gate the new Super Root
  root panel. Which of the two mechanisms is picked is still open.
- **`page_revision` retention.** Every save inserts an immutable revision row carrying the
  full markdown; nothing prunes, compacts or caps them. The table grows with every
  keystroke-and-save on every page forever. Owed: a retention rule (keep all, keep N per
  page, keep all within a window then thin), and who may run it. Not a Phase 3 question to
  answer in-flight; recorded so the growth is a decision, not a surprise.
- ~~**Node deletion — three questions, unchanged since 2026-09-09.**~~ **Answered
  2026-09-17.** A container (shelf, book, chapter) must be empty to delete; the owner may
  force a non-empty container by typing its name and accepting "N pages will be deleted."
  Comments and revisions go with the deleted page rather than being orphaned or severed, and
  the book's history keeps a trace ("page X deleted by Y"). Deletion is soft — a trash with
  restore, 30 days, then purge — so a hard delete never runs against an audit trail on
  demand. What a trashed or purged id discloses to a caller who cannot read it is not itself
  answered by this decision; it stays governed by the existing non-disclosure rule (absence
  and denial indistinguishable) until the trash/restore surface is built and can be checked
  against it. Recorded in Findings 2026-09-17. **Not yet built** — the tree's delete
  affordance, the trash/restore screen and API, and the purge job are new roadmap work
  (Phase 3.5, below). Superseded original text follows.
  (1) What happens to children — the schema cascades by accident, not by choice. (2) What
  happens to revisions and comments other people wrote — a hard delete destroys the audit
  trail; a soft delete is a schema and permissions change. (3) What a deleted id discloses —
  absence and denial must stay indistinguishable across tree, backlinks, mentions and MCP.
  See the Finding of 2026-09-09.
- ~~**Page diff directions (a) and (c).**~~ **Superseded 2026-09-17.** The owner did not
  pick among (a)/(b)/(c): reviewing the shipped page diff (gate 10.4) and book diff
  (gate 10.6), the verdict was **not passed** — wanted instead is a GitHub-style diff with
  word-level changes inside a block, on top of the existing four change classes
  (added/removed/modified/moved), and a two-column before/after view offered as an option.
  See `docs/UI-CHECKLIST.md` Review Log 2026-09-17 for the verdict and Phase 3, below, for
  the rework this reopens. Superseded original text follows.
  The audit's (a) — render each diff block as `doc-body` prose with a left rule and a badge,
  so the diff reads as a document — and (c) — a "moved from here" ghost at the block's old
  position — were unimplemented and were the owner's call; (b) is what shipped. Recorded in
  `apps/web/app/pages/pages/[id]/diff.vue`'s header comment and in Findings 2026-09-14
  ("Seen on the way").
- **Node deletion — three questions, unchanged since 2026-09-09.** (1) What happens to
  children — the schema cascades by accident, not by choice. (2) What happens to revisions
  and comments other people wrote — a hard delete destroys the audit trail; a soft delete
  is a schema and permissions change. (3) What a deleted id discloses — absence and denial
  must stay indistinguishable across tree, backlinks, mentions and MCP. See the Finding of
  that date; deletion is a recorded non-goal on the tree screen until all three are
  answered.
- **Page diff directions (a) and (c).** The audit's (a) — render each diff block as
  `doc-body` prose with a left rule and a badge, so the diff reads as a document — and (c) —
  a "moved from here" ghost at the block's old position — are unimplemented and are the
  owner's call; (b) is what shipped, and its "before-text under a modified block" half
  closed on 2026-09-17 with the word-level marks. Recorded in Findings 2026-09-14 ("Seen on
  the way") and 2026-09-17.
- **Registration answers the question password reset refuses.** `POST /auth/register`
  returns `409 "an account already exists for this email address"`, while
  `POST /auth/password-reset` goes to deliberate lengths — an identical body and now an
  identical latency — never to disclose the same fact. The oracle is bounded to `open` mode:
  `closed` and `invitation_only` both return 403 before the address is ever looked up (guarded
  by a test in `admin.test.ts`), so only an instance that has opened public sign-up answers the
  question. Two honest options, and the choice is a product one:
  1. **Keep the 409.** Sign-up stays one step: submit, get an account, get told plainly that
     the address is taken. Cost: on an open instance, anyone can enumerate which addresses
     hold accounts, one request each, at whatever rate they like. Rewording the message buys
     nothing — 409 against 201 is the signal, not the sentence.
  2. **Make it non-disclosing.** Every submission gets the same generic acknowledgement, and
     the mail decides: a new address receives a link that completes the registration, an
     already-registered one receives "someone tried to register with your address". Cost: a
     verification-token table, a confirm route, and a rewritten sign-up screen in `apps/web`;
     sign-up becomes two steps and inbox-dependent, so a self-hoster with a broken relay can
     no longer register anyone (the instance already requires a successful SMTP test before
     `open` mode can be selected, so the dependency is at least consistent with what is there);
     and the "someone tried to register" mail is itself a thing an attacker can make the
     instance send to a stranger.
  Deliberately not decided in-flight: option 2 spans three packages and changes what sign-up
  *is*. Until it is answered, `admin.ts` carries a comment saying the disclosure is known,
  which mode it is reachable in, and why the wording is not the fix.

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

- ~~**Two canonical constructs the editor cannot round trip.**~~ **Answered 2026-09-14, in part** —
  see the Finding of that date. Inline images are carried verbatim (SPECS §5.1's own bucket for
  images) and open in edit mode; extent-ordered mark nesting resolves `~~removed __bold__~~` and
  every case where one mark's run is a strict subset of another's. **What remains open, narrowed:**
  two marks covering *exactly* the same run — `[__bold link__](url)` against `__[bold link](url)__`
  — are one ProseMirror mark set, and only one spelling can come back. Rank keeps `strong` outside,
  so the first is refused by the probe (fail-closed, no byte rewritten) while the editor's own
  output always re-opens. Resolving it means remembering nesting order the mark set does not hold —
  a mark attribute, or a serialisation-order attribute on the text node — and deciding which
  spelling is canonical when both parse. Not decided in-flight. Superseded original text follows.
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
- **Logout — clearing the cookie is not the same as ending the session.** `createSession`
  (`apps/api/src/routes/auth.ts`) writes a server-side session row and hands back a cookie;
  there is no route that deletes or expires that row on demand. `apps/web/PRODUCT.md` lists
  logout under "Not yet" as an unbuilt screen, but the mechanism underneath it is a design
  question, not just missing UI: a client-side "clear the cookie" leaves the session valid on
  the server until its idle or absolute timeout, so a token that leaked before logout — a
  shared machine, a copied header — is not actually revoked. Owed: a `DELETE` (or `POST
  /auth/logout`) route that invalidates the session row, called from wherever the control
  ends up living (the sidebar footer is the obvious door, next to Members).
- **The structured-output rungs are not on the wire.** No provider adapter reads
  `ChatRequest.structuredOutput`; `schema`, `tool-call` and `prompted` send identical bytes and
  the ladder's only working mechanism is the `prompted` repair turn. Measured 2026-09-17: with
  `response_format: json_schema` sent by hand, the four OpenRouter routes went from 6–12/12
  first-attempt validity to 12/12 each. Owed: wire the level into the adapters (native schema
  mode, a single required tool, or the schema appended to the system text), re-run
  `ai:conformance`, and raise each entry to the rung it measures at. Until then a `schema`
  declaration on `openai:gpt-4o` or `google:gemini-1.5-pro` is a vendor claim the conformance
  suite cannot falsify. See Findings 2026-09-17 ("Cheap models first").
- **Serving avatars.** `POST /uploads/avatar` validates, resizes and stores an image and writes
  its key to `users.avatar_key` (`apps/api/src/routes/uploads.ts`), but no route reads a key
  back into bytes a browser can request — there is no `GET /avatars/…` and no signed-URL
  response field carrying one. An uploaded avatar is presently unusable: nothing in
  `apps/web` can point an `<img>` at it. Options: a proxy route through the API (keeps the
  bucket private, adds a request per avatar shown), a short-lived signed URL from the object
  store returned alongside `avatar_key` wherever a user is named, or serving the bucket
  publicly under an unguessable key (weakest, and a decision about the bucket's own
  visibility). Recent changes, the members roster and mention pickers all render initials
  today because of this gap, not by design.

---

## Known gaps carried forward

Accepted, not fixed. Do not "clean up" one of these without discussion.

- **No rate limiting on login or password reset.** The non-disclosure response closes
  the account-enumeration oracle but not online brute force. Deferred deliberately; see
  the Findings entry above. Must be addressed before any public deployment.
- **CI cannot run.** There is no git remote, so `.github/workflows/ci.yml` never
  executes. Enforcement is local: `.githooks/pre-commit` runs `bun run check` on every
  commit, and `bun run verify` runs all four gates before tagging.
- **`bun run verify` chained is killed for memory on this machine.** Running `check`,
  `typecheck`, `lint`, `test`, `gate-2-round-trip` and `e2e` back to back in one process (its
  current shape) gets OOM-killed here; each stage passes cleanly run on its own (confirmed on
  `b9680dd`: check 11/11, typecheck 0, lint 0, test 2384 passing, GATE-2 168/168, e2e 111/111).
  Owed: make `verify` run its stages as separate processes, or split it into two documented
  commands (a light gate and an e2e gate) rather than one script that needs more memory than a
  dev machine reliably has.
- **Icon rendering verified with only the `lucide` collection.** The UI checklist's
  two-icon-pack requirement (`docs/UI-CHECKLIST.md` §11.1) is untested; carried forward
  from Phase 0's archive report.
- **The live-region screen-reader announcement was verified structurally, not with a
  real screen reader.** ARIA (`role="status" aria-live="polite"`) is present and
  correct; no screen-reader tooling (NVDA, JAWS, VoiceOver) has confirmed it is actually
  announced. Carried forward from Phase 0's archive report.
