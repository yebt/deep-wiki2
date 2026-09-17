# Delta for Tenancy Model

Base: `openspec/specs/tenancy-model/spec.md`.

## MODIFIED Requirements

### Requirement: Node Tree Structure

The system MUST store the navigation hierarchy in a single `nodes` table with columns
`id`, `workspace_id`, `parent_id`, `type` (`shelf` | `book` | `chapter` | `page`),
`position`, a materialised ancestry `path`, a nullable `trashed_at` timestamp, and a
nullable `trash_operation_id` grouping everything trashed together in one operation.
A page MUST be permitted to have a `book` as its direct parent, without an
intervening chapter.
(Previously: no `trashed_at` or `trash_operation_id` column existed; every node
was implicitly live.)

#### Scenario: Page created directly under a book

- GIVEN a book node with no chapters
- WHEN a page is created with that book as `parent_id`
- THEN the page node is persisted with `type = page` and the book as its parent

#### Scenario: Page created under a chapter

- GIVEN a chapter node under a book
- WHEN a page is created with that chapter as `parent_id`
- THEN the page node is persisted with the chapter as its parent

#### Scenario: A newly created node is live

- GIVEN a new node insert
- WHEN it is persisted
- THEN `trashed_at` and `trash_operation_id` are both null

## ADDED Requirements

### Requirement: Sibling Slug Uniqueness Holds Among Live Siblings Only

The unique constraint on a node's slug among its siblings MUST apply only to
siblings with `trashed_at IS NULL`. A trashed sibling MUST NOT block a live
node from taking its slug.

#### Scenario: A live node may take a trashed sibling's slug

- GIVEN a trashed page with slug `overview` under a chapter
- WHEN a new live page is created under that chapter with slug `overview`
- THEN the creation succeeds

#### Scenario: Two live siblings still cannot share a slug

- GIVEN a live page with slug `overview` under a chapter
- WHEN another live page is created under the same chapter with slug `overview`
- THEN the creation is rejected
