# Delta for Environment Config

## ADDED Requirements

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
