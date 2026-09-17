# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A software team's members — engineers, product, design, support and leads together, not
engineers alone (confirmed 2026-09-15). They live inside **one workspace at a time**, the way
a person lives inside one Obsidian vault or one Slack team: the workspace is chosen once and
everything else happens inside it. Switching workspaces is rare and deliberate.

A second audience never sits at the screen: AI agents querying the same corpus over MCP as a
RAG surface. They shape what the product stores (block-anchored, permission-filtered
markdown), not what it shows.

## Product Purpose

A team brings a raw idea; the product interrogates it with AI until it is a well-declared
design document with diagrams; the resulting corpus becomes the team's single source of truth
and the knowledge base its agents read. Success is a team that writes its decisions down here
because it is the fastest place to write them and the only place agents will find them.

On opening the product at the start of a day, a member wants to see **what changed and who is
here** (confirmed 2026-09-15): the team's latest revisions, who is editing now, open comment
threads that mention them, and quick access to what they touched recently — the wiki as the
team's pulse, before it is anyone's notebook.

## Positioning

Markdown is the content the user owns, and the round trip through the editor is
byte-identical — a claim a Notion-style block database cannot truthfully make. Stable block
IDs survive edits, which makes comments, diffs ("moved", not "deleted and inserted"), AI
selections and RAG chunk provenance all anchor to the same thing. Permission-scoped from the
resolver up, so an agent can only retrieve what its principal may read.

## Operating Context

Self-hosted per team; Postgres with pgvector; Mailpit locally, real SMTP in production. The
hierarchy is Workspace → Shelves → Books (≈ projects) → Chapters → Pages. Absence and denial are
indistinguishable everywhere: a page you cannot read answers as one that does not exist.

Read mode is ~95% of traffic and serves cached, sanitised HTML with no editor code loaded.
Edit mode takes a soft lock with visible take-over. Presence is editing-only by decision.
Comments are an overlay composed client-side over the cached page.

Rule packs at team/cell level (stacks, conventions, corrections) are injected into AI work
and exports — Phase 6, not yet built.

## Capabilities and Constraints

Built and working on `main` at 2026-09-15: sign-in, password reset, invitations, workspace
creation with plan limits, members and grants, instance registration settings (Super Root),
the navigation tree with create/rename/reorder/fold, read and edit with live-preview
markdown, slash and mention menus, revision history, page and book diff with four change
classes, changesets grouped by a thirty-minute window, block-anchored comment threads with
orphan handling — started from read mode on any paragraph or heading, replied to and resolved
(2026-09-16) — presence chips, the workspace frame (sidebar mounted once, `/` reopening the
last workspace), focus mode (`Ctrl`/`⌘`+`\`) and a per-browser comments toggle on the read
screen.

Not yet: deleting anything (design decided 2026-09-17 — empty-to-delete, owner force with a
typed confirmation, trash with 30-day restore then purge — not yet built), commenting on a
list, code block, table or raw-HTML block, self-registration that leads anywhere (default-plan
policy decided 2026-09-17, not yet built), clickable wiki-links, block references, backlinks
or tags in the UI, a graph view over that link set, logout, diagram/image/SVG rendering
(Phase 4), any AI or MCP surface (Phases 5, 7), a `Ctrl`/`⌘`+`K` command palette, ZEN mode,
user-contributed colour themes, book mode (a book read continuously as its own scoped unit of
concentration, owner decision 2026-09-17), a team decisions register (owner decision
2026-09-17), a Super Root panel over every workspace and its plan (owner decision 2026-09-17),
and the two-level workspace dashboard — shelves, then a bookshelf of books with a user-chosen
colour and cover per book (owner decisions, 2026-09-16 and 2026-09-17 — `docs/TODO.md`
Phase 3.5).

Technical constraints that bind every screen: Nuxt 4 + Nuxt UI v4 on Bun; `packages/core`
has zero framework imports; one markdown parser; the ProseMirror document is a view, never
persisted; every tenant row carries a composite `(id, workspace_id)` key.

Terminology: workspace, shelf, book, chapter, page, block, anchor, changeset, revision,
thread, orphan, take-over, Super Root, cell, rule pack.

## Brand Commitments

Name: deep-wiki. Material Design 3 is the committed design language, translated for Nuxt UI
in `docs/DESIGN-SYSTEM.md`; user-selectable themes and icon packs are product features, so the
system must survive both. `docs/UI-CHECKLIST.md` is the pass/fail gate and wins on conflict.
Voice in the UI: plain, specific, never coy — an error says what happened and whether the work
survived.

## Evidence on Hand

Real seeded content (2 shelves, 4 books, 4 chapters, 7 pages), 2254 automated tests, 146
review screenshots of every current screen in the session scratchpad, a measured UI audit
(2026-09-14) and its remediation. No customers, testimonials, benchmarks or press — do not
fabricate any.

## Product Principles

1. The workspace is the room you are in; the tree is its furniture, always at hand, never a
   destination.
2. Opening the product answers "what happened and who is here" before anything else.
3. Markdown stays the truth, but a mixed team does not need to see it raw to trust it.
4. Every state is honest: loading looks like the thing loading, errors say what survived,
   denial looks like absence.
5. Density serves scanning, not cleverness: a mixed team reads more than it edits.
6. Interface chrome recedes so the document stays the primary surface — ZEN mode is the
   extreme of this, focus mode a lighter one (owner review, 2026-09-16).

## Accessibility & Inclusion

`docs/UI-CHECKLIST.md` §5 is the floor: keyboard-operable everything, accessible names on
icon-only controls, `aria-disabled` with a reason, 24px targets, 3:1 control boundaries,
announced async state, the tree as an ARIA tree. A mixed team includes people who do not live
in a terminal.
