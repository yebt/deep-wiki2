# Registration Policy Specification

## Purpose

Governs how new users may join the instance: whether registration is closed,
invitation-only, or open, and the safeguards required before `open` may be enabled.

## Requirements

### Requirement: Registration Mode Setting

The system MUST expose an instance-level `registration_mode` setting with values
`closed`, `invitation_only`, or `open`, defaulting to `invitation_only`.

#### Scenario: Default mode on a fresh instance

- GIVEN a newly initialised instance with no explicit configuration
- WHEN the registration mode is read
- THEN it is `invitation_only`

### Requirement: Registration Blocked in `closed` Mode

When `registration_mode` is `closed`, the system MUST reject any self-service
registration attempt.

#### Scenario: Self-registration rejected while closed

- GIVEN `registration_mode = closed`
- WHEN an unauthenticated visitor submits a registration form
- THEN the system rejects the attempt with an error that does not create an account

### Requirement: `open` Mode Requires Verified SMTP

The system MUST refuse to switch `registration_mode` to `open` unless a test send
through the configured `MailSender` has succeeded.

#### Scenario: Switch to open without verified SMTP is refused

- GIVEN no successful SMTP test send has been recorded
- WHEN Super Root attempts to set `registration_mode = open`
- THEN the system refuses the change and reports that SMTP must be verified first

#### Scenario: Switch to open after verified SMTP succeeds

- GIVEN a successful SMTP test send has been recorded
- WHEN Super Root sets `registration_mode = open`
- THEN the change is accepted

### Requirement: Optional Domain Allowlist

When `registration_mode` is `open`, the system MAY enforce an
`open_registration_domains` allowlist restricting self-registration to email
addresses in the listed domains.

#### Scenario: Registration from an allowed domain succeeds

- GIVEN `open_registration_domains = ["company.com"]`
- WHEN a visitor registers with an address at `company.com`
- THEN registration succeeds

#### Scenario: Registration from a disallowed domain is rejected

- GIVEN `open_registration_domains = ["company.com"]`
- WHEN a visitor registers with an address at a different domain
- THEN the system rejects the attempt with an error naming the domain restriction
