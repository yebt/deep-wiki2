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

### Requirement: GATE-2 Is A Named, Independently Identifiable Gate

CI MUST run the GATE-2 markdown round-trip suite as a distinctly named step,
separate from the general workspace test command's pass/fail signal, so a
GATE-2 failure is identifiable as GATE-2 specifically and not folded into an
undifferentiated test failure.

#### Scenario: GATE-2 failure is identifiable

- GIVEN a change that fails a GATE-2 fixture while all other tests pass
- WHEN CI runs
- THEN the overall pipeline run is marked failed and the GATE-2 step is
  identifiable as the cause

#### Scenario: GATE-2 passing is reported as its own step

- GIVEN a change where every GATE-2 fixture round-trips byte-identical
- WHEN CI runs
- THEN the GATE-2 step reports success as its own named result

### Requirement: GATE-2 Precedes Editor UI Delivery

CI MUST NOT report an overall passing run for a change that wires Milkdown
into a user-facing screen unless the GATE-2 step passes within that same
run.

#### Scenario: Editor wiring blocked while GATE-2 is red

- GIVEN a change that adds Milkdown editor wiring to a screen while a
  GATE-2 fixture fails
- WHEN CI runs
- THEN the overall pipeline run is marked failed, citing the GATE-2 failure
