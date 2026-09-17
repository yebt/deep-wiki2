# Trash Restore Specification

## Purpose

The Trash listing scoped to what the subject may `manage`, restoring a node
together with exactly the subtree trashed with it, the refusal to restore under
a still-trashed ancestor, and the slug-collision path: a named `409` and a typed
"restore as …", never an automatic suffix.

## Requirements

### Requirement: Trash Listing Shows Only What The Subject May Manage

The Trash listing MUST include only nodes the requesting subject can `manage`,
resolved as a first-class query rather than a filtered read list. It MUST NOT
reveal a trashed node's existence to a subject who cannot manage it.

#### Scenario: Manager sees only their manageable trashed nodes

- GIVEN two trashed pages, one the subject can manage and one they cannot
- WHEN they open the Trash listing
- THEN only the manageable page appears

#### Scenario: Non-manager sees an empty or absent listing

- GIVEN a subject with no `manage` grant anywhere in the workspace
- WHEN they open the Trash listing
- THEN it contains no trashed nodes

### Requirement: Restore Returns The Node And Exactly The Subtree Trashed With It

Restoring a node MUST clear `trashed_at` on that node and every row sharing its
trash-operation id, and MUST NOT affect a descendant trashed under a different,
earlier operation id.

#### Scenario: Restoring a container restores its co-trashed subtree

- GIVEN a chapter and two pages trashed together under one operation id
- WHEN the chapter is restored
- THEN both pages are restored with it

#### Scenario: A separately-trashed descendant stays in trash

- GIVEN a chapter trashed, and a page under it trashed earlier in a separate
  operation
- WHEN the chapter is restored
- THEN the chapter is restored and the separately-trashed page remains trashed

### Requirement: Restore Under A Trashed Ancestor Is Refused With A Named Reason

Restoring a node MUST be refused, naming the trashed ancestor, when any ancestor
above it is still trashed.

#### Scenario: Restoring a page under a still-trashed chapter is refused

- GIVEN a page trashed separately from its chapter, and the chapter is still
  trashed
- WHEN the page's restore is attempted
- THEN it is refused, naming the trashed chapter as the reason

#### Scenario: Restoring after the ancestor is restored succeeds

- GIVEN the same page, after its chapter has since been restored
- WHEN the page's restore is attempted again
- THEN it succeeds

### Requirement: A Slug Collision On Restore Answers 409 Naming The Live Sibling

Restoring a node whose slug is now held by a live sibling MUST be refused with
`409`, naming that live sibling. The system MUST NOT mint an automatic
suffixed slug.

#### Scenario: Collision names the live sibling

- GIVEN a trashed page named `overview`, and a live sibling since created with
  slug `overview`
- WHEN the trashed page is restored without a new name
- THEN the response is `409`, naming the live `overview` sibling

#### Scenario: No collision restores under the original slug

- GIVEN a trashed page whose original slug is held by no live sibling
- WHEN it is restored
- THEN it is restored under that original slug

### Requirement: Restore As Accepts A Typed Name And Never An Automatic Suffix

Following a collision, the system MUST accept a caller-typed replacement name
for the restored node and MUST use exactly that name, never a system-generated
variant.

#### Scenario: Restore as succeeds with the typed name

- GIVEN the `overview` collision above
- WHEN the caller restores with the typed name `overview-2026`
- THEN the node is restored with slug `overview-2026`

#### Scenario: A second collision on the typed name is refused the same way

- GIVEN a typed replacement name that itself collides with a live sibling
- WHEN the restore is submitted
- THEN it is refused with `409` naming that sibling, and no automatic suffix is
  applied
