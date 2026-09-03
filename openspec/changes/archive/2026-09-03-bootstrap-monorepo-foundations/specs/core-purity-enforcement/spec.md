# Core Purity Enforcement Specification

## Purpose

Guarantees the hexagonal boundary from `docs/SPECS.md` §12.3 and §13 is machine-checked, not documented convention: `packages/core` stays free of framework imports because a build-time check fails when it is not.

## Requirements

### Requirement: Zero Framework Imports in `packages/core`

`packages/core` MUST contain zero imports of framework or runtime-specific packages (including but not limited to Hono, Nuxt, Astro, and Bun-specific APIs not available across runtimes).

#### Scenario: Clean core package passes the check

- GIVEN `packages/core` contains only framework-free TypeScript
- WHEN the purity check runs
- THEN the check reports success and the build proceeds

### Requirement: Machine-Enforced, CI-Failing Check

The purity constraint MUST be enforced by an automated check that fails the build/CI run when violated. Enforcement MUST NOT rely on code review or documentation alone.

#### Scenario: Deliberate framework import fails CI

- GIVEN a change that adds an import of a framework-specific package (for example, `hono` or `nuxt`) inside `packages/core`
- WHEN CI runs the purity check as part of the pipeline
- THEN the CI run fails, and the failure is attributable to the purity check step rather than an unrelated failure

#### Scenario: Failure identifies the offending import

- GIVEN a framework import violation inside `packages/core`
- WHEN the purity check fails
- THEN the reported error identifies the offending file and the disallowed import so a developer can locate and remove it without re-running a broader diagnostic
