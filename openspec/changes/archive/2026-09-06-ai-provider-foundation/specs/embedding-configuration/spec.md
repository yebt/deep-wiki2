# Embedding Configuration Specification

## Purpose

Keeps `embedding_provider` independent of `chat_provider`, so a workspace whose chat
model has no embeddings endpoint still has a usable path to RAG, and constrains any
embedding source — remote or local — to the schema's fixed 1536-dimensional vector
space.

## Requirements

### Requirement: Independent Chat and Embedding Providers

`chat_provider` and `embedding_provider` MUST be configured as independent settings
with independent credentials. Selecting a `chat_provider` MUST NOT select or imply an
`embedding_provider`.

#### Scenario: Independent selection

- GIVEN a workspace
- WHEN an admin sets `chat_provider` to Anthropic and `embedding_provider` to OpenAI
- THEN both settings persist independently, each with its own credential

### Requirement: No Embedding-Incapable Provider Offered as Embedding Provider

A provider with no first-party embeddings endpoint MUST NOT be offerable as
`embedding_provider`. Anthropic and DeepSeek MUST NOT appear in the
`embedding_provider` selection.

#### Scenario: Chat-only provider excluded from embedding choice

- GIVEN the set of providers offered for `embedding_provider`
- WHEN the set is inspected
- THEN Anthropic and DeepSeek are absent

### Requirement: Chat-Only Workspace Still Gets a Usable Embedding Path

A workspace whose `chat_provider` cannot embed and which has not configured a separate
embedding credential MUST be offered the local fallback `embedding_provider` rather
than losing RAG capability silently.

#### Scenario: DeepSeek chat workspace falls back

- GIVEN a workspace with `chat_provider` set to DeepSeek and no embedding credential
  configured
- WHEN its effective `embedding_provider` is resolved
- THEN it resolves to the local fallback, and the workspace has a usable, non-null
  embedding configuration

### Requirement: Embedding Dimension Fixed at 1536

The system MUST declare `1536` as the schema embedding dimension constant. Only an
`embedding_provider`/model combination that emits exactly 1536 dimensions, natively or
through a provider-supported reduction parameter, MAY be registered.

#### Scenario: Native-size model registers

- GIVEN `text-embedding-3-small`, native at 1536 dimensions
- WHEN it is registered as an embedding model
- THEN registration succeeds

#### Scenario: Reduced-size model registers

- GIVEN `text-embedding-3-large`, native at 3072, requested with a `dimensions: 1536`
  parameter
- WHEN it is registered
- THEN registration succeeds at 1536

#### Scenario: Wrong-dimension model is rejected

- GIVEN a candidate embedding model that emits 1024 dimensions with no supported
  reduction to 1536
- WHEN registration is attempted
- THEN the system rejects it and does not add it to the registry

### Requirement: Local Fallback Constrained, Not Invented

A local or air-gapped embedding fallback MUST satisfy the 1536-dimension constraint to
be registered. The system MUST NOT ship a default local model that does not meet it.

#### Scenario: Known 1024-dimension model rejected

- GIVEN a local model such as bge-m3 or e5-large, emitting 1024 dimensions
- WHEN registration as the local fallback is attempted
- THEN the system rejects it

#### Scenario: Absence is explicit

- GIVEN no local embedding model meeting the 1536 constraint has been identified
- WHEN a self-hosted deployment queries its available local fallback
- THEN the system reports no local fallback is available, rather than silently
  substituting an incompatible model
