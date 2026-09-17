# Deletion Trace Specification

## Purpose

An append-only record, keyed to the book, that survives the purge: the book's
history keeps saying "page X deleted by Y at T" — and "restored" too — after
the page itself, its content, and its revisions are gone.

## Requirements

### Requirement: The Trace Is Append-Only And Keyed To The Book

Every trash and restore operation on a page or container inside a book MUST
append a trace row keyed to that book, holding the deleted node's title
snapshot, the acting user, and the timestamp. A trace row MUST NOT be updated
once written.

#### Scenario: Trashing a page appends a trace row

- GIVEN a page inside a book
- WHEN the page is trashed
- THEN a trace row is appended to that book naming the page's title, the
  acting user, and the time

#### Scenario: An existing trace row is never edited

- GIVEN a trace row from an earlier trash
- WHEN any later trash, restore, or purge runs
- THEN that row's stored fields are unchanged

### Requirement: A Restore Also Appends A Trace Row

Restoring a node MUST append its own trace row to the same book, distinct from
the trash row, recording the restoring user and timestamp.

#### Scenario: Restoring a page appends a restore trace

- GIVEN the trace row from trashing a page
- WHEN the page is later restored
- THEN a second trace row appears recording the restore, and the original
  trash row is unchanged

### Requirement: The Trace Has No Cascading Foreign Key To The Deleted Node

The trace row MUST reference the deleted node without a foreign key that
cascades on the node's deletion, so the purge that removes the node MUST NOT
remove its trace.

#### Scenario: Purging the node leaves the trace intact

- GIVEN a trace row for a page later purged
- WHEN the purge deletes the page node
- THEN the trace row for that page still exists

### Requirement: The Trace Cascades Only With Its Book

A trace row MUST be removed if and only if its owning book is itself deleted
(purged); it MUST NOT be independently deletable or expirable.

#### Scenario: Purging the book removes its trace rows

- GIVEN a book eligible for purge with two trace rows
- WHEN the book node is purged
- THEN both trace rows are gone

#### Scenario: Purging one page does not remove the book's other trace rows

- GIVEN a book with trace rows for two separately purged pages
- WHEN one page is purged
- THEN the other page's trace row remains

### Requirement: A Restricted Trace Discloses Only That A Page Was Deleted To A Subject Who Could Not Have Read It

A trace row MUST carry a `restricted` snapshot, set at trash time, when the
deleted node held grants narrower than its book's. Book history MUST show a
`restricted` row's title and detail only to a subject who could have read the
deleted node; every other subject with `read` on the book MUST still see that
the row exists — "a page was deleted" — without its title.

#### Scenario: Restricted trace hides the title from a subject without access to the node

- GIVEN a page with grants narrower than its book, later trashed, producing a
  `restricted` trace row
- WHEN a subject with `read` on the book but no access to the deleted page
  views the book's history
- THEN the row shows that a page was deleted, without its title

#### Scenario: A subject who could read the node sees the full trace

- GIVEN the same `restricted` trace row
- WHEN a subject who could have read the deleted page views the book's history
- THEN the row shows the page's title, who deleted it, and when

#### Scenario: An unrestricted trace shows its title to any reader of the book

- GIVEN a page with no grants narrower than its book, later trashed
- WHEN any subject with `read` on the book views its history
- THEN the row shows the page's title

### Requirement: Book History Surfaces The Trace Line

The book's history view MUST include each trace row as a line stating the
action ("deleted" or "restored"), the node's title snapshot, the acting user,
and the timestamp, visible to any subject who can read the book's history.

#### Scenario: History shows the deletion line

- GIVEN a page trashed inside a book, and a subject with `read` on the book
- WHEN they view the book's history
- THEN a line reads that the page was deleted, by whom, and when

#### Scenario: History shows the restore line after the deletion line

- GIVEN the same page later restored
- WHEN the subject views the book's history again
- THEN both the deletion line and a restore line appear, in order
