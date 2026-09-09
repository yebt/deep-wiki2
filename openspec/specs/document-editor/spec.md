# Document Editor Specification

## Purpose

The Milkdown/ProseMirror editing surface: Typora-like live preview, `@`
mentions, and `/` slash commands (docs/SPECS.md §5.2; UI-CHECKLIST §4.6).
This capability MUST NOT ship until GATE-2 (`markdown-round-trip`) is green.

## Requirements

### Requirement: Live Preview Renders In Place

The editor MUST render a WYSIWYG live preview in place as the user types,
not as a separate split pane.

#### Scenario: Typing renders formatted output inline

- GIVEN a user typing Markdown syntax (for example `**bold**`)
- WHEN the syntax completes
- THEN the formatted result renders inline at the cursor's location, with no
  separate preview panel involved

### Requirement: Live Preview Does Not Steal Focus Or Reflow Content

Re-rendering the live preview MUST NOT move focus away from the editor or
reflow content under the active cursor position.

#### Scenario: Cursor position is stable across a re-render

- GIVEN a user typing continuously
- WHEN the live preview re-renders mid-keystroke
- THEN focus remains in the editor and the cursor stays at the same logical
  position in the document

### Requirement: Mention And Slash Menus Are Keyboard-First

The `@` mention menu and the `/` slash command menu MUST support arrow-key
navigation, Enter to select the highlighted item, and Escape to dismiss and
return focus to the editor at the correct cursor position. The active item
MUST have a visible selected state distinct from hover.

#### Scenario: Arrow keys move the mention menu selection

- GIVEN an open mention menu with multiple candidates
- WHEN the user presses the down arrow
- THEN the next candidate becomes the visibly selected item

#### Scenario: Escape dismisses and restores focus

- GIVEN an open slash command menu
- WHEN the user presses Escape
- THEN the menu closes and focus returns to the editor at the cursor
  position where the menu was triggered

### Requirement: No Menu Inside A Code Block

Typing `@` or `/` while the cursor is inside a code block MUST NOT trigger
the mention or slash command menu.

#### Scenario: `@` inside a code block is inert

- GIVEN the cursor is inside a code fence
- WHEN the user types `@`
- THEN no mention menu opens

#### Scenario: `/` inside a code block is inert

- GIVEN the cursor is inside a code fence
- WHEN the user types `/`
- THEN no slash command menu opens

### Requirement: Empty And No-Results States

Both the mention menu and the slash command menu MUST present a distinct
empty-query state and a distinct no-results state.

#### Scenario: Empty query shows the initial state

- GIVEN the user has just triggered the mention menu with no query typed yet
- WHEN the menu renders
- THEN it shows its defined empty-query state, not a blank or loading menu

#### Scenario: Query with no matches shows the no-results state

- GIVEN the user has typed a query matching no candidate
- WHEN the menu renders
- THEN it shows its defined no-results state, distinct from the empty-query
  state

### Requirement: Menus Reposition To Stay In The Viewport

Mention and slash command menus MUST reposition when near the bottom or
right edge of the viewport and MUST NOT render clipped or off-screen.

#### Scenario: Menu near the bottom edge repositions above the caret

- GIVEN the cursor is near the bottom of the visible viewport
- WHEN a menu opens
- THEN the menu renders above the caret rather than being clipped below the
  viewport

### Requirement: Mention Autocomplete Is Filtered By can()

The `@` mention autocomplete for users, cells, and pages MUST only surface
candidates the requesting subject can read, resolved through `can()`. It
MUST NOT list a user, cell, or page the requester cannot read.

#### Scenario: Unreadable page excluded from mention autocomplete

- GIVEN a page the requester cannot read
- WHEN they type `@` and a query matching that page's title
- THEN the page does not appear among the suggestions

### Requirement: Mentioning A User Does Not Silently Grant Them Access

Mentioning a user or cell in a page MUST NOT itself grant that subject
access to the page. If the mentioned subject cannot read the current page,
the system MUST surface that mismatch rather than assume the mention
resolves it.

#### Scenario: Mentioning a user without access surfaces the mismatch

- GIVEN a user with no read access to the current page
- WHEN they are mentioned in that page
- THEN the editor indicates that the mentioned user cannot see this page,
  rather than silently completing the mention

#### Scenario: Mentioning a user with access proceeds normally

- GIVEN a user with read access to the current page
- WHEN they are mentioned in that page
- THEN the mention completes with no access warning

### Requirement: Mention And Slash Insertions Undo As One Step

Undo immediately following a mention or slash command insertion MUST remove
the entire inserted result as a single logical step, not character by
character.

#### Scenario: Undo removes a whole mention in one step

- GIVEN a user has just completed a mention insertion
- WHEN they trigger undo once
- THEN the entire mention is removed, and the text reverts to its state
  before the mention was triggered
