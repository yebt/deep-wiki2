# Delta for Page Content

Base: `openspec/specs/page-content/spec.md`.

## MODIFIED Requirements

### Requirement: Content Access Goes Through can()

Reading or saving page content MUST be authorised through `can()` with the
action appropriate to the operation (`read` for viewing, `write` for saving),
and MUST additionally deny access to a trashed page's content for any subject
without `manage` on it, answering identically to a page that does not exist.
No route MUST query or persist page content without that check.
(Previously: denial covered only the absence of a `read`/`write` grant; trash
did not exist.)

#### Scenario: Read denied without permission

- GIVEN a subject with no `read` grant reaching a page
- WHEN they request that page's content
- THEN the request is denied and no content is returned

#### Scenario: Save denied without permission

- GIVEN a subject with no `write` grant reaching a page
- WHEN they attempt to save content to it
- THEN the request is denied and the stored content is unchanged

#### Scenario: Read of a trashed page's content is denied like absence

- GIVEN a page a subject could read before it was trashed, and they hold no
  `manage` grant
- WHEN they request its content after trashing
- THEN the request is denied identically to the page not existing

#### Scenario: A manager can still read a trashed page's content

- GIVEN a trashed page and the manager who trashed it
- WHEN they request its content
- THEN the content is returned unchanged

## ADDED Requirements

### Requirement: Trashing A Page Releases Any Held Edit Lock

Trashing a page MUST release any edit lock held on it, so no editor session
remains locked against a page it can no longer save.

#### Scenario: Trashing releases the lock

- GIVEN a page currently locked for editing by a user
- WHEN the page is trashed
- THEN the lock is released

### Requirement: A Trashed Page's Content Stays Intact Until Purge

Trashing a page MUST NOT alter its stored `page_content`, revisions, or block
index; those rows remain exactly as they were, hidden rather than changed,
until the purge deletes the node.

#### Scenario: Content is unchanged immediately after trashing

- GIVEN a page with stored content
- WHEN it is trashed
- THEN its `page_content` row is byte-identical to before trashing

#### Scenario: Restoring returns the exact prior content

- GIVEN the same page, later restored within 30 days
- WHEN it is restored
- THEN its content, revisions, and block index are exactly as they were
  before trashing
