# AI Usage Accounting Specification

## Purpose

Turns per-call usage into an enforced budget, not an advisory report: an admission
check sits in the same server path that constructs every provider call, and a
workspace over its plan limit is refused before the call is made.

## Requirements

### Requirement: Usage Ledger

Every provider call MUST be logged to `ai_usage_events` with provider, model, input
tokens, output tokens, computed cost, `workspace_id`, and the initiating subject.
`workspace_id` MUST be non-nullable, tied by the composite `(id, workspace_id)`
foreign-key pattern, and derived from the authenticated subject.

#### Scenario: Successful call is recorded

- GIVEN a completed chat call
- WHEN it finishes
- THEN an `ai_usage_events` row is written with provider, model, token counts, cost,
  and the calling workspace and subject

#### Scenario: Workspace on the event cannot be forged

- GIVEN a provider call in progress for workspace A
- WHEN the usage event is written
- THEN `workspace_id` is workspace A regardless of any value present in the request
  body

### Requirement: Pre-Call Admission Enforcement

Before any provider call is constructed, the system MUST check the initiating
workspace's plan budget. A workspace at or over its limit MUST be refused before the
call is made, with a user-facing reason naming the limit.

#### Scenario: Call proceeds under budget

- GIVEN a workspace with remaining budget
- WHEN a chat call is requested
- THEN the admission check passes and the provider call is constructed

#### Scenario: Call refused over budget

- GIVEN a workspace already at its plan's usage limit
- WHEN a chat call is requested
- THEN the system refuses the request before any provider call is issued, with a
  reason naming the plan limit

### Requirement: Streaming Reservation and Reconciliation

For a streaming call, admission MUST reserve an estimated cost against the workspace's
budget before the stream starts, and MUST reconcile that reservation against the
actual usage once the stream completes.

#### Scenario: Estimate reserved at stream start

- GIVEN a workspace under budget
- WHEN a streaming call is admitted
- THEN an estimated cost is reserved against the workspace's budget before the first
  token is requested

#### Scenario: Actual cost reconciles on completion

- GIVEN a completed stream whose actual token usage differs from its reservation
- WHEN the stream finishes
- THEN the ledger reflects the actual computed cost, and the reservation is released

#### Scenario: Overage from an in-flight stream blocks the next call

- GIVEN a stream that was admitted under budget but whose actual cost pushes the
  workspace over its limit
- WHEN the stream completes and a subsequent call is requested
- THEN the subsequent call is refused by the admission check, even though the
  completed stream was allowed to finish
