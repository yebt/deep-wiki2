# Document Modes Specification

## Purpose

Read mode and edit mode as distinct, load-bearing behaviours (docs/SPECS.md
§5.3). Read mode serves cached HTML and MUST NOT boot ProseMirror. Edit mode
takes a soft lock with a heartbeat and expires on silence, without depending
on the presence channel that arrives in Phase 3.

## Requirements

### Requirement: Read Mode Serves Pre-Rendered HTML Without Reparsing

Requesting a page in read mode MUST serve the HTML cached at save time. It
MUST NOT reparse the Markdown or invoke the ProseMirror editor.

#### Scenario: Read mode returns cached HTML

- GIVEN a page with a cached render
- WHEN it is loaded in read mode
- THEN the response is the cached HTML and the Markdown parser is not
  invoked for that request

### Requirement: ProseMirror Bundle Isolation Is Verified By Build Output

The ProseMirror/Milkdown bundle MUST be reachable only through a dynamically
imported edit-mode entry point. A build-output test MUST assert that the
read-mode route's JavaScript output contains no ProseMirror or Milkdown
module, so isolation is proven mechanically, not by review discipline.

#### Scenario: Read-mode bundle excludes the editor

- GIVEN a production build of the read-mode route
- WHEN its output chunks are inspected
- THEN none of them reference a ProseMirror or Milkdown module

#### Scenario: An eager shared import fails the test

- GIVEN a change that adds an eager import of the editor into a shared
  barrel file
- WHEN the build-output test runs
- THEN it fails, identifying the read-mode chunk as pulling in the editor

### Requirement: Edit Mode Acquires A Soft Lock On Entry

Entering edit mode MUST attempt to acquire a lock record carrying holder
identity, acquisition timestamp, and heartbeat timestamp. If no active lock
exists, entry MUST create one.

#### Scenario: First editor acquires the lock

- GIVEN no active lock exists on a page
- WHEN a user enters edit mode
- THEN a lock record is created naming that user as holder

#### Scenario: Entry does not silently seize an active lock

- GIVEN another user's active lock exists
- WHEN a second user attempts to enter edit mode
- THEN the lock's holder is not replaced without that user's explicit
  "take over" action

### Requirement: Heartbeat Keeps The Lock Alive

While a user remains in edit mode, the client MUST send periodic heartbeats
that update the lock's heartbeat timestamp.

#### Scenario: A heartbeat extends the active window

- GIVEN an active lock nearing its expiry threshold
- WHEN a heartbeat is received before that threshold elapses
- THEN the lock's heartbeat timestamp updates and it remains active

### Requirement: Lock Expiry Is Evaluated Server-Side On Read

A lock whose heartbeat is older than the expiry threshold MUST be treated as
expired the next time any request reads it, without requiring a background
job or the presence channel.

#### Scenario: Closed-laptop lock is expired on next read

- GIVEN a lock last heartbeated longer ago than the expiry threshold
- WHEN a different user requests edit mode
- THEN the prior lock is reported expired and does not block the new
  request from acquiring the lock

#### Scenario: Expiry holds with no presence channel present

- GIVEN a deployment with no presence/broadcast channel running
- WHEN a lock's heartbeat exceeds the expiry threshold
- THEN it is still correctly reported expired on the next read, because
  expiry evaluation depends only on the stored heartbeat timestamp

### Requirement: "Take Over" And "Open Read-Only" Are Always Both Offered

Whenever a page is locked by another holder, entering edit mode MUST present
both "take over" and "open read-only" as explicit, simultaneously visible
options. Neither MUST be offered without the other.

#### Scenario: Both options are visible together

- GIVEN an active lock held by another user
- WHEN a second user attempts to enter edit mode
- THEN both "take over" and "open read-only" are presented before the editor
  opens

#### Scenario: Take over transfers the lock

- GIVEN a second user chooses "take over"
- WHEN the action is confirmed
- THEN the lock's holder becomes the second user and the prior holder's
  session is treated as no longer holding the lock

### Requirement: Read-Only Entry Takes No Lock

Opening a page read-only — including via "open read-only" — MUST NOT create
or modify any lock record.

#### Scenario: Opening read-only leaves the existing lock untouched

- GIVEN another user's active lock on a page
- WHEN a subject chooses "open read-only"
- THEN the lock's holder and heartbeat remain unchanged
