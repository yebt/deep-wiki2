# Embedding Index Integrity Specification

## Purpose

Specifies the immutability contract for the vector index before any chunk exists: the
active `(embedding_model, dimensions)` pair is a property of the workspace, every
embedding row records the pair it was written with, a write that disagrees is rejected
by the database, and changing the pair is an explicit tracked job rather than an
implicit side effect.

## Requirements

### Requirement: Active Pair Recorded on the Workspace

The workspace's active `(embedding_model, dimensions)` pair MUST be recorded as a
`workspace_embedding_indexes` generation row marked active for that workspace, not as
columns on `workspace_ai_settings`. A generation row, not settings columns, is what the
composite chunk foreign key can target: pinning the pair to `workspace_ai_settings`
columns would force `ON UPDATE RESTRICT` on that settings row, making a model switch
impossible while any chunk exists (design.md — "Why the embedding pair is a table and
not two columns on settings"; D14). The active pair MUST be readable by any future
write or read path from this row, without an additional settings lookup.

#### Scenario: Active pair is set on first embedding configuration

- GIVEN a workspace configuring `embedding_provider` for the first time
- WHEN the model is selected
- THEN a `workspace_embedding_indexes` row is created for that model and its dimension,
  and marked `active` as the workspace's active generation

### Requirement: Per-Row Model and Dimension Recording

Every embedding row MUST record the `embedding_model` and `dimensions` it was produced
with, alongside the vector value itself.

#### Scenario: Row carries its provenance

- GIVEN an embedding row is written
- WHEN the row is inspected
- THEN it carries a non-null `embedding_model` and `dimensions`

### Requirement: Mismatched Writes Rejected at the Database

A write whose `(embedding_model, dimensions)` differs from the workspace's active pair
MUST be rejected by a database-level constraint, not solely by application-code
validation.

#### Scenario: Different model rejected

- GIVEN a workspace's active pair is `(text-embedding-3-small, 1536)`
- WHEN a row is written with `embedding_model = text-embedding-3-large` while the
  active pair is unchanged
- THEN the database rejects the write

#### Scenario: Different dimension rejected

- GIVEN a workspace's active pair at 1536 dimensions
- WHEN a row is written with `dimensions = 1024`
- THEN the database rejects the write

### Requirement: Declared Vector Dimension

Any pgvector column storing an embedding MUST declare its dimension (for example
`vector(1536)`) and MUST NOT be left undimensioned.

#### Scenario: ANN index builds successfully

- GIVEN an embedding column declared as `vector(1536)`
- WHEN an HNSW index is created over it
- THEN index creation succeeds

#### Scenario: Undimensioned column is not used

- GIVEN the schema definition for any embedding column
- WHEN it is inspected
- THEN it declares an explicit dimension rather than a bare `vector` type

### Requirement: Reindexing Is an Explicit Tracked Job

Changing a workspace's active `(embedding_model, dimensions)` pair MUST create a
resumable, tracked reindex job with a progress state and a completion state. It MUST
NOT be an implicit side effect of a settings change.

#### Scenario: Changing the setting creates a job

- GIVEN a workspace with existing embeddings under its current active pair
- WHEN an admin changes `embedding_provider` to a model with a different pair
- THEN a reindex job record is created with an initial progress state, and the active
  pair does not change until the job completes

#### Scenario: Reads stay on the prior pair during reindex

- GIVEN a reindex job in progress
- WHEN a retrieval query runs
- THEN it filters on the still-active prior pair until the job reaches its completion
  state
