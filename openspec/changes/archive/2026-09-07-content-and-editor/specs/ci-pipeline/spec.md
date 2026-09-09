# Delta for CI Pipeline

GATE-2 (`markdown-round-trip`) becomes a named blocking gate, not merely one
test folded anonymously into the generic test run. A generic "run the
tests" requirement cannot express "green before the editor ships."

## ADDED Requirements

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
