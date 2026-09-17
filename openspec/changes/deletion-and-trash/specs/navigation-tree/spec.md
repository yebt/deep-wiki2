# Delta for Navigation Tree

Base: `openspec/specs/navigation-tree/spec.md`.

## MODIFIED Requirements

### Requirement: Tree Displays Only Readable Nodes

The navigation tree MUST include only nodes the requesting subject can read,
resolved through `can()`, and MUST exclude any trashed node or a node under a
trashed ancestor. It MUST NOT reveal a node the subject cannot read, or a
trashed node, merely to preserve tree shape.
(Previously: excluded only unreadable nodes; trash did not exist.)

#### Scenario: Unreadable chapter is absent from the tree

- GIVEN a subject with no read access to a chapter
- WHEN they load the navigation tree for that book
- THEN that chapter and any pages under it do not appear

#### Scenario: Trashed page is absent from the tree

- GIVEN a page the subject could otherwise read, now trashed
- WHEN they load the navigation tree
- THEN the trashed page does not appear

## ADDED Requirements

### Requirement: Delete Row Action Is Available Where Trashing Is Permitted

The tree row MUST offer a "Delete" action when the subject has `manage` on
that node, or is the workspace owner.

#### Scenario: Manager sees Delete on a manageable node

- GIVEN a subject with `manage` on a page
- WHEN they view its tree row
- THEN a "Delete" action is available

### Requirement: Delete Is Disabled With A Stated Reason For A Non-Empty Container

The "Delete" action MUST be disabled, with a stated reason, on a non-empty
container when the subject is not the workspace owner.

#### Scenario: Non-owner manager sees Delete disabled

- GIVEN a manager viewing a chapter with one live page, not the workspace owner
- WHEN they view the "Delete" action
- THEN it is disabled with a reason naming the non-empty container

#### Scenario: Owner sees Delete enabled on the same container

- GIVEN the workspace owner viewing the same non-empty chapter
- WHEN they view the "Delete" action
- THEN it is enabled, leading to the force-delete confirmation
