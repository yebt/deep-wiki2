# Page Content Specification

## Purpose

Storage for a page's canonical Markdown, its cached rendered HTML, and its
block index. After Phase 1, `packages/db/src/schema.ts` has no column
anywhere that stores a page's Markdown (docs/TODO.md Findings,
2026-09-04); this capability closes that gap. Revisions and changesets stay
Phase 3 — this capability stores only the current version of a page.

## Requirements

### Requirement: Page Content Table Stores Canonical Markdown

The system MUST store, per page node, its canonical Markdown, a cached
rendered HTML, a block index, and the owning `workspace_id`. `workspace_id`
MUST be non-nullable and derived server-side, consistent with every other
tenant-scoped table.

#### Scenario: Saving a page persists canonical Markdown unchanged

- GIVEN a page save request with Markdown content
- WHEN the save completes
- THEN the stored content is the exact Markdown submitted, with no
  transformation applied to the canonical text

#### Scenario: Row without a workspace is rejected

- GIVEN an insert into the page content table
- WHEN `workspace_id` is omitted or null
- THEN the database rejects the insert

### Requirement: Single Current Row Per Page

The system MUST store only the current canonical Markdown per page as a
single row; this phase MUST NOT persist historical versions.

#### Scenario: Re-saving overwrites rather than appending

- GIVEN a page with existing stored content
- WHEN it is saved again with different content
- THEN the existing row is overwritten and no additional historical row is
  created

### Requirement: Save Regenerates The Cached Render And Block Index

On every save, the system MUST regenerate the cached HTML render and the
block index from the newly saved canonical Markdown. Neither MUST be
accepted as client-supplied input or hand-edited independently of the
Markdown.

#### Scenario: Cached HTML reflects the new content

- GIVEN a page save with changed Markdown
- WHEN the save completes
- THEN the cached HTML render matches the newly saved Markdown, not the
  prior version

#### Scenario: Block index reflects new block boundaries

- GIVEN a save that adds a new paragraph
- WHEN the save completes
- THEN the block index includes an entry consistent with the new block
  boundaries

### Requirement: Read Mode And Edit Mode Read Different Representations

Requesting a page for read mode MUST return the cached HTML without
reparsing the Markdown. Requesting a page for edit mode MUST return the
canonical Markdown.

#### Scenario: Read mode request returns cached HTML

- GIVEN a stored page with a cached render
- WHEN it is requested for read mode
- THEN the response is the cached HTML, and the Markdown parser is not
  invoked for that request

#### Scenario: Edit mode request returns canonical Markdown

- GIVEN a stored page
- WHEN it is requested for edit mode
- THEN the response is the canonical Markdown text

### Requirement: Content Access Goes Through can()

Reading or saving page content MUST be authorised through `can()` with the
action appropriate to the operation (`read` for viewing, `write` for
saving). No route MUST query or persist page content without that check.

#### Scenario: Read denied without permission

- GIVEN a subject with no `read` grant reaching a page
- WHEN they request that page's content
- THEN the request is denied and no content is returned

#### Scenario: Save denied without permission

- GIVEN a subject with no `write` grant reaching a page
- WHEN they attempt to save content to it
- THEN the request is denied and the stored content is unchanged
