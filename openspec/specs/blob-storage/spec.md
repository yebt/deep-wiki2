# Blob Storage Specification

## Purpose

The `BlobStore` port from Phase 0 gets two adapters — S3-compatible and local
filesystem — selected by environment, because a self-hoster on a single VPS will not
run MinIO. Profile photos are the first consumer.

## Requirements

### Requirement: Two Adapters Behind One Port

The system MUST provide both an S3-compatible adapter and a local-filesystem adapter
implementing the same `BlobStore` port interface defined in `packages/core`.

#### Scenario: Both adapters satisfy the same contract

- GIVEN the `BlobStore` port interface
- WHEN each adapter is type-checked against it
- THEN both satisfy the interface with no framework or storage-specific types
  leaking into `packages/core`

### Requirement: Adapter Selection by Environment

The active `BlobStore` adapter MUST be selected by a typed environment variable, and
the application MUST fail at startup with an actionable error if the selected
adapter's required configuration is missing.

#### Scenario: Filesystem adapter misconfigured

- GIVEN the environment selects the filesystem adapter but omits the required
  storage path
- WHEN the application starts
- THEN startup fails immediately, naming the missing configuration

#### Scenario: S3-compatible adapter misconfigured

- GIVEN the environment selects the S3-compatible adapter but omits required
  credentials or endpoint
- WHEN the application starts
- THEN startup fails immediately, naming the missing configuration

### Requirement: Profile Photo Upload Validated

Profile photo uploads MUST be validated for file type and size before being handed
to the active `BlobStore` adapter.

#### Scenario: Oversized upload rejected

- GIVEN a configured maximum upload size
- WHEN a user uploads a profile photo exceeding that size
- THEN the upload is rejected before reaching the `BlobStore` adapter

#### Scenario: Unsupported file type rejected

- GIVEN an allowlist of supported image types
- WHEN a user uploads a file outside that allowlist
- THEN the upload is rejected before reaching the `BlobStore` adapter

### Requirement: Adapter-Independent Retrieval

A profile photo stored through either adapter MUST be retrievable through the same
application-level access path, regardless of which adapter is active.

#### Scenario: Photo round-trips through the filesystem adapter

- GIVEN the filesystem adapter is active
- WHEN a profile photo is uploaded and then requested
- THEN the same photo bytes are returned

#### Scenario: Photo round-trips through the S3-compatible adapter

- GIVEN the S3-compatible adapter is active
- WHEN a profile photo is uploaded and then requested
- THEN the same photo bytes are returned
