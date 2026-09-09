# Delta for Document Modes

## MODIFIED Requirements

### Requirement: Read Mode Serves Pre-Rendered HTML Without Reparsing

Requesting a page in read mode MUST serve the HTML cached at save time. It
MUST NOT reparse the Markdown or invoke the ProseMirror editor. The cached
HTML MAY carry invisible `data-block-id` attributes on anchored blocks, but
MUST NOT carry any per-viewer comment data, indicator, or count — that data
comes from a separate endpoint (see `comment-overlay`) and MUST NOT enter
this cache under any permission configuration.

(Previously: silent on block-identity attributes because none existed; this
adds the constraint that the new attribute is viewer-independent.)

#### Scenario: Read mode returns cached HTML

- GIVEN a page with a cached render
- WHEN it is loaded in read mode
- THEN the response is the cached HTML and the Markdown parser is not
  invoked for that request

#### Scenario: Cached HTML carries no per-viewer comment data

- GIVEN a page with comments, requested in read mode by two subjects with
  different `comment` permission
- WHEN both responses are compared
- THEN the cached HTML portion of both responses is byte-identical
- AND NOT a cache entry that varies by the requesting subject's permission

### Requirement: Heartbeat Keeps The Lock Alive

While a user remains in edit mode, the client MUST send periodic heartbeats
that update the lock's heartbeat timestamp. The same server-side heartbeat
operation MUST also refresh and broadcast that user's `editing` presence for
the page. No second, independently-scheduled heartbeat MUST exist for
presence.

(Previously: the heartbeat updated only the lock; this change makes it the
sole trigger for presence refresh and broadcast as well.)

#### Scenario: A heartbeat extends the active window

- GIVEN an active lock nearing its expiry threshold
- WHEN a heartbeat is received before that threshold elapses
- THEN the lock's heartbeat timestamp updates and it remains active

#### Scenario: A heartbeat also refreshes presence, with no second timer

- GIVEN an active edit session sending its periodic heartbeat
- WHEN the heartbeat request is handled
- THEN both the lock's heartbeat timestamp and the derived presence record
  are refreshed in the same operation
- AND NOT a separate client-driven presence heartbeat loop running
  alongside the lock heartbeat
