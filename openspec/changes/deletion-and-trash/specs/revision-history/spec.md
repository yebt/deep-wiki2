# Delta for Revision History

Base: `openspec/changes/versioning-and-collaboration/specs/revision-history/spec.md`
(unarchived; `versioning-and-collaboration` is merged on `main` but not yet
archived).

## MODIFIED Requirements

### Requirement: Page History Query Returns Revisions Newest First

The system MUST provide a page-history query returning that page's revisions
ordered newest first, authorised through `can()` with the `read` action, and
MUST deny that query for a trashed page to any subject without `manage` on it,
identically to denial for a subject lacking `read`.
(Previously: denial covered only the absence of a `read` grant; trash did not
exist.)

#### Scenario: History query orders and authorises

- GIVEN a page with three saved revisions
- WHEN a subject with `read` requests its history
- THEN the three revisions are returned newest first

#### Scenario: History denied without read

- GIVEN a subject with no `read` grant on a page
- WHEN they request its revision history
- THEN the request is denied and no revision data is returned

#### Scenario: History denied for a trashed page without manage

- GIVEN a page a subject could read before it was trashed
- WHEN they request its revision history after trashing, holding no `manage`
  grant
- THEN the request is denied identically to a page with no `read` grant
