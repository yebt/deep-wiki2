# Container Stack Specification

## Purpose

One Compose-spec-compliant file that runs unmodified under `podman compose` in local Fedora development and `docker compose` in production, per `docs/SPECS.md` §12.1–12.2.

## Requirements

### Requirement: Single Compose-Spec-Compliant File

The repository MUST define exactly one `compose.yaml` using only Compose-specification syntax, with no Docker-specific or Podman-specific extensions. The same file MUST run unmodified under both `podman compose` and `docker compose`.

#### Scenario: Same file runs under both runtimes

- GIVEN `compose.yaml` at the repository root
- WHEN it is run first via `podman compose up` locally and then via `docker compose up` in CI
- THEN both runs start the stack without file modification or runtime-specific overrides

### Requirement: SELinux-Safe Bind Mounts

Every bind mount in `compose.yaml` MUST carry an SELinux `:z` (or `:Z`) label.

#### Scenario: Bind mounts start cleanly under Fedora podman

- GIVEN `compose.yaml` bind mounts all carry `:z`
- WHEN `podman compose up` runs on a Fedora host with SELinux enforcing
- THEN no container reports a permission-denied error on its mounted volume

#### Scenario: Missing label is rejected

- GIVEN a bind mount definition without a `:z` or `:Z` suffix
- WHEN the compose file is validated
- THEN the validation fails and identifies the mount missing its SELinux label

### Requirement: Rootless-Safe Host Ports

Every published host port in `compose.yaml` MUST be 1024 or above.

#### Scenario: Rootless podman binds all published ports

- GIVEN all host port mappings are ≥1024
- WHEN `podman compose up` runs as a rootless user
- THEN every service binds its host port without a permission error

#### Scenario: Port below 1024 is rejected

- GIVEN a service definition that publishes a host port below 1024
- WHEN the compose file is validated
- THEN the validation fails and identifies the offending port mapping

### Requirement: Four Services Start Cleanly

`compose.yaml` MUST define `postgres` (with the `pgvector` extension enabled), `mailpit` (SMTP on 1025, web UI on 8025), `minio`, and `kroki`, and all four MUST reach a healthy running state together.

#### Scenario: Full stack starts without errors

- GIVEN a clean checkout with `compose.yaml` present
- WHEN a developer runs `podman compose up`
- THEN `postgres`, `mailpit`, `minio`, and `kroki` all reach a running/healthy state with no SELinux or port errors

#### Scenario: pgvector is enabled on postgres

- GIVEN the running `postgres` service
- WHEN a client connects and queries for the `vector` extension
- THEN the extension is reported as installed and available

#### Scenario: Mailpit exposes both interfaces

- GIVEN the running `mailpit` service
- WHEN a client sends mail via SMTP on port 1025 and loads the web UI on port 8025
- THEN the message is accepted over SMTP and visible in the web UI
