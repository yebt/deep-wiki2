# Delta for Comment Threads

Base: `openspec/changes/versioning-and-collaboration/specs/comment-threads/spec.md`
(unarchived; `versioning-and-collaboration` is merged on `main` but not yet
archived).

## MODIFIED Requirements

### Requirement: Comment Data Never Reaches A Subject Without Read

A comment on a page a subject cannot read, or on a page that is trashed and
the subject holds no `manage` grant on it, MUST NOT be observable by that
subject in any form — not the comment text, not its existence, not a count,
not an error distinguishing "no comments" from "no access".
(Previously: covered only the absence of a `read` grant; trash did not exist.)

#### Scenario: Unauthorised subject sees no evidence a comment exists

- GIVEN a page with an unresolved comment thread, and a subject with no
  `read` grant on that page
- WHEN that subject makes any request that could reveal comment data for
  that page
- THEN the response contains no comment id, text, author, or count for that
  page, verified with `expect-no-disclosure`-style scanning of the full
  response body
- AND NOT a response distinguishable from the response for a page with zero
  comments

#### Scenario: Former reader sees no evidence after the page is trashed

- GIVEN a page with a comment thread, and a subject who could read it before
  it was trashed, now holding no `manage` grant
- WHEN they make any request that could reveal comment data for that page
- THEN the response contains no comment id, text, author, or count, identical
  to a page with zero comments
