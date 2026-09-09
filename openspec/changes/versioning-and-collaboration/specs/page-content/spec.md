# Delta for Page Content

## MODIFIED Requirements

### Requirement: Save Regenerates The Cached Render And Block Index

On every save, the system MUST regenerate the cached HTML render and the
block index from the newly saved canonical Markdown. Neither MUST be
accepted as client-supplied input or hand-edited independently of the
Markdown. The same save transaction MUST also write a `page_revision`
snapshot of the newly saved content and block index (see `revision-history`).
A save MUST NOT commit `page_content` without a matching `page_revision`.

(Previously: regenerated the cache and block index with no revision write;
the current row was the only record of the page's content.)

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

#### Scenario: Save also writes a revision in the same transaction

- GIVEN a page save request with changed Markdown
- WHEN the save transaction commits
- THEN a `page_revision` row exists whose content and block index match the
  values just written to `page_content`
- AND NOT a commit where `page_content` changed but no matching revision
  exists

## ADDED Requirements

### Requirement: Page Blocks Record Split Provenance

`page_blocks` MUST record, for a block minted by a split, the id of the
block it split from. A split fragment's origin MUST be persisted at save
time and MUST NOT be reconstructable only from external inference.

(This closes the gap where a split's new fragment previously received a
freshly minted id with no recorded origin at all —
`packages/db/drizzle/0008_page_content.sql:39-54` has no such column today.)

#### Scenario: A split fragment's origin is persisted

- GIVEN a save that splits a persisted-anchor block into two blocks
- WHEN the save completes
- THEN the newly minted fragment's `page_blocks` row records the id of the
  block it split from

### Requirement: The Superseded Chain Is Walkable And Path-Compressed

Resolving a block id through one or more merges MUST return the current
surviving block regardless of chain length, in one resolution call, and
repeated resolution of the same id MUST compress the path so later lookups
are direct. This MUST hold under property tests over arbitrary edit
sequences.

(This closes the gap where `supersededBy` was single-hop only, with no code
walking a multi-hop chain.)

#### Scenario: A three-hop merge chain resolves in one call

- GIVEN a block id superseded by a second id, itself later superseded by a
  third, surviving id
- WHEN the original id is resolved
- THEN the resolution returns the third, surviving id directly
- AND NOT a result requiring the caller to follow `superseded_by` manually
  across multiple lookups

#### Scenario: Property test holds across generated edit sequences

- GIVEN randomly generated sequences of splits and merges over a block set
- WHEN each sequence's final chain is resolved for every originally-existing
  id
- THEN every resolution reaches a block with `status = 'active'`
