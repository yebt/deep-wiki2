# Changesets Specification

## Purpose

Book-scoped, implicit grouping of page revisions by the same author inside a
time window, so book history reads as a sequence of changesets rather than
one row per save. No user-facing "commit" ceremony exists in this change.

## Requirements

### Requirement: The Grouping Window Is One Named Constant

The changeset grouping window MUST exist as exactly one named constant,
`CHANGESET_WINDOW_MINUTES`, declared once in `packages/contracts/src/env.ts`
and mirrored into `env.example`. No code path MUST read a literal window
value from anywhere else, and no stored row MUST encode the window.

#### Scenario: The constant has a single source of truth

- GIVEN the codebase after this change
- WHEN every reference to the changeset window is located
- THEN all of them resolve to `CHANGESET_WINDOW_MINUTES` from
  `packages/contracts/src/env.ts`, and none is a separately written number

#### Scenario: `env.example` drift fails the build

- GIVEN `env.example` is edited so its `CHANGESET_WINDOW_MINUTES` value no
  longer matches the schema default in `packages/contracts/src/env.ts`
- WHEN `bun run check` runs (`scripts/checks/env-example.ts`)
- THEN it fails, naming the drifted variable
- AND NOT a build that stays green while the two values disagree

### Requirement: Saves Group Implicitly By Author, Book, And Window

A page save MUST join an existing changeset when a changeset by the same
author in the same book was created within `CHANGESET_WINDOW_MINUTES` of the
current time; otherwise the save MUST start a new changeset. Grouping MUST
require no explicit user action.

#### Scenario: Two saves inside the window share a changeset

- GIVEN one author saves a page in a book, then saves a different page in the
  same book nine minutes later
- WHEN both revisions are inspected
- THEN they reference the same `changeset` row

#### Scenario: A save outside the window starts a new changeset

- GIVEN one author's last save in a book was more than
  `CHANGESET_WINDOW_MINUTES` ago
- WHEN they save again in that book
- THEN a new `changeset` row is created, distinct from the prior one

#### Scenario: Different authors never share a changeset

- GIVEN two different authors save pages in the same book within the window
- WHEN their revisions are inspected
- THEN each references its own changeset
- AND NOT a shared changeset attributed to either author alone

### Requirement: Changeset Tenant Isolation And Book Scope

`changeset` MUST carry a non-nullable `workspace_id` and a composite foreign
key `(book_id, workspace_id, 'book')` into `nodes`, enforced with a CHECK so
a changeset cannot attach to a non-book node.

#### Scenario: A changeset cannot attach to a chapter

- GIVEN a chapter node
- WHEN an insert attempts a `changeset` row with `book_id` naming that
  chapter
- THEN the database rejects the insert via the CHECK constraint

### Requirement: Changeset Carries An Optional Message

A changeset MUST support an optional free-text message, settable at any save
that belongs to it, and MUST function identically with no message set.

#### Scenario: A changeset with no message is still queryable

- GIVEN a changeset created with no message
- WHEN book history is queried
- THEN the changeset appears with its revisions and a null message, not an
  error

### Requirement: Book-Level History Is One Query

The system MUST provide a book-level history query returning changesets for
a book, each with its constituent revisions, in one query — not one query
per page. Authorisation follows `can()` with the `read` action on the book.

#### Scenario: Book history returns changesets with their revisions

- GIVEN a book with two changesets across three pages
- WHEN a subject with `read` requests that book's history
- THEN both changesets are returned, each listing the revisions it groups

#### Scenario: Book history denied without read

- GIVEN a subject with no `read` grant on a book
- WHEN they request its changeset history
- THEN the request is denied and no changeset data is returned
