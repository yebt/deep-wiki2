# Delta for Changesets

Base: `openspec/changes/versioning-and-collaboration/specs/changesets/spec.md`
(unarchived; `versioning-and-collaboration` is merged on `main` but not yet
archived).

## MODIFIED Requirements

### Requirement: Book-Level History Is One Query

The system MUST provide a book-level history query returning changesets for a
book, each with its constituent revisions, in one query — not one query per
page. Authorisation follows `can()` with the `read` action on the book. A
revision belonging to a trashed page MUST be excluded from this query for any
subject without `manage` on that page. The response MUST also carry
`deletions[]` for the same book and time window, alongside `changesets[]`; the
client renders both as one timeline ordered by time, while the changesets
themselves remain the product of the single query above.
(Previously: returned changesets and revisions only, with no trash exclusion
and no `deletions[]` field.)

#### Scenario: Book history returns changesets with their revisions

- GIVEN a book with two changesets across three pages
- WHEN a subject with `read` requests that book's history
- THEN both changesets are returned, each listing the revisions it groups

#### Scenario: Book history denied without read

- GIVEN a subject with no `read` grant on a book
- WHEN they request its changeset history
- THEN the request is denied and no changeset data is returned

#### Scenario: A trashed page's revisions are excluded for a non-manager

- GIVEN a book with a changeset covering a page later trashed, and a subject
  with `read` on the book but no `manage` on that page
- WHEN they request the book's history
- THEN the changeset's revisions for that page are excluded, though other
  pages' revisions in the same changeset still appear

#### Scenario: History response carries deletions alongside changesets

- GIVEN the same trashed page
- WHEN any subject with `read` on the book requests its history
- THEN the response includes a `deletions[]` entry stating the page was
  deleted, by whom, and when, alongside `changesets[]`

#### Scenario: Client renders one ordered timeline

- GIVEN a book history response containing both `changesets` and `deletions`
- WHEN the history screen renders it
- THEN changesets and deletions appear interleaved in one timeline ordered by
  time
