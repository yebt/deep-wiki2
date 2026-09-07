# Environment Config Specification

## Purpose

Provides a documented, typed configuration surface so misconfiguration is caught at startup rather than surfacing later as an unexplained runtime failure.

## Requirements

### Requirement: Documented Environment Template

The repository MUST provide an `env.example` file listing every environment variable required by any app or package, with a description or example value for each.

#### Scenario: New environment matches the template

- GIVEN `env.example` at the repository root
- WHEN a developer copies it to `.env` and fills in values
- THEN every variable the running apps read at startup is present in the template

### Requirement: Typed Configuration Loading

Each app MUST load its configuration through a typed loader that validates required variables and their shapes before the app begins serving requests.

#### Scenario: Valid configuration loads successfully

- GIVEN a `.env` file with all required variables present and correctly typed
- WHEN the app starts
- THEN configuration loading succeeds and the app proceeds to serve requests

### Requirement: Fail Fast on Missing or Malformed Configuration

The app MUST fail at startup, before serving any request, when a required configuration value is missing or fails validation. The failure MUST report which variable is missing or invalid and why, rather than surfacing as a later, unrelated runtime error.

#### Scenario: Missing required variable fails at startup

- GIVEN a `.env` file missing a required variable
- WHEN the app starts
- THEN startup fails immediately with an error naming the missing variable, and no request-handling begins

#### Scenario: Malformed value fails at startup

- GIVEN a required variable present but not matching its expected shape (for example, a non-numeric port)
- WHEN the app starts
- THEN startup fails immediately with an error naming the invalid variable and the expected shape, and no request-handling begins

### Requirement: Envelope Master Key Validated at Startup

The system MUST validate the envelope-encryption master key, or the configured
`KeyProvider`, at startup, and MUST fail fast — before serving any request — when it is
absent or malformed.

#### Scenario: Valid master key present

- GIVEN a `.env` file with a well-formed envelope master key
- WHEN the app starts
- THEN startup succeeds and credential encryption is available

#### Scenario: Master key absent

- GIVEN a `.env` file missing the envelope master key variable
- WHEN the app starts
- THEN startup fails immediately, naming the missing key configuration, and no
  request-handling begins

#### Scenario: Master key malformed

- GIVEN an envelope master key present but not matching its expected shape
- WHEN the app starts
- THEN startup fails immediately, naming the invalid variable and the expected shape,
  and no request-handling begins
