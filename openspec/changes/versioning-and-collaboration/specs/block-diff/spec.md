# Block Diff Specification

## Purpose

A pure, block-level diff between any two revisions: added, removed,
modified, and **moved**. Moved is available for free from stable block
identity and is impossible with line diffing, so line diffing is forbidden.
The diff belongs beside `matchBlocks()` in `packages/markdown` and consumes
only `{id, text}` pairs.

> Scope note: this spec enumerates the diff-input rule and every category
> explicitly, exceeding the default word budget, because a diff whose
> reference input is one column off (`block_index` instead of a fresh parse)
> is the highest-likelihood silent-defect path this change names.

## Requirements

### Requirement: The Diff Re-Parses Both Sides Fresh

Computing a diff between two revisions MUST call `sliceBlocks()` on each
revision's stored `content` independently, and MUST run `matchBlocks()` over
the two resulting block sets. The diff MUST NOT read either revision's stored
`block_index` column as its input.

#### Scenario: A document with zero anchored blocks still diffs correctly

- GIVEN two revisions whose Markdown contains no explicit block anchors at
  all, so `block_index` is empty on both
- WHEN a diff is requested between them
- THEN the diff reports every added, removed, modified or moved block based
  on `sliceBlocks()`'s derived ids
- AND NOT an empty diff produced by an implementation that read the empty
  `block_index` column instead

#### Scenario: The diff is unaffected by which blocks happen to be anchored

- GIVEN two revisions where the same edit touches both an anchored and an
  unanchored block
- WHEN the diff runs
- THEN both blocks appear in the diff result with the correct category
- AND NOT a diff that reports only the anchored block because the
  unanchored one was invisible to `block_index`-based input

### Requirement: Diff Reports Added, Removed, Modified, And Moved

The diff MUST classify each block from either side into exactly one of:
`added` (present only in the newer set), `removed` (present only in the
older set), `modified` (same slot, matched id, different text), or `moved`
(matched id, different slot, identical text).

#### Scenario: An added paragraph is reported as added

- GIVEN a revision pair where the newer one contains one new paragraph with
  no matching id in the older revision
- WHEN the diff runs
- THEN that block is reported as `added`, and it is not also reported as
  `modified`

#### Scenario: A moved block is reported as moved, not delete-plus-add

- GIVEN a revision pair where one block's text is byte-identical but its
  position changed
- WHEN the diff runs
- THEN it is reported as one `moved` entry
- AND NOT as one `removed` entry paired with one unrelated `added` entry

#### Scenario: A modified block is distinguished from a moved one

- GIVEN a revision pair where one block keeps its slot but its text changed
- WHEN the diff runs
- THEN it is reported as `modified`, not `moved`

### Requirement: Line Differencing Is Forbidden As A Fallback

No code path in the diff MUST fall back to a text-based line differ for any
input shape, including a document with no anchors, an empty document, or a
document where `matchBlocks()` finds no confident match.

#### Scenario: An unmatched block is reported as remove-plus-add, not a line diff

- GIVEN two revisions with no blocks in common by identity or high-confidence
  match
- WHEN the diff runs
- THEN every block on the old side is `removed` and every block on the new
  side is `added`, computed at block granularity
- AND NOT a character- or line-level diff rendered inside either block

### Requirement: The Diff Works Between Any Two Revisions

The diff MUST accept any pair of revisions belonging to the same page,
including non-adjacent ones, and MUST NOT depend on intermediate revisions
having been diffed or on the pair being chronologically adjacent.

#### Scenario: Diffing revision 1 against revision 5 directly

- GIVEN a page with five saved revisions
- WHEN a diff is requested between revision 1 and revision 5
- THEN the result reflects the net change between those two, computed
  directly from their own content, not from composing four adjacent diffs

### Requirement: Book-Level Diff Aggregates Changed Pages Since A Date

The system MUST provide a book-level "what changed since &lt;date&gt;" view,
computed from the book's changesets, listing each page changed and its
page-level diff.

#### Scenario: Book diff lists every page touched by a changeset in range

- GIVEN a book with two changesets after the given date, touching three
  distinct pages
- WHEN the book-level diff is requested for that date
- THEN all three pages appear, each with its page-level diff since the
  revision immediately preceding that date

### Requirement: Diff Access Goes Through can()

Requesting a page or book diff MUST be authorised through `can()` with the
`read` action on the target resource.

#### Scenario: Diff denied without read

- GIVEN a subject with no `read` grant on a page
- WHEN they request a diff involving that page
- THEN the request is denied and no diff content is returned
