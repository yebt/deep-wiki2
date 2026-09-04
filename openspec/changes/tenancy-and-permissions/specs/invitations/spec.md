# Invitations Specification

## Purpose

Covers creating, sending, and accepting workspace invitations, and joining a
workspace with a starting permission set, independent of the instance-wide
`registration-policy`.

## Requirements

### Requirement: Invitation Creation

A Workspace Admin (or an equivalent authorised subject) MUST be able to create an
invitation bound to one workspace, one target email address, and a starting set of
permission grants to apply on acceptance.

#### Scenario: Invitation created with a starting grant set

- GIVEN a Workspace Admin invites a new member with `read` access to a shelf
- WHEN the invitation is created
- THEN it is stored with the workspace, the target email, and the intended starting
  grants

### Requirement: Invitation Delivery via `MailSender`

The system MUST send the invitation to the target email through the `MailSender`
port.

#### Scenario: Invitation email is sent

- GIVEN a created invitation
- WHEN the send step runs
- THEN a message reaches the target address through the configured `MailSender`
  adapter

### Requirement: Invitation Expiry

Every invitation MUST carry an expiry timestamp, and acceptance MUST be rejected once
that timestamp has passed.

#### Scenario: Expired invitation is rejected

- GIVEN an invitation whose expiry timestamp is in the past
- WHEN the recipient attempts to accept it
- THEN the system rejects the acceptance and does not create the workspace
  membership

### Requirement: Single-Use Invitation

An invitation MUST be usable exactly once; a second acceptance attempt on an
already-accepted invitation MUST be rejected.

#### Scenario: Reused invitation is rejected

- GIVEN an invitation that has already been accepted
- WHEN a second acceptance attempt is made with the same invitation token
- THEN the system rejects it and does not create a duplicate membership

### Requirement: Acceptance Joins the Workspace with Starting Grants

Accepting a valid invitation MUST create (or attach an existing) user to the target
workspace and MUST apply the invitation's starting permission grants.

#### Scenario: Valid acceptance grants access

- GIVEN a valid, unexpired, unused invitation with a starting `read` grant on a book
- WHEN the recipient accepts it
- THEN the user becomes a member of the workspace and `can(user, read, book)`
  resolves to `allow`
