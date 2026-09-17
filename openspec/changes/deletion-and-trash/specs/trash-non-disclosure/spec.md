# Trash Non-Disclosure Specification

## Purpose

The mechanism that keeps a trashed node indistinguishable from an unknown one
to anyone without `manage`: one shared trash-aware read helper, and a
structural check that fails the build when a read site bypasses it. This is
GATE-1 posture applied to a new fact, following `core-purity-enforcement`'s
one-requirement-one-place precedent.

## Requirements

### Requirement: One Trash-Aware Mechanism Gates Every Read Of A Trashed Node

The system MUST expose exactly one mechanism for excluding a trashed node (or a
node under a trashed ancestor) from a read for any subject without `manage` on
it: a live-view pair, `live_nodes` and `live_page_content`, that a read site
MUST query in place of the base `nodes`/`page_content` tables. Every read
surface — tree, page read, backlinks, mentions, tags, activity, revisions,
diff, comments, presence, locks — MUST resolve through these views rather than
implementing its own trash predicate.

#### Scenario: A read surface excludes a trashed node through the live view

- GIVEN a page trashed by a manager
- WHEN a subject without `manage` requests it through any read surface
- THEN the surface reads `live_nodes`/`live_page_content` and responds as if
  the page did not exist

#### Scenario: A subject with manage still sees the trashed node

- GIVEN the same trashed page
- WHEN the manager who trashed it requests it through the Trash listing
- THEN the manage-gated lookup, reading the base table on purpose, permits it

### Requirement: A Structural Check Enforces The Mechanism With Two Rules

`bun run check` MUST include a check, in `query-boundaries.ts`'s enforcement
style, that fails under either of two rules: (1) a file outside a reasoned
allow-list MUST NOT name the base `nodes` or `page_content` table; (2) a file
outside the allow-list that reads a page-keyed table (for example
`page_revision`, `changeset`, `comments`, `links`, `page_tags`, `chunks`,
`page_locks`, `presence`) MUST also name one of the live views.

#### Scenario: Naming the base table outside the allow-list fails rule 1

- GIVEN a new route module that queries `page_content` directly, without
  naming a live view, and is not on the allow-list
- WHEN `bun run check` runs
- THEN it fails, naming the offending module and the rule

#### Scenario: A page-keyed read with no live view fails rule 2

- GIVEN a module that reads `changeset` rows for a book's history without
  naming `live_nodes` or `live_page_content`, and is not on the allow-list
- WHEN `bun run check` runs
- THEN it fails, naming the offending module and the rule

#### Scenario: A compliant read site passes both rules

- GIVEN a route module that reads through `live_nodes`/`live_page_content`
- WHEN `bun run check` runs
- THEN this check passes for that module

### Requirement: A Trashed Id Answers Identically To An Unknown Id

For a subject without `manage`, a request naming a trashed node's id MUST
produce a response byte-identical in status and body shape to a request naming
an id that never existed, for every read surface listed above.

#### Scenario: Former reader gets the same 404 as for an unknown id

- GIVEN a subject who could read a page before it was trashed, with no
  `manage` grant
- WHEN they request that page after it is trashed, and separately request a
  random unknown id
- THEN both responses are identical in status and body shape

#### Scenario: Backlinks and mentions carry no residual trace

- GIVEN the same trashed page, previously linked from and mentioned in other
  content
- WHEN the former reader requests backlinks, mentions, or autocomplete
  touching it
- THEN nothing in those responses reveals the page's former existence or title

### Requirement: Retrieval Over Chunks Goes Through The Same Helper

Any surface that queries `chunks` for retrieval (present or future) MUST
filter through the same trash-aware helper before a trashed page's content can
appear in results.

#### Scenario: A trashed page's chunks are excluded from retrieval

- GIVEN a trashed page with existing `chunks` rows still present pending purge
- WHEN a retrieval query runs for a subject without `manage`
- THEN no chunk sourced from that page appears in results
