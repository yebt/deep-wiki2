# CI Pipeline Specification

## Purpose

Runs lint, typecheck, tests, and the `packages/core` purity check on every push, so the machinery Phase 0 builds is actually exercised continuously rather than only locally.

## Requirements

### Requirement: Four Gates On Every Push

CI MUST run lint, typecheck, the workspace test command, and the `packages/core` purity check on every push to the repository.

#### Scenario: Push triggers all four gates

- GIVEN a push to any branch tracked by CI
- WHEN the pipeline runs
- THEN lint, typecheck, the workspace test command, and the purity check all execute as part of the same run

#### Scenario: All gates pass on a clean change

- GIVEN a change that satisfies lint rules, type-checks, passes all tests, and keeps `packages/core` framework-free
- WHEN CI runs
- THEN the pipeline reports success

### Requirement: Any Failing Gate Fails the Pipeline

CI MUST fail the overall pipeline run if any of the four gates fails, and MUST report which gate failed.

#### Scenario: A single failing gate fails the run

- GIVEN a change that fails exactly one gate (for example, a lint violation)
- WHEN CI runs
- THEN the overall pipeline run is marked failed and the failing gate is identifiable from the CI output

#### Scenario: Core purity violation fails the pipeline

- GIVEN a change that introduces a framework import into `packages/core`
- WHEN CI runs
- THEN the purity check gate fails and the overall pipeline run is marked failed
