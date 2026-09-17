# Delta for Knowledge Graph

Base: `openspec/specs/knowledge-graph/spec.md`.

## ADDED Requirements

### Requirement: A Wiki-Link To A Trashed Page Resolves Like An Unresolved Link

For a subject without `manage` on it, a wiki-link resolved to a page later
trashed MUST render with the same unresolved-link treatment as a link to a
title with no matching page.

#### Scenario: Trashed target renders as unresolved

- GIVEN a wiki-link resolved at save time to a page later trashed
- WHEN a subject without `manage` on that page renders the linking page
- THEN it renders identically to a wiki-link with no matching page

#### Scenario: A manager still sees the resolved link

- GIVEN the same trashed target
- WHEN the manager who trashed it renders the linking page
- THEN the link still renders resolved

### Requirement: Backlinks, Autocomplete, And Tag Listings Exclude Trashed Pages

Backlinks queries, link/mention autocomplete, and tag-filtered navigation MUST
exclude a trashed page for any subject without `manage` on it, through the
shared trash-aware helper (`trash-non-disclosure`).

#### Scenario: Trashed source page excluded from backlinks

- GIVEN page A links to page B, and page A is later trashed
- WHEN a subject without `manage` on page A requests page B's backlinks
- THEN page A does not appear

#### Scenario: Trashed page excluded from tag listing

- GIVEN a trashed page tagged `#project`
- WHEN a subject without `manage` on it lists pages tagged `#project`
- THEN that page does not appear
