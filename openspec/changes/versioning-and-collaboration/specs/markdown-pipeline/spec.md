# Delta for Markdown Pipeline

## MODIFIED Requirements

### Requirement: Block Split Assigns The Original ID To The Best-Matching Fragment

When a block carrying a persisted ID is split into two blocks, the original
ID MUST stay with the fragment that best matches the original content, and
the new fragment MUST receive a fresh ID. The original ID MUST NOT be
discarded or reassigned to neither fragment. The split result MUST also
record, for the new fragment, the origin id it split from, so provenance is
available to any consumer without re-deriving it from adjacency.

(Previously: the split result carried only the winning fragment's retained
id and the new fragment's fresh id, with no recorded link between them.)

#### Scenario: Splitting a persisted-anchor paragraph

- GIVEN a paragraph carrying a persisted block ID
- WHEN it is split into two paragraphs
- THEN exactly one resulting paragraph carries the original ID and the other
  carries a newly assigned ID

#### Scenario: The split result exposes the new fragment's origin

- GIVEN the same split as above
- WHEN the split result is inspected
- THEN the new fragment's entry names the original id as its origin
- AND NOT a split result where the two fragments carry no recorded
  relationship to each other

### Requirement: Block Merge Keeps One ID And Supersedes The Other

When two blocks are merged, the surviving block MUST keep exactly one of the
two original IDs, and the absorbed ID MUST be recorded as superseded rather
than deleted. Resolving a superseded id MUST walk the full chain to the
current surviving block even when multiple merges have occurred since,
rather than resolving only one hop.

(Previously: resolution was defined as a single hop; a superseded id that
had itself been superseded again had no defined resolution behaviour.)

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

#### Scenario: A multi-hop superseded chain resolves to the current survivor

- GIVEN a block id superseded by merge A, and the resulting block later
  superseded by merge B
- WHEN the original id is looked up
- THEN it resolves to merge B's surviving block, not merge A's now-also
  superseded intermediate
