# Test Infrastructure Specification

## Purpose

Establishes a workspace-level automated test command covering every package and app, plus Playwright e2e coverage, so `strict_tdd` can leave its no-runner fallback. The specific test runner mechanism (including how Vue SFC component tests are executed) is a design decision, not specified here.

## Requirements

### Requirement: Workspace-Wide Test Coverage

The workspace MUST provide a single command that runs automated tests across every app and package. Every app and package MUST be covered by at least one real, executing automated test — a placeholder that trivially passes without exercising code MUST NOT count as coverage.

#### Scenario: Workspace test command passes across all members

- GIVEN a clean checkout with all apps and packages scaffolded
- WHEN the workspace test command runs
- THEN it executes at least one test per app and per package, and all tests pass

#### Scenario: An uncovered package is detected

- GIVEN a package with no executing test (empty or placeholder-only test file)
- WHEN the workspace test command runs
- THEN the run reports that package as failing coverage rather than silently passing

### Requirement: Playwright End-to-End Coverage

The workspace MUST include a Playwright e2e suite that boots `apps/web` and exercises at least one real user-facing path.

#### Scenario: Playwright boots the web app and passes

- GIVEN the Playwright configuration and `apps/web` built
- WHEN the e2e suite runs
- THEN `apps/web` boots and at least one smoke scenario completes and passes

### Requirement: Strict TDD Re-Resolution

Once the workspace test command covers every package and app and Playwright is wired for e2e, `openspec/config.yaml`'s `strict_tdd` value MUST re-resolve from `false` to `true`.

#### Scenario: strict_tdd flips to true after infrastructure lands

- GIVEN the workspace test command covers every app/package and Playwright e2e is wired
- WHEN `openspec/config.yaml` is inspected after this change lands
- THEN `strict_tdd` reads `true`, no longer relying on the no-runner fallback

#### Scenario: strict_tdd stays false while coverage is incomplete

- GIVEN at least one app or package lacks a real executing test
- WHEN `openspec/config.yaml` is inspected
- THEN `strict_tdd` MUST NOT be re-resolved to `true`
