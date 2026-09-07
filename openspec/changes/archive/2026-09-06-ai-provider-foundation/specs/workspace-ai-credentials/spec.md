# Workspace AI Credentials Specification

## Purpose

Provides per-workspace BYOK: envelope-encrypted storage, save-time validation, and a
strict non-exposure guarantee, authorised through the existing permission resolver
rather than a new path.

## Requirements

### Requirement: Envelope Encryption at Rest

The system MUST encrypt every AI provider credential with envelope encryption before
persisting it, through a `CredentialCipher` port backed by a `KeyProvider`. Each stored
row MUST record the id of the wrapping key used, so rotation does not require re-entry
of every credential.

#### Scenario: Saved credential is ciphertext

- GIVEN a workspace admin submits a provider API key
- WHEN it is persisted
- THEN the stored row contains ciphertext and a wrapping-key id, never the plaintext key

### Requirement: Validation Probe on Save

The system MUST perform a cheap validation call against the provider before persisting
a credential. A credential that fails validation MUST be rejected and MUST NOT be
persisted.

#### Scenario: Valid credential is accepted

- GIVEN a syntactically valid API key that the provider accepts
- WHEN it is saved
- THEN the validation probe succeeds and the credential is persisted

#### Scenario: Invalid credential is rejected

- GIVEN an API key the provider rejects
- WHEN it is saved
- THEN the system returns a validation error naming the failure, and no row is
  persisted

### Requirement: Credentials Never Exposed

A stored credential MUST NOT be producible by any HTTP response, log line, rendered UI,
or error path. Decryption MUST occur server-side only, at the point a provider call is
constructed. `scripts/checks/query-boundaries.ts`'s `DENYLISTED_FIELDS` MUST include
every AI-credential field name added by this change.

#### Scenario: Settings read never returns the secret

- GIVEN a workspace with a stored AI credential
- WHEN its AI settings are fetched over the API
- THEN the response contains no plaintext or ciphertext credential value

#### Scenario: Validation failure does not leak the key

- GIVEN a credential fails its validation probe
- WHEN the failure is logged or returned to the caller
- THEN the raw key value does not appear in the log line or the error payload

#### Scenario: Denylist covers the new fields

- GIVEN the AI-credential field names introduced by this change
- WHEN `scripts/checks/query-boundaries.ts` runs against a `*Response*` schema
  declaring one of them
- THEN the check fails, proving the guard is not vacuous

### Requirement: Tenant-Scoped Storage

`workspace_ai_credentials` MUST carry a non-nullable `workspace_id` tied by the
composite `(id, workspace_id)` foreign-key pattern, resolved from the authenticated
subject and never accepted from request input.

#### Scenario: Insert without a workspace is rejected

- GIVEN an insert into `workspace_ai_credentials`
- WHEN `workspace_id` is omitted or null
- THEN the database rejects the insert

#### Scenario: Request-supplied workspace is ignored

- GIVEN an authenticated session bound to workspace A
- WHEN a credential-save request body includes a different `workspace_id`
- THEN the system persists the credential under workspace A and ignores the
  request-supplied value

### Requirement: Authorization Through the Existing Resolver

Reading or writing a workspace's AI credentials MUST resolve authorization through the
existing `can()` path. No new module MUST reference the `permissions` table directly.

#### Scenario: Unauthorized write is denied

- GIVEN a user with no `manage` grant on a workspace's AI settings
- WHEN they attempt to save a credential
- THEN the write is denied by `can()` before any encryption or persistence occurs
