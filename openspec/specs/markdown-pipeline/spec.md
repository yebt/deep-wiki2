# Markdown Pipeline Specification

## Purpose

`packages/markdown` as the single unified/remark pipeline for the whole
repository: parsing, GFM and custom syntax extensions, stable block-ID
lifecycle, wiki-link and tag normalisation, and deterministic chunk
boundaries. A second parser anywhere is a permanent bug class (CLAUDE.md;
docs/SPECS.md §14) and is forbidden.

## Requirements

### Requirement: Single Markdown Parser Across The Repository

Every consumer that parses or serialises Markdown — the editor, the API, and
the future indexer — MUST import `packages/markdown`. No package MUST
instantiate its own unified/remark pipeline or depend on a competing Markdown
library.

#### Scenario: Editor imports the shared pipeline

- GIVEN `packages/editor` needs to parse Markdown into mdast
- WHEN its parsing function is implemented
- THEN it calls `packages/markdown`'s parser rather than constructing its own
  unified pipeline

### Requirement: GFM And Custom Syntax Extensions Do Not Break CommonMark

The pipeline MUST support GFM tables and footnotes and custom extensions for
wiki-links, tags, and the block-ID anchor syntax. These extensions MUST NOT
alter the parse result of text that was valid CommonMark before they were
added.

#### Scenario: Table syntax parses as a table

- GIVEN a document containing GFM table syntax
- WHEN it is parsed
- THEN the result includes a table node with its rows and alignment

#### Scenario: Plain bracket text is not misparsed as a wiki-link

- GIVEN a document containing `[text](url)` standard Markdown link syntax
- WHEN it is parsed with the wiki-link extension enabled
- THEN it parses as a standard link, not a wiki-link

### Requirement: Block IDs Are Assigned Lazily

A block MUST NOT receive a persisted ID merely by existing. A block receives
a persisted ID only when something references it: a comment anchor, an AI
citation, or an explicit user-created anchor. Until referenced, a block
carries a derived, in-index-only identity.

#### Scenario: Parsing an unreferenced document assigns no persisted IDs

- GIVEN a document with no comments, citations, or explicit anchors
- WHEN it is parsed
- THEN no block in the document carries a persisted ID in the Markdown text

#### Scenario: Creating a reference assigns a persisted ID

- GIVEN a block with no persisted ID
- WHEN a comment is anchored to that block
- THEN the block receives a persisted ID, recorded in both the block index
  and the Markdown text

### Requirement: Block Index And In-Text Anchors Stay In Sync

The block index (`block_id → {start, end, hash}`) MUST reflect every
persisted anchor present in the Markdown, and every persisted anchor in the
Markdown MUST appear in the block index, so an export of the Markdown stays
self-contained.

#### Scenario: Index built from persisted anchors

- GIVEN a document containing a persisted block anchor
- WHEN it is parsed
- THEN the block index contains an entry for that anchor's block ID

### Requirement: Block Split Assigns The Original ID To The Best-Matching Fragment

When a block carrying a persisted ID is split into two blocks, the original
ID MUST stay with the fragment that best matches the original content, and
the new fragment MUST receive a fresh ID. The original ID MUST NOT be
discarded or reassigned to neither fragment.

#### Scenario: Splitting a persisted-anchor paragraph

- GIVEN a paragraph carrying a persisted block ID
- WHEN it is split into two paragraphs
- THEN exactly one resulting paragraph carries the original ID and the other
  carries a newly assigned ID

### Requirement: Block Merge Keeps One ID And Supersedes The Other

When two blocks are merged, the surviving block MUST keep exactly one of the
two original IDs, and the absorbed ID MUST be recorded as superseded rather
than deleted.

#### Scenario: Merging two persisted-anchor blocks

- GIVEN two adjacent blocks, each carrying a persisted ID
- WHEN they are merged into one block
- THEN the merged block carries one of the original IDs, and the other ID is
  recorded as superseded, pointing at the merged block

#### Scenario: A superseded ID resolves rather than vanishing

- GIVEN a superseded block ID from a prior merge
- WHEN something looks up that ID
- THEN the lookup resolves to the current surviving block rather than
  returning nothing

### Requirement: Block Delete Tombstones The ID

Deleting a block carrying a persisted ID MUST tombstone that ID. A
tombstoned ID MUST NOT be reused for a new block.

#### Scenario: Deleted block's ID is not reassigned

- GIVEN a persisted block ID belonging to a deleted block
- WHEN a new block is later created
- THEN the new block does not receive the tombstoned ID

### Requirement: Wiki-Link Parsing And Normalisation

The pipeline MUST parse wiki-link syntax, including plain, aliased and
anchored forms, and normalise each into a link representation carrying the
raw text, the resolved target (if any), and the anchor (if any).

#### Scenario: Wiki-link to an existing page

- GIVEN a wiki-link naming an existing page's title
- WHEN it is parsed
- THEN the normalised link representation carries that page's identity as
  its resolved target

#### Scenario: Wiki-link to a non-existent page

- GIVEN a wiki-link naming a title with no matching page
- WHEN it is parsed
- THEN the normalised link representation carries no resolved target and
  retains the raw link text

### Requirement: Tag Parsing

The pipeline MUST parse `#tag` syntax as a distinct construct from headings
and from `#` characters inside code.

#### Scenario: Tag distinguished from a heading marker

- GIVEN a document with a `#` heading and a separate `#tag` in body text
- WHEN it is parsed
- THEN the heading and the tag are recognised as distinct constructs

### Requirement: Deterministic Chunk Boundaries Carrying Block IDs

The chunking function MUST be a pure function of its Markdown input: for
identical input it MUST produce identical chunk boundaries. Chunk boundaries
MUST follow block boundaries and MUST carry the block IDs of the blocks they
contain.

#### Scenario: Identical input yields identical chunks

- GIVEN the same document parsed twice
- WHEN chunking runs both times
- THEN the resulting chunk boundaries and block-ID assignments are identical

#### Scenario: Chunk boundaries align to block boundaries

- GIVEN a document with multiple blocks
- WHEN it is chunked
- THEN no chunk boundary falls inside a single block, and each chunk records
  the block IDs it spans
