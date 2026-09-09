# Comment Overlay Specification

## Purpose

Comment visibility as an overlay composed client-side, never a fork of the
cached HTML. `render()` emits an invisible `data-block-id` per anchored
block; indicators and counts come from a separate endpoint gated by
`can('comment')`; the client composes them onto the unchanged cached HTML.
This resolves the tension recorded in `docs/SPECS.md` §14 that read mode's
cache cannot bake in a per-viewer decision.

## Requirements

### Requirement: `rendered_html` Stays One Blob Per Page

The cached HTML render MUST remain exactly one row per page, identical for
every viewer regardless of their `comment` permission. No per-viewer variant
of `rendered_html` MUST be persisted, computed, or cached.

#### Scenario: Two viewers with different comment permission receive identical HTML

- GIVEN one viewer with `read` and `comment`, and a second with `read` only
- WHEN both request the same page in read mode
- THEN both receive byte-identical `rendered_html`
- AND NOT a cache entry keyed by viewer or by permission

### Requirement: `render()` Emits An Invisible Block Identity Attribute

`render()` MUST emit a `data-block-id` attribute on every block carrying a
persisted anchor, and MUST NOT change the block's visible rendering to do
so. A block with no persisted anchor MUST carry no such attribute.

#### Scenario: The attribute carries no visible change

- GIVEN a block with a persisted anchor
- WHEN it is rendered
- THEN the output element carries `data-block-id` and its visible text and
  styling are unchanged from before this attribute existed

#### Scenario: An unanchored block carries no attribute

- GIVEN a block with no persisted anchor
- WHEN it is rendered
- THEN its output element carries no `data-block-id`

### Requirement: Indicators And Counts Come From A Separate Endpoint Gated By can('comment')

Comment indicator and count data for a page MUST be served by an endpoint
distinct from the page-content endpoint, authorised through `can()` with the
`comment` action. This endpoint MUST NOT be reachable through the read-mode
content response.

#### Scenario: A subject with read but not comment receives no indicator

- GIVEN a subject with `read` but no `comment` grant on a page that has
  comments
- WHEN they request the comment-indicator endpoint for that page
- THEN the response contains no indicator, no count, and no evidence that a
  comment exists on any block
- AND NOT a response shaped differently from the response for a page with
  zero comments

#### Scenario: A subject with comment receives real indicators

- GIVEN a subject with `read` and `comment` on a page with two commented
  blocks
- WHEN they request the comment-indicator endpoint
- THEN the response names those two block ids with their comment counts

### Requirement: The Client Composes Indicators Onto Unchanged Cached HTML

The client MUST render the cached HTML unmodified and overlay comment
indicators onto elements matched by `data-block-id`, without requesting a
different HTML render per permission level.

#### Scenario: Composition does not alter the underlying HTML fetch

- GIVEN a page load in read mode for a subject with `comment`
- WHEN the page and its indicators are both fetched
- THEN the HTML request and response are identical to the request a
  `comment`-less subject would make

### Requirement: A Comment On An Unanchored Block Mints And Persists An Anchor

Creating a comment on a block with no persisted id MUST mint a new
persisted anchor, using the existing lazy-assignment mechanism, and MUST
write it into the canonical Markdown. The mint MUST round-trip
byte-identically through the GATE-2 corpus.

#### Scenario: Minting a comment anchor updates canonical Markdown

- GIVEN a block with no persisted anchor
- WHEN a comment is created on that block
- THEN the block's canonical Markdown now carries a persisted anchor, and
  reparsing and re-serialising that Markdown reproduces it byte-identically

### Requirement: A Render-Format Change Requires A Backfill

Because emitting `data-block-id` changes the cached render format, every
`rendered_html` row written before this change is stale. The system MUST
provide a backfill that re-renders every page's cached HTML from its
canonical Markdown, and MUST treat a page missing the attribute as "no
anchors known" rather than an error.

#### Scenario: A pre-backfill page degrades gracefully

- GIVEN a page whose `rendered_html` predates this change and carries no
  `data-block-id` attributes
- WHEN its comment indicators are requested
- THEN the response reports no anchored blocks rather than failing
- AND NOT an error surfaced to the viewer

#### Scenario: Backfill produces the current render format

- GIVEN a page saved before this change
- WHEN the backfill runs
- THEN its `rendered_html` is regenerated from its canonical Markdown and
  carries `data-block-id` for every persisted anchor
