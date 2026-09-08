# Revision History Specification

## Purpose

`page_revision`: an immutable snapshot of a page's canonical Markdown and block
index, written inside the same transaction as the ordinary save. This closes
the gap left by `page-content` ("Single Current Row Per Page"): the current
row is overwritten on every save, and until now the prior version existed
nowhere.

## Requirements

### Requirement: Revision Is Written In The Save Transaction

Saving a page MUST write a `page_revision` row in the same database
transaction as the `page_content` update. A save MUST NOT commit
`page_content` changes without a corresponding revision, and MUST NOT commit
a revision without the corresponding `page_content` change.

#### Scenario: Successful save produces exactly one new revision

- GIVEN a page save request with changed Markdown
- WHEN the save transaction commits
- THEN exactly one new `page_revision` row exists for that page, and its
  content matches the newly saved `page_content` row
- AND NOT a save that leaves `page_content` updated while no matching
  revision exists

#### Scenario: A failed save writes neither

- GIVEN a save request that fails after content validation but before commit
- WHEN the transaction rolls back
- THEN neither `page_content` nor `page_revision` reflects the failed attempt

### Requirement: Revision Snapshots Content And Its Own Block Index

A `page_revision` row MUST store the canonical Markdown and a block index
built from that exact Markdown via `buildBlockIndex()`, at the moment of that
save — not a reference to a later or earlier state.

#### Scenario: Revision block index matches the revision's own content

- GIVEN a page saved twice with different anchored blocks each time
- WHEN both revisions are inspected
- THEN each revision's block index reflects only the anchors present in that
  revision's own Markdown, not the other revision's

### Requirement: Revision Is Immutable And Retention Is Undecided

Once written, a `page_revision` row MUST NOT be updated or deleted by any
code path in this change. This change defines no retention or pruning
policy; a revision persists indefinitely.

#### Scenario: No code path mutates a written revision

- GIVEN a persisted `page_revision` row
- WHEN any save, diff, comment, or presence operation runs afterward
- THEN that row's stored content and block index are unchanged
- AND NOT a code path that rewrites or removes a revision to reclaim space

### Requirement: Revision Tenant Isolation By Composite Foreign Key

`page_revision` MUST carry a non-nullable `workspace_id` and a composite
foreign key `(page_id, workspace_id)` into `page_content`, and — when the
revision belongs to a changeset — a composite foreign key
`(changeset_id, workspace_id)` into `changeset`. A cross-tenant reference
MUST be unrepresentable, not merely unqueried.

#### Scenario: Cross-tenant revision insert is rejected

- GIVEN a page in workspace A
- WHEN an insert attempts a `page_revision` row naming that page's id but
  workspace B
- THEN the database rejects the insert via the composite foreign key

### Requirement: Page History Query Returns Revisions Newest First

The system MUST provide a page-history query returning that page's revisions
ordered newest first, authorised through `can()` with the `read` action.

#### Scenario: History query orders and authorises

- GIVEN a page with three saved revisions
- WHEN a subject with `read` requests its history
- THEN the three revisions are returned newest first

#### Scenario: History denied without read

- GIVEN a subject with no `read` grant on a page
- WHEN they request its revision history
- THEN the request is denied and no revision data is returned
