# Comment Threads Specification

## Purpose

Comments anchored to `(block_id, offset_within_block)`, capturing their own
excerpt at creation so they can degrade to an orphan showing the original
text rather than ever pointing at someone else's block. Threads, resolution
state, and mention notifications over `MailSender`.

> Scope note: this spec enumerates a scenario per block lifecycle transition
> by explicit requirement — `docs/UI-CHECKLIST.md:143` forbids an anchor
> pointing at the wrong block, and that failure mode is only excluded by
> naming every transition, not by one representative case.

## Requirements

### Requirement: A Comment Captures Its Own Excerpt At Creation

Creating a comment MUST record, alongside its `(block_id, offset)` anchor,
an excerpt of the anchored text at that moment, independent of
`page_blocks.excerpt`. The captured excerpt MUST NOT change after creation.

#### Scenario: Excerpt is stored at creation and is immutable afterward

- GIVEN a comment anchored to a block's current text
- WHEN that block is later edited without splitting or merging
- THEN the comment's captured excerpt still reads the text at the time the
  comment was created, not the block's current text

### Requirement: Save-Time Reconciliation Resolves Every Anchor Per Block Transition

At save time, alongside `reconcileBlocks`, every comment anchored on the
saved page MUST be reconciled against the new block set. Each transition
resolves as follows:

| Block transition | Anchor resolution |
|---|---|
| Unchanged | Anchor stays on the same block id and offset |
| Modified in place (same id, text differs) | Anchor stays on the same block id; offset is re-validated against the new text length |
| Merged (id superseded) | Anchor resolves through the superseded chain to the surviving block if confidence is high; otherwise orphans |
| Split (new fragment minted) | Anchor resolves to the fragment matching the captured excerpt above threshold; otherwise orphans |
| Tombstoned (block deleted) | Anchor orphans unconditionally |

#### Scenario: Unchanged block keeps its anchor

- GIVEN a comment anchored to a block that is not touched by a save
- WHEN the page is saved
- THEN the comment's anchor is unchanged

#### Scenario: In-place edit keeps the anchor on the same block

- GIVEN a comment anchored to a block whose text is edited but not split or
  merged
- WHEN the page is saved
- THEN the comment's `block_id` is unchanged
- AND NOT reassigned to a different block id

#### Scenario: High-confidence merge follows the superseded chain

- GIVEN a comment anchored to a block that is merged into a neighbour with a
  match confidence above the reconciliation threshold
- WHEN the page is saved
- THEN the comment's anchor resolves to the surviving block id
- AND NOT left pointing at the now-superseded id with no resolution

#### Scenario: Low-confidence split orphans rather than guessing

- GIVEN a comment anchored to a block that splits into two fragments, where
  neither fragment matches the captured excerpt above the reconciliation
  threshold
- WHEN the page is saved
- THEN the comment becomes an orphan displaying its captured excerpt
- AND NOT attached to either fragment

#### Scenario: Tombstoned block always orphans

- GIVEN a comment anchored to a block that is deleted entirely
- WHEN the page is saved
- THEN the comment becomes an orphan displaying its captured excerpt

### Requirement: Orphan Is A First-Class State, Never An Error

An orphaned comment MUST render its captured excerpt and MUST NOT be treated
as a system error, a silent deletion, or a crash. A comment MUST NOT, under
any reconciliation outcome, resolve to a block whose text it was never
anchored to.

#### Scenario: An orphan never attaches to unrelated text

- GIVEN any block transition covered above
- WHEN reconciliation completes
- THEN the comment either stays correctly anchored or becomes an orphan
- AND NOT attached to a block containing text the comment was never created
  against

### Requirement: Threads And Resolution State

Comments on the same anchor MUST form a thread of replies, and a thread MUST
support a resolved/unresolved state, settable by a subject with `comment`.

#### Scenario: A reply joins the existing thread

- GIVEN an existing comment with one reply
- WHEN a second reply is posted to the same anchor
- THEN both replies appear in one thread, ordered by creation time

#### Scenario: Resolving a thread persists across reconciliation

- GIVEN a resolved thread anchored to a block that is later edited in place
- WHEN the page is saved and reconciliation runs
- THEN the thread's resolved state is unchanged

### Requirement: Mention Notifications Go Through MailSender

Mentioning a user inside a comment MUST send a notification through the
`MailSender` port. No credential, hash, or token MUST appear in the
notification content, be logged, or be rendered.

#### Scenario: A mention sends one notification

- GIVEN a comment mentioning one user with read access to the page
- WHEN the comment is created
- THEN exactly one notification is sent to that user through `MailSender`

#### Scenario: A mentioned user without read receives no notification

- GIVEN a comment mentions a user who has no `read` grant on the page
- WHEN the comment is created
- THEN no notification is sent to that user

### Requirement: Comment Data Never Reaches A Subject Without Read

A comment on a page a subject cannot read MUST NOT be observable by that
subject in any form — not the comment text, not its existence, not a count,
not an error distinguishing "no comments" from "no access".

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
