# Trash Purge Specification

## Purpose

The 30-day purge: a tracked, idempotent, per-workspace job that deletes nodes
trashed 30 or more days ago, letting the existing cascade chain remove their
content, revisions, comments, chunks, and grants — the accident becomes the
mechanism, by choice, on a schedule.

## Requirements

### Requirement: Purge Runs As A Tracked, Idempotent, Per-Workspace Job

The purge MUST run as an explicit job with a recorded state (`queued`,
`running`, `completed`, `failed`), one job execution per workspace, following
the existing tracked-job idiom. Re-running a completed job MUST be a no-op.

#### Scenario: A purge job records its run

- GIVEN a workspace with nodes trashed more than 30 days ago
- WHEN the purge job runs for that workspace
- THEN a job row exists recording the run's state through to `completed`

#### Scenario: Re-running a completed purge changes nothing

- GIVEN a purge job already `completed` for a workspace with nothing newly
  eligible
- WHEN the purge runs again
- THEN no additional row is deleted and the job completes as a no-op

### Requirement: Purge Selects Only Nodes Trashed 30 Or More Days Ago

The purge MUST select nodes whose `trashed_at` is at least 30 days in the past,
evaluated in the query itself, and MUST NOT delete a node trashed more recently.

#### Scenario: A node trashed 29 days ago is untouched

- GIVEN a node trashed 29 days ago
- WHEN the purge runs
- THEN that node is not deleted

#### Scenario: A node trashed 31 days ago is purged

- GIVEN a node trashed 31 days ago
- WHEN the purge runs
- THEN that node is deleted

### Requirement: No On-Demand Purge Exists

The system MUST NOT expose any action, route, or UI control that purges a node
before its 30-day retention elapses.

#### Scenario: No "empty trash now" action is reachable

- GIVEN a subject viewing the Trash listing, including the workspace owner
- WHEN they look for a way to purge immediately
- THEN no such action exists in the system

### Requirement: Purge Deletion Cascades Content, Revisions, Comments, Chunks, And Grants

Deleting a purged node MUST result in its `page_content`, `page_revision`,
comments, `chunks`, and `permissions` grants being removed via the existing
foreign-key cascade, requiring no separate cleanup step.

#### Scenario: Purging a page removes its dependent rows

- GIVEN a trashed page eligible for purge, with content, two revisions, one
  comment, and chunks
- WHEN the purge job deletes the node
- THEN its content, revisions, comment, and chunks are gone

#### Scenario: Purging a book removes its changesets

- GIVEN a trashed book eligible for purge with a changeset over its pages
- WHEN the purge job deletes the book node
- THEN the changeset is gone along with it
