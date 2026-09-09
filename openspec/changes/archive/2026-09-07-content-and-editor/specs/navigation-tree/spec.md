# Navigation Tree Specification

## Purpose

The tree UI rendered over `nodes` (shelves, books, chapters, pages), with
drag reordering writing back to `position`. This is a human-gate screen per
`execution_mode.human_gates`.

## Requirements

### Requirement: Tree Displays Only Readable Nodes

The navigation tree MUST include only nodes the requesting subject can read,
resolved through `can()`. It MUST NOT reveal a node the subject cannot read
merely to preserve tree shape.

#### Scenario: Unreadable chapter is absent from the tree

- GIVEN a subject with no read access to a chapter
- WHEN they load the navigation tree for that book
- THEN that chapter and any pages under it do not appear

### Requirement: Drag Reorder Writes Back To Position

Dragging a node to a new position among its siblings MUST persist updated
`position` values so that sibling ordering remains distinct and stable,
using the existing `nodes.position` column rather than a separate ordering
mechanism.

#### Scenario: Reordering updates sibling positions

- GIVEN three sibling nodes with positions 0, 1, 2
- WHEN the third is dragged to the first position
- THEN the persisted `position` values reflect the new order and remain
  distinct

#### Scenario: Cross-workspace drag target is rejected

- GIVEN a drag operation targeting a parent in a different workspace
- WHEN it is submitted
- THEN the system rejects the move rather than changing the node's
  `workspace_id`

### Requirement: Reordering Requires Write Or Manage Permission

Reordering or reparenting a node MUST require the appropriate `can()`
action on the affected node. A request without it MUST be rejected without
changing any position.

#### Scenario: Read-only subject cannot reorder

- GIVEN a subject with only `read` access to a node
- WHEN they attempt to drag-reorder it
- THEN the request is rejected and no `position` value changes
