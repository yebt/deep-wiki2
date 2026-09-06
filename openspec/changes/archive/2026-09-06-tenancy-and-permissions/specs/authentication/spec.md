# Authentication Specification

## Purpose

Sessions and password reset. Security-critical behaviour is specified as testable
outcomes: tokens hashed, single-use, expiring, compared in constant time, and no
channel — logs, responses, or rendered output — ever exposes a credential, hash, or
token.

## Requirements

### Requirement: Session Issuance and Validation

A successful login MUST issue a session bound to the authenticated user, and every
subsequent request MUST validate that session before deriving the tenant scope used
by `permission-resolver`.

#### Scenario: Valid session allows a request

- GIVEN a user with an active session
- WHEN they make an authenticated request
- THEN the request proceeds with the subject derived from the session

#### Scenario: Invalid or expired session is rejected

- GIVEN a session that has expired or been revoked
- WHEN a request presents it
- THEN the request is rejected before any resource access is attempted

### Requirement: Password Reset Tokens Are Hashed, Single-Use, Expiring

Password reset tokens MUST be stored hashed (never in plaintext), MUST be usable
exactly once, MUST expire after a bounded period, and comparisons against a presented
token MUST use a constant-time algorithm.

#### Scenario: Expired reset token is rejected

- GIVEN a reset token issued past its expiry window
- WHEN it is submitted to complete a reset
- THEN the system rejects it and the password is not changed

#### Scenario: Replayed reset token is rejected

- GIVEN a reset token already used to complete one password change
- WHEN it is submitted again
- THEN the system rejects the second attempt

### Requirement: Password Reset Responses Do Not Disclose Account Existence

The response to a password-reset request MUST be identical in shape, content, and
timing characteristics regardless of whether the submitted email corresponds to an
existing account.

#### Scenario: Reset request for an existing account

- GIVEN an email address with a registered account
- WHEN a password-reset request is submitted for it
- THEN the response is the generic acknowledgement, with no indication an account was
  found

#### Scenario: Reset request for a nonexistent account

- GIVEN an email address with no registered account
- WHEN a password-reset request is submitted for it
- THEN the response is the same generic acknowledgement as for an existing account

### Requirement: Credentials, Hashes, and Tokens Are Never Exposed

Passwords, password hashes, session tokens, and reset tokens MUST NOT be written to
logs, MUST NOT be serialised into any API response, and MUST NOT be rendered in any
UI surface.

#### Scenario: Login attempt is logged without the credential

- GIVEN a login attempt, successful or failed
- WHEN the attempt is logged
- THEN the log entry contains no plaintext password and no password hash

#### Scenario: Session token absent from response body

- GIVEN a successful login that issues a session
- WHEN the response is inspected
- THEN the session token appears only in the transport mechanism defined for it (for
  example, a cookie header), never duplicated in the JSON body
