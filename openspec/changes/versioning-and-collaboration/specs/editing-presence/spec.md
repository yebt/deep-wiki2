# Editing Presence Specification

## Purpose

Presence for `editing` activity only, derived from the soft lock's existing
heartbeat (`packages/db/src/locks/page-lock.ts`,
`PAGE_LOCK_HEARTBEAT_SECONDS=20`) rather than a second independent heartbeat.
Broadcast over an SSE channel, filtered per subscriber at the page level
before any event leaves the server. "Who is reading this right now" is
explicitly out of scope for this change.

> Scope note: this is the highest-likelihood risk the proposal names —
> workspace-scoped fan-out is the natural implementation and the wrong one —
> so the non-disclosure requirement below is written with an
> unauthorised-subject scenario, not as an optimisation note.

## Requirements

### Requirement: Presence Represents `editing` Activity Only

Presence tracked and broadcast by this change MUST represent only the
`editing` mode, derived from an active soft lock. This change MUST NOT track
or broadcast a `viewing` mode or any other read-path activity.

#### Scenario: Viewing a page produces no presence event

- GIVEN a subject opens a page in read mode
- WHEN presence events for that page are observed
- THEN no event is emitted for that read, because no lock was acquired
- AND NOT an event whose mode is anything other than `editing`

### Requirement: Presence Has No Write Path Independent Of The Lock Heartbeat

Every presence refresh and broadcast MUST originate from the same request
that refreshes `page_locks.heartbeat_at`. No independent presence heartbeat,
timer, or TTL MUST exist.

#### Scenario: No code path refreshes presence without heartbeating the lock

- GIVEN the full set of code paths that update presence data
- WHEN each is inspected
- THEN every one of them also calls the lock heartbeat function in the same
  operation
- AND NOT a code path that updates presence while bypassing
  `heartbeatLock()`

#### Scenario: A lock heartbeat always refreshes presence

- GIVEN an active edit session sending its periodic heartbeat
- WHEN the heartbeat request completes
- THEN the presence record for that user and page is refreshed to match

### Requirement: Presence Table Tenant Isolation By Composite Foreign Key

`presence` MUST carry a non-nullable `workspace_id` and a composite foreign
key `(page_id, workspace_id)` into `page_content`, matching the pattern
every other tenant-scoped table in this project uses. This closes the gap
in the `docs/SPECS.md` §7.2 draft, which omits it.

#### Scenario: Cross-tenant presence insert is rejected

- GIVEN a page in workspace A
- WHEN an insert attempts a `presence` row naming that page's id but
  workspace B
- THEN the database rejects the insert via the composite foreign key

### Requirement: Presence Events Are Filtered Per Subscriber At The Page Level Before Broadcast

Before a presence event leaves the server to any SSE subscriber, the server
MUST filter it against that specific subscriber's `read` permission on the
event's page. Workspace membership alone MUST NOT be sufficient to receive a
page's presence event.

#### Scenario: A workspace member without page read receives no event for that page

- GIVEN two workspace members, A editing page X and B who is a member of the
  same workspace but has no `read` grant on page X
- WHEN A's edit session heartbeats and a presence event for page X is
  broadcast
- THEN B's SSE connection receives no event naming page X, its title, or its
  id
- AND NOT an event that merely omits the title while still naming the page
  id, which would still disclose the page's existence

#### Scenario: A workspace member with page read receives the event

- GIVEN the same setup, but B has `read` on page X
- WHEN A's presence event is broadcast
- THEN B's SSE connection receives the event naming A, page X, and the
  editing start time

#### Scenario: Filtering is per subscriber, not per broadcast

- GIVEN one presence event on page X, and two subscribers where one can read
  page X and the other cannot
- WHEN the event is broadcast
- THEN the subscriber with read receives it and the other does not, from the
  same underlying broadcast
- AND NOT a single workspace-wide broadcast that reaches both and relies on
  the client to hide it

### Requirement: Presence Surfaces Who And Since When

A presence indicator MUST name the editing user and how long they have been
editing, not an anonymous marker.

#### Scenario: Presence names the editor and duration

- GIVEN a subject with read on a page being edited by another user for four
  minutes
- WHEN that subject requests presence for the page
- THEN the response identifies the editor and states the elapsed duration

### Requirement: Stale Presence Expires Visibly, Tied To The Lock TTL

A presence record whose underlying lock has expired MUST be reported as no
longer editing, evaluated against the same TTL the lock itself uses. No
separate presence TTL MUST exist.

#### Scenario: An expired lock reports no active presence

- GIVEN a lock whose heartbeat is older than `PAGE_LOCK_HEARTBEAT_SECONDS`'s
  associated expiry threshold
- WHEN presence for that page is requested
- THEN no active `editing` presence is reported for the prior holder
- AND NOT a presence record that outlives the lock it was derived from
