# Mail Delivery Specification

## Purpose

The `MailSender` adapter behind the port defined in Phase 0: an SMTP implementation
bound to Mailpit in development, configured for production SMTP by environment.

## Requirements

### Requirement: SMTP Adapter Implements the `MailSender` Port

The system MUST provide an SMTP adapter, outside `packages/core`, implementing the
`MailSender` port interface defined in `packages/core`.

#### Scenario: Adapter satisfies the port contract

- GIVEN the `MailSender` port interface
- WHEN the SMTP adapter is type-checked against it
- THEN it satisfies the interface with no framework types leaking into
  `packages/core`

### Requirement: Configuration via Environment, Fail Fast on Misconfiguration

SMTP connection settings (host, port, credentials, sender address) MUST be loaded
through typed environment configuration, and the application MUST fail at startup
with an actionable error when required SMTP variables are missing or malformed.

#### Scenario: Missing SMTP host fails startup

- GIVEN an environment missing the SMTP host variable
- WHEN the application starts
- THEN startup fails immediately, naming the missing variable, before any request is
  served

### Requirement: SMTP Credentials Never Logged

SMTP credentials MUST NOT appear in application logs, error messages, or any API
response.

#### Scenario: Connection failure is logged without credentials

- GIVEN an SMTP authentication failure
- WHEN the failure is logged
- THEN the log entry contains no plaintext SMTP password

### Requirement: Development Binding to Mailpit

In local development, the adapter MUST be configured to send through the Mailpit
service so invitation and reset mail is capturable without an external mail
provider.

#### Scenario: Invitation mail lands in Mailpit

- GIVEN a development environment configured for Mailpit
- WHEN an invitation is sent
- THEN the message is retrievable from Mailpit's inbox
