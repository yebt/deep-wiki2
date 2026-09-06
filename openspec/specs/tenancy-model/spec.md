# Tenancy Model Specification

## Purpose

Defines the multi-tenant skeleton: workspaces as the unit of isolation, the `nodes`
navigation tree, cells (teams) as group subjects, the Super Root global operator, and
plan limits bounding workspace creation. This is the foundation `permission-resolver`
walks and the tenant boundary future GATE-3 queries filter on.

## Requirements

### Requirement: Node Tree Structure

The system MUST store the navigation hierarchy in a single `nodes` table with columns
`id`, `workspace_id`, `parent_id`, `type` (`shelf` | `book` | `chapter` | `page`),
`position`, and a materialised ancestry `path`. A page MUST be permitted to have a
`book` as its direct parent, without an intervening chapter.

#### Scenario: Page created directly under a book

- GIVEN a book node with no chapters
- WHEN a page is created with that book as `parent_id`
- THEN the page node is persisted with `type = page` and the book as its parent

#### Scenario: Page created under a chapter

- GIVEN a chapter node under a book
- WHEN a page is created with that chapter as `parent_id`
- THEN the page node is persisted with the chapter as its parent

### Requirement: Materialised Path as Text with `text_pattern_ops`

The `nodes.path` column MUST be stored as `text` containing the ancestor node IDs, and
MUST be indexed with a `text_pattern_ops` index to keep prefix (subtree) queries
index-backed. The system MUST NOT use the Postgres `ltree` type or a GiST index for
this column.

#### Scenario: Subtree query uses the index

- GIVEN a `nodes` table populated across multiple workspaces
- WHEN a query selects all descendants of a node by matching a `path` prefix
- THEN the query plan uses the `text_pattern_ops` index rather than a sequential scan

### Requirement: Sibling Ordering

Sibling nodes under the same parent MUST be ordered by an integer `position` column,
distinct and stable within that parent.

#### Scenario: New sibling appended

- GIVEN three sibling nodes under a chapter with positions 0, 1, 2
- WHEN a fourth sibling is created under the same chapter
- THEN it receives a `position` greater than all existing siblings

### Requirement: Subtree Move Rewrites Path

Moving a node to a new parent MUST rewrite `path` for that node and every descendant
so the ancestry stays consistent, and MUST assign it a `position` among its new
siblings.

#### Scenario: Moved chapter carries its pages

- GIVEN a chapter with two pages, currently under book A
- WHEN the chapter is reparented under book B
- THEN the chapter's `path` reflects book B as an ancestor, and both pages' `path`
  values are rewritten to include the chapter's new ancestry

#### Scenario: Move across workspaces is rejected

- GIVEN a node in workspace A
- WHEN a reparent operation targets a parent in workspace B
- THEN the system MUST reject the move rather than change `workspace_id`

### Requirement: Workspace Isolation on Every Tenant-Scoped Table

Every tenant-scoped table (including `nodes`, `permissions`, `cells`, `cell_members`)
MUST have a non-nullable `workspace_id` column, and that value MUST be derived
server-side, never accepted from request input.

#### Scenario: Row without a workspace is rejected

- GIVEN an insert into a tenant-scoped table
- WHEN `workspace_id` is omitted or null
- THEN the database rejects the insert

### Requirement: Cells as Group Subjects

The system MUST support `cells` (teams) scoped to a workspace and `cell_members`
linking users to cells, so a cell can act as a single grantable subject.

#### Scenario: Cell membership is workspace-scoped

- GIVEN a cell in workspace A
- WHEN a user from workspace B is added as a member
- THEN the system MUST reject the membership

### Requirement: Super Root Global Identity

The system MUST model a Super Root identity distinct from any workspace membership,
scoped to the whole deployment rather than to a single workspace.

#### Scenario: Super Root has no implicit workspace membership

- GIVEN the Super Root identity
- WHEN checked against any single workspace's membership list
- THEN Super Root does not appear as a member of that workspace by virtue of its role

### Requirement: Plan Limits Bound Workspace Creation

Each user MUST be bounded by a plan, authored by Super Root, that limits how many
workspaces they may create.

#### Scenario: Workspace creation within limit succeeds

- GIVEN a user whose plan allows 3 workspaces and who owns 2
- WHEN they create a third workspace
- THEN creation succeeds

#### Scenario: Workspace creation at limit is refused

- GIVEN a user whose plan allows 3 workspaces and who owns 3
- WHEN they attempt to create a fourth
- THEN the system refuses with an error naming the plan limit
