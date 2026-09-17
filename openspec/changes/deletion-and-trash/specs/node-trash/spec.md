# Node Trash Specification

## Purpose

The trash operation on `nodes`: the empty-container rule, the owner's force-delete
with a typed name and a server-verified count, subtree propagation in one
transaction under one operation id, and the `manage`/owner gate. This capability
is what "delete" means in this product — a delete that always trashes, never a
hard delete on demand.

## Requirements

### Requirement: Trashing Requires Manage Or The Owner Force Rule

The system MUST require `manage` on the target node to trash it, or MUST require
the requester to be the workspace owner invoking the force rule. A subject
without `read` on the node MUST be denied with a response indistinguishable
from the node not existing. A subject with `read` but without `manage` or the
owner rule MUST be denied with `403`, naming the missing grant — a caller who
can already read the node discloses nothing new by being told they cannot
write to it (the `authorizeWrite` precedent).

#### Scenario: Manage subject trashes an empty container

- GIVEN a subject with `manage` on an empty chapter
- WHEN they trash it
- THEN the chapter is trashed and no other row changes

#### Scenario: Reader without manage or ownership gets a named 403

- GIVEN a subject with `read` but no `manage` on a node, and not the workspace
  owner
- WHEN they attempt to trash it
- THEN the request is denied with `403`, naming the missing grant, and no row
  changes

#### Scenario: Subject without read gets a 404 identical to nonexistence

- GIVEN a subject with no `read` grant on a node
- WHEN they attempt to trash it
- THEN the request is denied with `404`, identical to a request naming an
  unknown id

### Requirement: A Non-Empty Container Requires The Owner Force Rule

Trashing a container (shelf, book, chapter) that has one or more live children
MUST be refused for any requester who is not the workspace owner. A page (leaf)
carries no such restriction.

#### Scenario: Non-owner manager cannot trash a non-empty chapter

- GIVEN a manager with `manage` on a chapter containing one live page
- WHEN they attempt to trash the chapter
- THEN the request is refused, naming the non-empty reason, and no row changes

#### Scenario: Empty container trashes normally

- GIVEN a manager with `manage` on a chapter with zero live children
- WHEN they trash it
- THEN the chapter is trashed

### Requirement: Owner Force-Delete Requires The Typed Name And A Server-Verified Count

The owner force-trashing a non-empty container MUST submit the container's exact
current name and MUST be shown the count of live descendant pages that will be
trashed. The server MUST re-verify both the name and the count against current
state and MUST refuse a stale or mismatched submission.

#### Scenario: Correct name and current count succeeds

- GIVEN the owner viewing a chapter's force-trash confirmation naming 3 live pages
- WHEN they submit the chapter's exact name with that count
- THEN the chapter and its 3 live pages are trashed

#### Scenario: Stale count is refused

- GIVEN the owner's confirmation showed 3 live pages, and a fourth page was
  created under the chapter meanwhile
- WHEN they submit the original confirmation
- THEN the server refuses and no row changes

### Requirement: Trash Propagates To The Whole Live Subtree In One Transaction Under One Operation Id

Trashing a container MUST set `trashed_at` on the container and every live
descendant in one transaction, all stamped with the same trash-operation id.

#### Scenario: Subtree trashed atomically

- GIVEN a book with a chapter and two pages, all live
- WHEN the book is trashed
- THEN the book, the chapter, and both pages are trashed in one transaction,
  sharing one operation id

#### Scenario: Partial failure trashes nothing

- GIVEN a trash operation that fails partway through the transaction
- WHEN it rolls back
- THEN no node in the subtree is left trashed

### Requirement: Already-Trashed Descendants Are Excluded From The Empty Check And The Force Count

A descendant already trashed MUST count as absent for the empty-container rule
and MUST NOT be included in the force-delete's live-descendant count or
re-trashed.

#### Scenario: Container with only trashed children is empty

- GIVEN a chapter whose only child page was trashed separately
- WHEN a manager attempts to trash the chapter
- THEN the empty-container rule succeeds, treating the chapter as empty

#### Scenario: Force count excludes an already-trashed page

- GIVEN a chapter with one live page and one already-trashed page
- WHEN the owner requests the force-trash confirmation
- THEN the shown count is 1, and the already-trashed page keeps its original
  operation id
