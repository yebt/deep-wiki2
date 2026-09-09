# Markdown Round-Trip Specification (GATE-2)

## Purpose

The byte-identity guarantee between the canonical Markdown a user wrote and the
Markdown the editor writes back after a round trip through the ProseMirror
document. This is the highest-risk area of the codebase (docs/SPECS.md §5.1):
a lossy serialiser does not fail loudly, it quietly rewrites documents the
user owns. GATE-2 is unstarted — the existing harness (`packages/editor/src/round-trip.ts`)
only proves the `packages/markdown` serialiser pin (Markdown → mdast →
Markdown); it proves nothing about a ProseMirror schema, which does not exist
yet.

> Scope note: this spec carries the GATE-2 corpus and byte-identity truth
> table, mandated by this change to be specified with the same rigour as
> GATE-1's permission truth table — exceeding the default spec size budget by
> explicit instruction.

**The governing rule for content the schema cannot represent** (three
exhaustive outcomes; no fourth is permitted):

1. **Modelled** by the ProseMirror schema and reserialised.
2. **Carried verbatim** as an opaque leaf node that reserialises byte-for-byte.
3. **Refused**: the editor MUST NOT open the document in edit mode and MUST
   state why, offering read-only instead.

Open-and-silently-drop is forbidden under all three outcomes.

## Requirements

### Requirement: Round Trip Exercises The ProseMirror Schema, Not Only mdast

The GATE-2 suite MUST route every fixture through `packages/editor`'s
Markdown → ProseMirror doc → Markdown functions, both of which MUST reuse
`packages/markdown` for their Markdown-side parsing and serialising. A suite
that only exercises `packages/markdown`'s `parse`/`stringify` (mdast → mdast)
MUST NOT be treated as satisfying GATE-2.

#### Scenario: Suite invokes the editor's schema functions

- GIVEN the GATE-2 suite runs
- WHEN a fixture is round-tripped
- THEN the fixture passes through the ProseMirror doc construction and
  serialisation functions in `packages/editor`, not only `packages/markdown`

#### Scenario: A schema-only defect is caught

- GIVEN a fixture whose construct a naive mdast-only round trip would pass
  (for example, a footnote) but the ProseMirror schema does not yet model
- WHEN the suite runs
- THEN the suite fails, because it exercises the schema and not only the
  Markdown pipeline

### Requirement: Nested List Preservation

Nested lists with mixed bullet markers, loose and tight spacing, and varying
indentation MUST round-trip byte-identical.

#### Scenario: Mixed-marker nested list

- GIVEN a fixture with a nested list mixing `-` and `*` markers at different
  depths
- WHEN it is round-tripped through the editor
- THEN the output bytes are identical to the input, preserving each level's
  original marker

#### Scenario: Loose versus tight list distinction

- GIVEN two fixtures identical except one is a loose list (blank lines
  between items) and the other tight
- WHEN each is round-tripped
- THEN each preserves its own looseness, and neither output matches the
  other's spacing

### Requirement: GFM Table Preservation

Tables, including those with ragged column widths or inconsistent alignment
row padding, MUST round-trip byte-identical.

#### Scenario: Ragged alignment row

- GIVEN a fixture table whose alignment row and cell padding are not
  column-width-aligned
- WHEN it is round-tripped
- THEN the output preserves the original padding rather than reflowing it to
  aligned columns

### Requirement: Code Fence Language Hint Preservation

Fenced code blocks MUST round-trip byte-identical whether or not they carry a
language info string, and the fence character used (`` ` `` or `~`) MUST be
preserved.

#### Scenario: Fence with a language hint

- GIVEN a fixture with a fenced code block whose info string names a language
- WHEN it is round-tripped
- THEN the output fence carries the identical info string

#### Scenario: Fence without a language hint

- GIVEN a fixture with a fenced code block and no info string
- WHEN it is round-tripped
- THEN the output fence has no info string inserted

### Requirement: Footnote Preservation

Footnote references and their definitions, including definition placement and
ordering, MUST round-trip byte-identical.

#### Scenario: Footnote definition placement

- GIVEN a fixture with a footnote reference in the body and its definition
  placed at a specific point in the document
- WHEN it is round-tripped
- THEN the definition remains at its original position and ordering relative
  to other footnotes

### Requirement: Raw HTML Preservation Or Fail-Closed Refusal

Raw HTML blocks and inline HTML MUST either round-trip byte-identical (via
modelling or verbatim opaque-leaf carry) or cause the fail-closed refusal
defined below. They MUST NOT be silently stripped or altered while still
allowing the document to open in edit mode.

#### Scenario: HTML block carried verbatim

- GIVEN a fixture containing a raw HTML block
- WHEN it is round-tripped and the schema carries HTML as an opaque leaf
- THEN the output HTML block is byte-identical to the input

#### Scenario: Unsupported HTML refuses edit mode

- GIVEN a fixture containing HTML the schema neither models nor carries
  verbatim
- WHEN a user attempts to open it in edit mode
- THEN the system refuses to enter edit mode, states the reason, and offers
  read-only instead of opening and dropping the content

### Requirement: Hard Line Break Spelling Preservation

Both hard-break spellings — trailing double-space and trailing backslash —
MUST be preserved as originally written; the serialiser MUST NOT normalise
one spelling into the other.

#### Scenario: Two source spellings, same node type

- GIVEN two fixtures, one using a trailing backslash and one using trailing
  double-space for a hard break, otherwise identical
- WHEN each is round-tripped
- THEN each output preserves its own original spelling

### Requirement: Character Entity and Escape Preservation

Character entities (for example `&amp;`) and escaped characters (for example
`\*`) MUST round-trip to the corpus's defined canonical spelling, and a
fixture combining an entity and its literal character in adjacent contexts
MUST keep them distinct rather than collapsing to one spelling.

#### Scenario: Entity and literal character stay distinct

- GIVEN a fixture containing both `&amp;` and a literal `&` in adjacent text
- WHEN it is round-tripped
- THEN the output preserves both spellings distinctly, matching the corpus's
  defined canonical form for each

### Requirement: Emphasis and Strong Marker Preservation

Emphasis and strong markers MUST use the pinned delimiter (`_` for emphasis
per the pinned option below) consistently, including in mixed and nested
combinations, and MUST NOT be renormalised to the other delimiter.

#### Scenario: Nested mixed emphasis and strong

- GIVEN a fixture with strong text containing nested emphasis, or emphasis
  containing nested strong text
- WHEN it is round-tripped
- THEN the output uses the pinned delimiters at every nesting level and is
  byte-identical to the input

### Requirement: Wiki-Link Round Trip, Resolved and Unresolved

Wiki-links, in their plain, aliased and anchored forms, and regardless of
whether they resolve to an existing page, MUST round-trip byte-identical.

#### Scenario: Anchored wiki-link

- GIVEN a fixture containing a wiki-link with a block anchor (for example
  `[[Page#block-id]]`)
- WHEN it is round-tripped
- THEN the output is byte-identical, including the anchor segment

#### Scenario: Unresolved wiki-link

- GIVEN a fixture containing a wiki-link to a title with no matching page
- WHEN it is round-tripped
- THEN the output is byte-identical; the editor does not alter or annotate the
  raw link text during serialisation

### Requirement: Tag Round Trip

The `#tag` syntax MUST round-trip byte-identical and MUST NOT be confused
with heading markers or code content during parsing.

#### Scenario: Tag adjacent to a heading

- GIVEN a fixture with a `#tag` in body text and a `#` heading elsewhere in
  the same document
- WHEN it is round-tripped
- THEN both are preserved as their own construct, byte-identical

### Requirement: Block-ID Anchor Syntax Round Trip

The persisted block-ID anchor syntax itself MUST round-trip byte-identical;
it is Markdown the system writes, and a corrupting round trip on it corrupts
the anchor primitive every other feature depends on.

#### Scenario: Persisted anchor preserved

- GIVEN a fixture containing a block with a persisted anchor
- WHEN it is round-tripped
- THEN the anchor's exact syntax and position are preserved byte-identical

### Requirement: Diagram Fence Passthrough

A diagram fence (Mermaid, D2) MUST be treated as an opaque code fence and
round-trip byte-identical; this phase MUST NOT render, validate, or alter
diagram fence contents.

#### Scenario: Mermaid fence untouched

- GIVEN a fixture containing a fenced code block with a Mermaid info string
  and diagram source as its content
- WHEN it is round-tripped
- THEN the fence, info string, and content are byte-identical to the input

### Requirement: Pinned Serialiser Options Are Test-Enforced

Every serialiser option that decides a spelling rather than a meaning (for
example, bullet marker `-`, emphasis marker `_`) MUST be pinned explicitly in
configuration and MUST be covered by a fixture that fails if the pin is
removed or changed to the library default.

#### Scenario: Removing a pin fails a named fixture

- GIVEN the bullet-marker pin is removed from the serialiser configuration
- WHEN the GATE-2 suite runs
- THEN a named fixture fails, identifying the missing pin as the cause

### Requirement: Unrepresentable Content Fails Closed, Never Drops Silently

For any construct the schema neither models nor carries verbatim, the editor
MUST refuse to open it in edit mode, state the reason, and offer read-only.
The system MUST NOT open the document, silently drop the construct, and save.

#### Scenario: Refusal states a reason

- GIVEN a document containing a construct outside the modelled-or-carried set
- WHEN a user attempts to enter edit mode
- THEN the system denies entry and presents a reason naming the unsupported
  construct

#### Scenario: Read-only remains available

- GIVEN the same document
- WHEN edit mode is refused
- THEN the user can still open the document read-only, unmodified

#### Scenario: Lossy round trip is a bug, not a tolerance

- GIVEN a fixture in the corpus
- WHEN its round trip produces output that differs from its input
- THEN the GATE-2 suite fails; no fixture is permitted to pass with a
  documented lossy exception

### Requirement: GATE-2 Precedes Editor UI Exposure

No Milkdown code MUST reach a user-facing screen before GATE-2 is green
across the full fixture corpus defined by this spec.

#### Scenario: Editor UI work blocked while GATE-2 is red

- GIVEN GATE-2 is failing on at least one fixture
- WHEN a change attempts to wire Milkdown into a user-facing screen
- THEN that change cannot be considered complete under this phase's sequencing
  requirement
