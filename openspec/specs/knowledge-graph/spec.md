# Knowledge Graph Specification

## Purpose

The derived `links` table, backlinks, `tags`, `page_tags`, and tag-filtered
navigation (docs/SPECS.md §3.2). The graph is a projection of content, never
a source of truth, and it is never user-editable directly. This is a GATE-1
regression risk area: backlinks and mention/link autocomplete can disclose
the existence and title of a page the viewer cannot read, so every query
here MUST resolve through `can()`.

## Requirements

### Requirement: Links Are Rebuilt, Not Patched, On Every Save

Saving a page MUST reparse its Markdown and replace every `links` row
sourced from that page, rather than incrementally patching existing rows.

#### Scenario: Save replaces the source page's link rows

- GIVEN a page with two existing `links` rows sourced from it
- WHEN it is saved with content containing a different set of wiki-links
- THEN the prior rows sourced from that page are gone and the new set
  exactly matches the newly parsed links

#### Scenario: Removing a link removes its row

- GIVEN a page whose Markdown previously contained a wiki-link
- WHEN it is saved with that wiki-link removed
- THEN no `links` row sourced from that page still references the removed
  target

### Requirement: Links Are Never User-Editable Directly

No route or feature MUST write to `links` other than the save-triggered
parser.

#### Scenario: Direct write attempt is rejected

- GIVEN a request attempting to create or modify a `links` row outside the
  save pipeline
- WHEN it is processed
- THEN it is rejected

### Requirement: Wiki-Link To A Non-Existent Page Resolves As Unresolved

A wiki-link whose title matches no page MUST be recorded with no resolved
target and MUST NOT fail the save.

#### Scenario: Save succeeds with an unresolved link

- GIVEN a page containing a wiki-link to a title with no matching page
- WHEN it is saved
- THEN the save succeeds and the resulting `links` row has no resolved
  target while retaining the raw link text

### Requirement: Backlinks Resolve Through can()

A backlinks query for a page MUST filter the returned source pages through
`can(read)` for the requesting subject. A source page the subject cannot
read MUST NOT appear in the result, including its title or existence.

#### Scenario: Unreadable source page excluded from backlinks

- GIVEN page A links to page B, and a subject cannot read page A
- WHEN that subject requests page B's backlinks
- THEN page A does not appear, and nothing in the response reveals its
  title or existence

#### Scenario: Readable source page appears in backlinks

- GIVEN page A links to page B, and a subject can read page A
- WHEN that subject requests page B's backlinks
- THEN page A appears in the result

### Requirement: Link And Mention Autocomplete Never Discloses Unreadable Pages

Page-reference autocomplete (wiki-link authoring and `@` page mentions)
MUST only surface pages the requesting subject can read. It MUST NOT reveal
the title of an unreadable page, including as a partial or masked hint.

#### Scenario: Query matching only an unreadable page returns nothing

- GIVEN a page exists whose title matches the typed query, but the
  requester cannot read it
- WHEN they type that query in wiki-link or mention autocomplete
- THEN no suggestion is returned for that page, and no other content in the
  response reveals that it exists

#### Scenario: Query matching a readable page returns it

- GIVEN a page the requester can read matches the typed query
- WHEN they type that query
- THEN the page appears among the suggestions

### Requirement: Unresolved-Link Rendering Does Not Disclose Existence

Rendering a wiki-link whose target the viewer cannot read MUST look
identical to rendering a wiki-link whose target does not exist at all.

#### Scenario: Unreadable target renders identically to a missing one

- GIVEN a wiki-link resolved at save time to a page the current viewer
  cannot read
- WHEN the viewer renders the page containing that link
- THEN it renders with the same unresolved-link treatment as a wiki-link to
  a title with no matching page

### Requirement: Tags And Page-Tag Associations Are Rebuilt On Save

Saving a page MUST create any new tags it introduces and replace that
page's `page_tags` rows to match its currently parsed tags.

#### Scenario: New tag created on save

- GIVEN a page saved with a `#tag` not previously seen in the workspace
- WHEN the save completes
- THEN the tag exists in `tags` and the page is linked to it via
  `page_tags`

#### Scenario: Removed tag drops its association

- GIVEN a page previously tagged with `#tag`
- WHEN it is saved with that tag removed from the Markdown
- THEN the corresponding `page_tags` row for that page and tag no longer
  exists

### Requirement: Tag-Filtered Navigation Resolves Through can()

Listing pages under a tag MUST filter through `can(read)`. A page tagged
with that tag that the subject cannot read MUST NOT appear in the listing.

#### Scenario: Unreadable tagged page excluded from tag listing

- GIVEN a page tagged `#project` that the requester cannot read
- WHEN they list pages tagged `#project`
- THEN that page does not appear in the listing
