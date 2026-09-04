# Permission Resolver Specification

## Purpose

The single authorisation path (GATE-1). One `permissions` table and one recursive-CTE
resolution walk the five-level resource hierarchy (Workspace → Shelf → Book → Chapter
→ Page) and apply two precedence rules unambiguously. Every read and write — HTTP,
MCP, jobs — MUST go through this resolver; a second, more permissive path for
machines is the failure this design exists to prevent.

> Scope note: this spec carries the GATE-1 truth table (~30 independently checkable
> scenarios) mandated for this change, exceeding the default spec size budget by
> explicit requirement — see the risks section of the phase return envelope.

## Requirements

### Requirement: Single Permissions Table

The system MUST store every grant in one `permissions` table with columns
`subject_type`, `subject_id`, `resource_type`, `resource_id`, `action`, and `effect`,
where `effect` is `allow` or `deny`. The system MUST NOT introduce per-level or
per-subject-type variant tables.

#### Scenario: Grant recorded in the single table

- GIVEN a workspace admin grants a user `read` on a book
- WHEN the grant is persisted
- THEN it is stored as one row in `permissions` with `resource_type = book`,
  `action = read`, `effect = allow`

### Requirement: Supported Subject Types

`subject_type` MUST accept `user`, `cell`, and `agent` as populated values in this
phase's flows. Every subject type resolves through the same table and the same
resolution path.

#### Scenario: Agent is a first-class subject

- GIVEN an agent identity with a scoped access token
- WHEN a grant is created with `subject_type = agent`
- THEN the grant resolves through the same `can()` entry point as a user grant, with
  no separate code path

### Requirement: Five-Level Ancestor Chain

Resolution MUST walk the resource's ancestor chain across exactly five levels —
Workspace, Shelf, Book, Chapter, Page — by following **`parent_id`**, not `nodes.path`.
The workspace MUST be materialised as a `nodes` row of type `workspace`, so the chain
has a real root and the resolver carries no workspace-level special case.

`nodes.path` is a derived cache maintained for subtree *navigation* queries. Authorisation MUST NOT depend on it: a stale or corrupted cache would silently grant or deny access. `parent_id` is the authoritative structure, the depth is bounded at five, and each step is a primary-key lookup.

#### Scenario A1: Workspace-level allow reaches a shelf

- GIVEN a user has `allow` on `read` at the workspace level and no other grant
- WHEN `can(user, read, shelf)` is evaluated for a shelf in that workspace
- THEN the result is `allow`

#### Scenario A2: Workspace-level allow reaches a book

- GIVEN a user has `allow` on `read` at the workspace level and no other grant
- WHEN `can(user, read, book)` is evaluated for a book in that workspace
- THEN the result is `allow`

#### Scenario A3: Workspace-level allow reaches a chapter

- GIVEN a user has `allow` on `read` at the workspace level and no other grant
- WHEN `can(user, read, chapter)` is evaluated for a chapter nested under that
  workspace
- THEN the result is `allow`

#### Scenario A4: Workspace-level allow reaches a page

- GIVEN a user has `allow` on `read` at the workspace level and no other grant
- WHEN `can(user, read, page)` is evaluated for a page nested under that workspace
- THEN the result is `allow`

#### Scenario A5: Shelf-level allow reaches a nested book

- GIVEN a user has `allow` on `read` at a shelf level and no workspace-level grant
- WHEN `can(user, read, book)` is evaluated for a book under that shelf
- THEN the result is `allow`

#### Scenario A6: Book-level allow reaches a page under a chapter

- GIVEN a user has `allow` on `read` at a book level and no grant at any other level
- WHEN `can(user, read, page)` is evaluated for a page under a chapter of that book
- THEN the result is `allow`

### Requirement: Deny Wins Over Allow at Equal Specificity

When two grants for the resolved subject set exist at the same ancestor level for the
same action, a `deny` MUST override an `allow`, regardless of which subject (direct
or inherited via cell) carries which effect.

#### Scenario B1: Deny and allow at the workspace level

- GIVEN a user has both `allow` and `deny` on `read` at the workspace level
- WHEN `can(user, read, workspace)` is evaluated
- THEN the result is `deny`

#### Scenario B2: Deny and allow at the page level

- GIVEN a user has both `allow` and `deny` on `write` directly on a page
- WHEN `can(user, write, page)` is evaluated
- THEN the result is `deny`

#### Scenario B3: Direct allow versus cell deny at the same level

- GIVEN a user has a direct `allow` on a book and their cell has a `deny` on the same
  book, same action
- WHEN `can(user, action, book)` is evaluated
- THEN the result is `deny`

#### Scenario B4: Two grants at the chapter level

- GIVEN a chapter carries one `allow` and one `deny` row for the same action and the
  same resolved subject set
- WHEN `can()` is evaluated for that chapter
- THEN the result is `deny`

### Requirement: More Specific Level Overrides Less Specific

A grant at a more specific resource level MUST override a grant at a less specific
ancestor level for the same action, including when the specific grant is `allow` and
the inherited grant is `deny`.

#### Scenario C1: Shelf allow overrides workspace deny

- GIVEN a `deny` at the workspace level and an `allow` at a shelf within it, same
  action
- WHEN `can()` is evaluated for that shelf
- THEN the result is `allow`

#### Scenario C2: Book allow overrides workspace deny

- GIVEN a `deny` at the workspace level and an `allow` at a book within it, same
  action
- WHEN `can()` is evaluated for that book
- THEN the result is `allow`

#### Scenario C3: Book allow overrides shelf deny

- GIVEN a `deny` at a shelf level and an `allow` at a book under that shelf, same
  action
- WHEN `can()` is evaluated for that book
- THEN the result is `allow`

#### Scenario C4: Chapter allow overrides book deny

- GIVEN a `deny` at a book level and an `allow` at a chapter under that book, same
  action
- WHEN `can()` is evaluated for that chapter
- THEN the result is `allow`

#### Scenario C5: Page allow overrides chapter deny

- GIVEN a `deny` at a chapter level and an `allow` at a page under that chapter, same
  action
- WHEN `can()` is evaluated for that page
- THEN the result is `allow`

### Requirement: Cell Membership Grants

A grant on a cell MUST resolve for every current member of that cell, combined with
the member's own direct grants under the same precedence rules.

#### Scenario D1: Cell grant reaches a member with no direct grant

- GIVEN a user with no direct grant, member of a cell with `allow` on `read` at a book
  level
- WHEN `can(user, read, book)` is evaluated
- THEN the result is `allow`

#### Scenario D2: Conflicting grants from two cells

- GIVEN a user is a member of cell A (`allow`) and cell B (`deny`), both on `read` at
  the same book, same specificity
- WHEN `can(user, read, book)` is evaluated
- THEN the result is `deny`

#### Scenario D3: Direct allow versus cell deny, same specificity

- GIVEN a user has a direct `allow` on a page and their cell has `deny` on the same
  page, same action
- WHEN `can(user, action, page)` is evaluated
- THEN the result is `deny`

#### Scenario D4: Cell allow at a more specific level overrides direct deny

- GIVEN a user has a direct `deny` at a book level and their cell has `allow` at a
  chapter under that book, same action
- WHEN `can(user, action, chapter)` is evaluated
- THEN the result is `allow`

#### Scenario D5: Removed membership no longer grants access

- GIVEN a user was a member of a cell with `allow` on a book, and membership is
  removed
- WHEN `can(user, action, book)` is evaluated after removal
- THEN the result is `deny` (absent any other grant)

### Requirement: Agent Subject Scoped to One Book

An `agent` subject's grant MUST be resolvable exactly as any other subject, scoped to
the specific resources it was granted.

#### Scenario E1: Agent allow reaches nested pages

- GIVEN an agent has `allow` on `read` scoped to one book
- WHEN `can(agent, read, page)` is evaluated for a page under that book
- THEN the result is `allow`

#### Scenario E2: Agent has no reach into a sibling book

- GIVEN an agent scoped to book A with no grant on book B
- WHEN `can(agent, read, book)` is evaluated for book B
- THEN the result is `deny`

#### Scenario E3: Agent grant is action-specific

- GIVEN an agent has `allow` on `read` only, scoped to a book
- WHEN `can(agent, write, page)` is evaluated for a page under that book
- THEN the result is `deny`

#### Scenario E4: Revoked agent grant

- GIVEN an agent's `allow` grant on a book is deleted
- WHEN `can(agent, read, book)` is evaluated afterward
- THEN the result is `deny`

### Requirement: Cross-Workspace Isolation

No grant MUST resolve for a resource outside the `workspace_id` of the subject's
grants; the ancestor walk MUST NOT cross a `workspace_id` boundary.

#### Scenario F1: No leak by coincidental resource shape

- GIVEN a subject with `allow` on `read` at a book in workspace A
- WHEN `can(subject, read, book)` is evaluated for a distinct book with the same
  action in workspace B
- THEN the result is `deny`

#### Scenario F2: Workspace admin has no cross-workspace reach

- GIVEN a user is Workspace Admin in workspace A
- WHEN `can(user, manage, workspace)` is evaluated for workspace B
- THEN the result is `deny`

#### Scenario F3: Cell membership does not cross workspaces

- GIVEN a user is a member of a cell in workspace A with `allow` on a book
- WHEN `can(user, read, book)` is evaluated for a book in workspace B
- THEN the result is `deny`

#### Scenario F4: Agent scope does not cross workspaces

- GIVEN an agent is scoped to a book in workspace A
- WHEN `can(agent, read, book)` is evaluated for a book in workspace B
- THEN the result is `deny`

### Requirement: Default Deny on No Matching Grant

When no grant row matches the subject set for the resource or any of its ancestors,
resolution MUST return `deny`.

#### Scenario G1: No grants at all

- GIVEN a subject with zero `permissions` rows
- WHEN `can(subject, read, page)` is evaluated
- THEN the result is `deny`

#### Scenario G2: Grants exist but for unrelated resources

- GIVEN a subject has grants only on resources that are not the target or its
  ancestors
- WHEN `can(subject, read, page)` is evaluated for the unrelated page
- THEN the result is `deny`

### Requirement: Single-Query Resolution

`can(subject, action, resource)` MUST resolve in one query (a single recursive CTE)
against the database, not through per-resource-level queries issued from application
code.

#### Scenario: One query per resolution

- GIVEN a resolution request for a page five levels deep
- WHEN `can()` executes
- THEN exactly one SQL statement is issued to resolve the full ancestor chain

### Requirement: Tenant Scope Derived from the Authenticated Subject

The `workspace_id` used to scope a resolution MUST be derived from the authenticated
subject's session or token, and MUST NOT be accepted from the request body or query
parameters.

#### Scenario: Request-supplied workspace is ignored

- GIVEN an authenticated session bound to workspace A
- WHEN a request body includes a different `workspace_id` value
- THEN the resolver uses workspace A and ignores the request-supplied value
