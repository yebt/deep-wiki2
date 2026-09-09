# Delta for Permission Resolver

## ADDED Requirements

### Requirement: The `comment` Action Resolves Through The Same Path As Every Other Action

`comment` MUST resolve through the same recursive-CTE `can()` path, the same
precedence rules, and the same tenant-scoping rule as every other action.
This change gives `comment` its first real producer — the comment-indicator
and comment-creation endpoints — so this requirement is now exercised
against real callers rather than remaining vacuous.

#### Scenario: A subject with read but not comment is denied the comment action

- GIVEN a subject has `allow` on `read` and no grant on `comment` for a page
- WHEN `can(subject, comment, page)` is evaluated
- THEN the result is `deny`

#### Scenario: A subject with an explicit comment grant is allowed

- GIVEN a subject has `allow` on `comment` at the book level and no
  page-level override
- WHEN `can(subject, comment, page)` is evaluated for a page under that book
- THEN the result is `allow`

#### Scenario: Deny on comment overrides an inherited allow

- GIVEN a subject has `allow` on `comment` at the workspace level and `deny`
  on `comment` directly on one page
- WHEN `can(subject, comment, page)` is evaluated for that page
- THEN the result is `deny`, consistent with the existing
  more-specific-overrides rule

### Requirement: A Denied `comment` Action Discloses Nothing Beyond Deny

`can()` returning `deny` for the `comment` action MUST behave identically to
`deny` for any other action from the caller's point of view: it MUST NOT
distinguish "no comment permission" from "no read permission" or from "the
resource has no comments" in its return shape.

#### Scenario: Deny for comment is indistinguishable in shape from deny for read

- GIVEN two separate resolutions: one where a subject lacks `read`, and one
  where the same subject has `read` but lacks `comment`
- WHEN both `can()` results are inspected
- THEN both return the same `deny` shape, carrying no information that would
  let a caller infer which grant was missing
