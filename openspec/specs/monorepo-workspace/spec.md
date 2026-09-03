# Monorepo Workspace Specification

## Purpose

Defines the Bun 1.4 workspace topology and task graph that every later phase builds on: the `apps/*` / `packages/*` layout from `docs/SPECS.md` §13, and the tooling boundary that keeps the workspace to one build-orchestration tool.

## Requirements

### Requirement: Bun Workspace Topology

The repository root MUST define a Bun 1.4 workspace with `apps/landing` (Astro), `apps/web` (Nuxt 4), `apps/api` (Hono on Bun), and `packages/core`, `packages/markdown`, `packages/contracts`, `packages/editor`, `packages/db`, matching `docs/SPECS.md` §13.

#### Scenario: Clean clone builds successfully

- GIVEN a freshly cloned repository with no prior `node_modules` or lockfile artifacts
- WHEN a developer runs `bun install` followed by the workspace build
- THEN every app and package resolves its dependencies and builds without error

#### Scenario: Every workspace member is discoverable

- GIVEN the root `package.json` workspace declaration
- WHEN the workspace tooling lists members
- THEN all three `apps/*` and five `packages/*` entries listed in the Purpose are present

### Requirement: Task Graph via `bun run -F`

The workspace MUST orchestrate cross-package tasks (build, test, lint) using `bun run -F` filters. The workspace MUST NOT depend on pnpm or Turborepo for task orchestration.

#### Scenario: Filtered task targets one package

- GIVEN the workspace root
- WHEN a developer runs `bun run -F packages/core test`
- THEN only `packages/core`'s test task executes

#### Scenario: pnpm and Turborepo are absent

- GIVEN the repository root
- WHEN the file tree is inspected for build tooling
- THEN no `pnpm-lock.yaml`, `pnpm-workspace.yaml`, or `turbo.json` file exists, and no script depends on either tool

### Requirement: Documented Local Bootstrap

`README.md` MUST document the full local bootstrap sequence: clone, `bun install`, `podman compose up`, migrate, seed.

#### Scenario: README covers the full bootstrap path

- GIVEN a new contributor with only repository access
- WHEN they follow `README.md` from the top
- THEN each step (clone, install, compose up, migrate, seed) appears in order with a runnable command
