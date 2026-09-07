# Prompt Assembly Specification

## Purpose

Orders every AI prompt from most stable to most volatile, so the stable prefix (tool
definitions, system instructions, team rule packs) is byte-identical across calls and
reusable by a provider's prompt cache.

## Requirements

### Requirement: Fixed Stable-to-Volatile Ordering

Prompt assembly MUST order content in this fixed sequence: tool definitions, then
system instructions and team rule packs, then volatile document content, then the
volatile user question or selection. No stage MUST be reordered relative to this
sequence.

#### Scenario: Assembled prompt follows the fixed order

- GIVEN a chat call with tools, a system prompt, document content, and a user question
- WHEN the prompt is assembled
- THEN tool definitions appear first and the user question appears last, in that fixed
  sequence

### Requirement: Deterministic Tool Ordering

When multiple tool definitions are included in a call, the system MUST order them
deterministically so that the same tool set produces byte-identical serialized output
across calls.

#### Scenario: Same tool set assembles identically twice

- GIVEN the same set of tool definitions
- WHEN the stable prefix is assembled twice, independently
- THEN the two serialized prefixes are byte-identical

### Requirement: Nondeterminism in the Stable Prefix Is a Defect

Any nondeterminism in the stable prefix — an unsorted object key, a timestamp, or a
varying tool list for an unchanged configuration — MUST be treated as a defect, not an
accepted variance.

#### Scenario: Unsorted keys break determinism

- GIVEN a stable-prefix component serialized with unsorted object keys
- WHEN the same logical content is assembled twice
- THEN a byte-difference between the two assemblies fails the determinism check
