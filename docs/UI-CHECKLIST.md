# UI Review Checklist

> Living document. Entries are **added** after every review and never silently removed.
> If a rule here turns out to be wrong, change it in place and record why in the Review Log.

---

## 1. Purpose & workflow

### Why this file exists

AI-generated UI in this project has repeatedly shipped with poor UX: screens that look plausible in a screenshot but fail on the states, the density, the keyboard, or the permission model that this product actually has. The failures repeat because each generation starts from zero.

This file is the project's accumulated UI memory. Every new screen or interaction is reviewed by the project owner before the work continues, and every review appends what went wrong to the [Review Log](#9-review-log) so the same mistake is not made twice.

### The review gate

**No screen or interaction is considered done until the owner has reviewed it.** The gate is not advisory. Work that has not passed review does not get built on top of.

Order of operations for any UI work:

1. Fill in the [Pre-build contract](#2-pre-build-contract). If it cannot be filled in, the screen is not ready to build — go get the answers.
2. Build, walking sections 3–6 as you go.
3. Write the happy-path e2e (section 7) and make it pass.
4. Self-check against the [Definition of done](#8-definition-of-done-for-a-screen). Every box checked.
5. Present for owner review.
6. Owner findings get appended to the Review Log, and any generalisable rule gets added to sections 3–6.

### How a reviewer uses this checklist

- **Walk the sections in order.** Sections 3 and 5 are the ones that historically fail; do them first if time is short.
- **Fail fast.** The first unchecked box in "Required states" or "Accessibility floor" ends the review. Do not continue auditing polish on a screen with no error state.
- **Report observable evidence, not taste.** A finding names what can be seen in the running UI and the smallest concrete correction. "The nav feels cluttered" is not a finding. "The book tree shows 40 items with no truncation and pushes the primary action below the fold at 1280×800; truncate at depth 2 with a disclosure" is.
- **Cap at three material findings per review, ordered by user impact.** A list of twenty nits gets ignored. Fix the three that matter, re-review.
- **Personal preference is not a defect.** If a choice is defensible and consistent with the existing system, it passes even if the reviewer would have done it differently.

### Standing rule: extend the system, do not invent one

The product's existing components, tokens, and conventions **outrank everything in this document**. New UI extends what is already there. Novelty for its own sake is a defect. If a screen needs a pattern the system does not have, that is a system change to be made deliberately and once — not an inline improvisation.

---

## 2. Pre-build contract

Answer all six before writing a component. Paste the answers into the PR or task description. A screen that cannot answer these is not ready to be built.

- [ ] **Who is the user at this exact moment?** Not "a user" — a Workspace Admin who just accepted an invite and has no books yet; a Cell member with read-only access to one shelf; an agent-facing operator checking a pending revision. Their role and their permission level change what this screen renders.
- [ ] **What are they trying to accomplish?** One sentence, in their words, not the system's. "Find the decision we made about auth in the March meeting notes" — not "query the page index".
- [ ] **What is the single primary action?** Exactly one. If two actions are equally primary, the screen is doing two jobs and should be split or one demoted.
- [ ] **What data actually exists to render?** Named fields from the real schema, not hypothetical ones. If the design shows an author avatar and last-edited timestamp, both must be queryable at this point in the flow. Designing against data you do not have produces UI that gets gutted at integration.
- [ ] **What must this screen NOT do?** The explicit non-goals. Prevents scope creep into a settings panel that quietly becomes an admin console.
- [ ] **What does this screen look like with nothing in it, and with far too much in it?** Both extremes, before the happy path. Zero books; a book with 400 pages; a page with a 12,000-word document; a comment thread with 60 replies.

---

## 3. Required states

Every screen and every non-trivial component. Each state must be **demonstrable** — reachable in the running app or in a story/fixture, not just theoretically handled.

- [ ] **Empty** — genuinely empty, with a path forward. An empty workspace shows how to create the first shelf, not a blank panel. Empty states name the object in the product's own vocabulary (shelf, book, chapter, page, rule pack), never "no items".
- [ ] **First-run vs. filtered-empty are distinct.** "You have no books yet" and "No books match 'auth'" are different screens with different actions (create vs. clear the filter). Collapsing them into one is a defect.
- [ ] **Loading — skeleton, not spinner, wherever the content shape is known.** The page tree, the document body, the comment list, and the book list all have known shapes; they get skeletons matched to their real layout. A spinner is acceptable only for an action of unknown duration with no known result shape.
- [ ] **No layout shift on load.** The skeleton occupies the same box the loaded content will. Measure it; do not assume it.
- [ ] **Partial / streaming** — the AI panel streams. Partial output must be readable while it arrives, must not cause the scroll position to jump, and must be visually marked as in-progress and therefore incomplete.
- [ ] **Error — recoverable.** States what failed in the user's terms and offers a real next action (Retry, Reconnect, Edit credentials). Never a bare status code. Never a dead end.
- [ ] **Error — fatal.** Distinct treatment from recoverable. Preserves any unsaved user input and says explicitly whether the work was lost or preserved.
- [ ] **Permission-denied.** This app is permission-heavy: deny wins, most-specific wins, and inheritance runs Workspace → Shelf → Book → Chapter → Page. A user who cannot see a book gets a coherent screen that says so and offers a request-access path — never a broken layout, never a half-rendered tree, never a 500, and never a silently empty list that implies the content does not exist.
- [ ] **Permission-denied does not leak existence** where it should not. Decide per resource whether "you can't see this" or "this doesn't exist" is correct, and be consistent.
- [ ] **Route-level failure has a screen, and it is one screen.** A URL that matches no route, and a request that fails before any page can render, both land on the application's own error screen — the same shell, chrome, type scale and theme as everything else, never the framework's default error page, which belongs to a different product. It distinguishes **not found** from **the server failed**, because the user's next move differs, and each states what happened in the user's terms and offers a real way forward: never a bare status code as the message, never a dead end, and never "go home" as the only offer when the address itself says where the user was trying to go.
- [ ] **The not-found screen renders from the status code alone.** No field of the error object reaches the DOM — not `message`, not `statusMessage`, not `data`. That is what makes a 404 for a resource the viewer may not see byte-identical to a 404 for one that never existed, and it is the only reason any other surface can safely choose not to disclose. A screen that prints the server's reason turns every such decision into a leak. The address the user typed is the exception, because it came from the user; nothing the server said about *why* is.
- [ ] **Offline / stale.** The connection to the workspace can drop. The UI says so, marks displayed data as possibly stale, disables actions that would fail, and recovers without a manual reload.
- [ ] **Success.** Confirmed visibly and specifically. "Saved" is weak; "Saved as revision 12 · 2 min ago" is a confirmation the user can act on. Destructive or irreversible actions get a stronger confirmation than a toast that vanishes in 3s.
- [ ] **Disabled.** Every disabled control explains why, on hover/focus, in one sentence. A disabled button with no reason is a defect.

---

## 4. Project-specific rules

Derived from this project's actual stack and domain.

### 4.1 Component library — Nuxt UI (Tailwind v4 / Reka UI)

- [ ] The component exists in Nuxt UI and is used, rather than hand-rolled. Check the library before building a button, modal, dropdown, popover, tooltip, table, toast, command palette, or form control.
- [ ] No arbitrary Tailwind values (`w-[437px]`, `text-[13.5px]`, `bg-[#1a1a1a]`) fighting the library's scale. If the scale is genuinely wrong for this product, the scale gets changed once, centrally.
- [ ] Reka UI primitives are used for anything with interaction semantics (menus, dialogs, comboboxes). Hand-rolled versions lose focus trapping, `aria-*` wiring, and keyboard handling that this checklist requires elsewhere.
- [ ] No wrapper component that exists only to rename a Nuxt UI prop.
- [ ] **Anything that appears on more than one screen is one component, not one copy per screen.** The header, the footer, the page heading block, the card that holds a form, the panel a screen shows instead of its content. A second copy is a defect even while the two copies are identical, because they will not stay identical — this is how the app bar came to say two different things and only one of two screens got a layout fix.
- [ ] **Before building a screen, open the screen nearest to it and match its measured values** — container radius and tone, control height, heading size, the gaps between blocks. A screen may pass every box below in isolation and still make the product look unsystematic; this checklist audits one screen, so the comparison to the others has to be made deliberately.
- [ ] **No native `alert()`, `confirm()` or `prompt()`.** They are outside every theme, carry "OK" for a verb, trap nothing and return focus nowhere. A question is `useConfirm()` — the product's one dialog (`ConfirmDialog`, on `UModal`) — with the verb as the confirm label and the consequence as the description. The one exception is `beforeunload`, the prompt when a tab closes with unsaved work: the browser's own, not replaceable, and marked as such at the call site (2026-09-16 review).
- [ ] **A hand-rolled replacement for a library primitive owes the keyboard and ARIA contract that primitive would have brought.** Reaching past the library for the one mechanism it lacks is sometimes right; dropping the mechanisms it *has* never is. Before writing one, list what the library component provides — tab order, roving focus, arrow keys, activation, `aria-*` wiring, focus return — and implement each. The navigation tree reached for drag-reorder, which `UTree` has no answer for, and shipped with zero tab stops: a screen whose whole purpose is finding a page could not open one without a mouse (2026-09-07 review).

### 4.2 Theming — user-selectable themes via CSS variables

- [ ] **No hardcoded color, spacing, radius, shadow, or font-size literal anywhere in a component.** Every visual value resolves to a token. A single hardcoded hex breaks the theme switcher for that element in every theme but the one it was written against. This is the highest-frequency theming defect; grep for `#`, `rgb(`, and `hsl(` in component files before review.
- [ ] The screen has been visually verified in **at least two contrasting themes, one of them dark**. Screenshot both.
- [ ] Contrast holds in every verified theme, not just the default (see section 5).
- [ ] Nothing depends on a specific theme's background being light or dark — no white-on-transparent icons, no shadows that vanish on dark, no borders that disappear.
- [ ] Focus rings remain visible in every verified theme.
- [ ] Diagram surfaces (Mermaid/D2 render output) are readable in every verified theme. Diagram text and strokes are a common theme-break because they are generated, not authored.

### 4.3 Icons — user-selectable packs via `@nuxt/icon` + Iconify

- [ ] **No icon is the only carrier of meaning.** Packs differ in metaphor: an icon that reads clearly in Lucide can be ambiguous in Tabler or Material. Every icon is paired with a visible text label, or — where space genuinely forbids it — an accessible name plus a tooltip.
- [ ] Icon-only buttons have an `aria-label` and a tooltip. Both. No exceptions in toolbars.
- [ ] The screen renders correctly with **at least two different icon packs selected**. Verify sizing and optical alignment, not just presence — packs differ in viewBox padding and stroke weight.
- [ ] Missing-icon fallback is handled. Not every name exists in every pack; a missing icon must not collapse the layout or render a broken glyph box.
- [ ] **Build gotcha:** dynamic icon names defeat `@nuxt/icon`'s build-time tree-shaking. Any dynamically-selected icon set must have its collections explicitly declared/bundled (`@iconify-json/*`), or self-hosted and air-gapped instances will render nothing. Verify with the network blocked.
- [ ] **Bundle gotcha (2026-09-16):** a server bundle alone is not offline. `@nuxt/icon` puts only Nuxt UI's default icons in the client bundle; every icon *this app's templates* name was fetched at runtime from `/api/_nuxt_icon/<collection>.json?icons=…` the first time a screen showed it (one request per screen, a late pop-in with it), and when that request was slow it fell through to the public `api.iconify.design` (`fallbackToApi` defaults to `true`) — measured on the read → edit hop. `nuxt.config.ts` now scans templates into the client bundle (`clientBundle.scan`) and sets `fallbackToApi: false`; `e2e/icons.spec.ts` asserts no icon request across dashboard → page → edit → page. An icon named only in a `.ts` file, or built from a string at runtime, is not scanned — list it in `clientBundle.icons`.

### 4.4 Reading density — this is a tool people live in all day

- [ ] Long-form document content has a **constrained measure**: roughly 65–80 characters per line. Full-viewport-width prose on a 27" monitor is a defect, not a feature. **Count it in the browser on real content**, by walking the laid-out text and splitting it where the line boxes change — 72ch is a token, and a token is a prediction about a font the theme is free to change. Measured this way on 2026-09-07, the read column holds a median of 77 characters (76–82 across its paragraphs) at 1280, 1024 and 768.
- [ ] Real typographic hierarchy. Heading levels are visually distinguishable from each other and from body text by more than weight alone. A wiki whose h2 and h3 look identical has no scannable structure.
- [ ] Generous vertical rhythm between blocks. Paragraph, list, code block, and diagram spacing is consistent and comes from tokens.
- [ ] Reading comfort beats visual flourish. No gradient text, no animated headers, no decorative motion in the document body.
- [ ] Code blocks and tables scroll inside their own container and never widen the page (see section 6).
- [ ] Chrome (nav, toolbars, panels) is visually quieter than content. If the sidebar competes with the document for attention, the sidebar loses.
- [ ] **An eyebrow above a heading must add context the heading does not.** Repeating a word of the `h1` spends a hierarchy level for nothing. Added after the 2026-09-04 review removed the eyebrow from all four auth screens; recorded then in the Review Log but not here, which is why `/` kept "Phase 0 · Bootstrap" above "Bootstrap smoke page" for two more reviews.
- [ ] **A page description is chrome, not document prose.** It takes `body-large` (16px on 24px leading), not `doc-body` (16px on 26px) — `docs/DESIGN-SYSTEM.md` §2.3 reserves the longer leading for the reading surface. The same sentence must not be set solid two ways on two screens.
- [ ] **A screen's `<h1>` keeps one type role across every state it has.** The state changes the words, not the hierarchy: a permission-denied screen, a not-found screen and a loaded screen all render the page's one heading at the same size. Read and edit mode rendered theirs at `headline-medium` when the page loaded and `headline-small` when it did not, so the type scale reported how the request went (2026-09-07 review).

### 4.5 Read mode vs. edit mode

- [ ] The two modes are **visually unmistakable** at a glance — not a single small pencil icon changing state.
- [ ] The transition between them is obvious, reversible, and loses no data in either direction.
- [ ] Leaving edit mode with unsaved changes prompts. Browser navigation away with unsaved changes prompts.
- [ ] Read mode renders pre-rendered HTML and does **not** boot the editor. Verify: the ProseMirror bundle must not load on a read-mode page view.
- [ ] Entering edit mode when someone else holds the soft lock shows the presence state before the editor opens, not after.

### 4.6 Editor — ProseMirror (built directly on it; no Milkdown, see `docs/SPECS.md` §5.1)

- [ ] `@` mentions and `/` slash commands are **keyboard-first**: arrow keys navigate, Enter selects, Escape dismisses, Tab does something sane and documented.
- [ ] The active item in a mention/command menu has a visible selected state distinct from hover.
- [ ] Escape always dismisses the topmost transient surface and returns focus to the editor at the correct cursor position.
- [ ] Menus reposition to stay in the viewport near the bottom or right edge; they never render clipped or off-screen.
- [ ] Typing `@` or `/` inside a code block does **not** trigger the menu.
- [ ] An empty query state and a no-results state both exist for both menus.
- [ ] Live preview does not steal focus or reflow content under the cursor while typing.
- [ ] Undo/redo work across mention and slash-command insertions as single logical steps, not character-by-character.

### 4.7 Block anchors — comments, AI selections, diffs

- [ ] The anchored target is **visibly indicated** and the indicator stays correct while scrolling.
- [ ] Clicking a comment scrolls its block into view and highlights it; the highlight is dismissible and does not persist forever.
- [ ] **Orphaned anchors degrade gracefully.** A comment whose block was deleted renders as an orphaned comment with its original quoted context — never a crash, never a silently vanished thread, never an anchor pointing at the wrong block.
- [ ] Multiple comments on the same block do not stack into an unreadable gutter; they collapse with a count.
- [ ] Diff view marks added / removed / **moved** blocks distinctly. Moved is a distinct treatment — it is the payoff of block-level diffing and rendering it as delete+add throws that away.
- [ ] Book-level (changeset) diff is navigable: the user can move between changed pages without returning to a list.

### 4.8 Presence and the soft lock

- [ ] Presence shows **who** is editing and **since when**, not just an anonymous indicator.
- [ ] The soft lock must **never look like a hard lock.** Both paths are visible simultaneously: "Open read-only" and "Take over editing". If the user can only see one, the affordance has failed.
- [ ] "Take over" states its consequence for the other person before it is confirmed.
- [ ] Stale presence expires visibly. A user who closed their laptop 40 minutes ago must not appear to still be editing.
- [ ] Presence avatars have accessible names; the presence row is not conveyed by color alone.

### 4.9 AI panel

- [ ] **A stop control is visible for the entire duration of streaming**, positioned consistently, and it actually aborts the request.
- [ ] Token and cost usage are visible — plans are metered by the Super Root and the user must be able to see what they are spending before they hit a wall.
- [ ] Approaching or exceeding a plan limit is communicated before the action fails, with the limit named.
- [ ] The active provider and model are visible. Switching providers mid-conversation is either prevented or clearly marked in the transcript.
- [ ] **AI-proposed edits are visually unmistakable from accepted content.** Pending revisions get their own persistent treatment — not a subtle tint that disappears against a theme. A reader must never mistake a proposal for the source of truth.
- [ ] Accept / reject on a proposed revision are both present, equally reachable, and show a diff before commit.
- [ ] Which team rule packs are in the prompt context is inspectable from the panel, with the resolved cascade shown.
- [ ] RAG answers cite their source blocks, and the citations are clickable back into the document.
- [ ] Errors from the model provider surface as the provider's actual failure (rate limit, invalid key, context length), not a generic "Something went wrong".
- [ ] BYOK credentials are never rendered, logged to the console, or echoed back into the DOM.

### 4.10 Visual design system

- [ ] The screen follows [`docs/DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md), which is this project's Material Design 3 translation layer for Nuxt UI v4 and the **authority on colour roles, type scale, shape, elevation, state layers, motion, spacing and density**. Read it before building, not after.
- [ ] **This checklist remains the authority on required states, the accessibility floor, and responsive behaviour.** Where the two disagree on any of those, this file wins and the design system gets corrected.
- [ ] Any deviation from the design system is deliberate and recorded in that file's change log — not improvised in a component.

### 4.11 Timestamps

Added 2026-09-08, after the page-history screen shipped with a decision this file had no rule
for. deep-wiki is built for teams that are not in one place; a time is only useful if the reader
knows which time it is.

- [ ] Every timestamp renders in the **viewer's own timezone**, never the server's and never
      forced to UTC.
- [ ] The rendered string **names its zone** (`Sep 8, 2026, 10:07 AM GMT-5`). A bare local time
      is ambiguous the moment two readers are in different places, which for this product is the
      normal case rather than the edge one.
- [ ] The exact instant is carried in a `<time datetime="…">` element as ISO 8601, so precision
      survives however the visible text is formatted, and so a machine reading the page — this
      product's other audience — gets the unambiguous value.
- [ ] **The screen does not server-render a localised time.** The server does not know the
      viewer's zone, so formatting during SSR renders the *server's* zone and then changes after
      hydration: a visible flicker and a Vue hydration mismatch. Either the value is fetched
      client-side and never server-rendered, or the localisation is explicitly deferred to the
      client. Whichever holds, say so at the call site — an implicit invariant is one the next
      person breaks by moving a fetch.
- [ ] A test forces **at least two distinct timezones** and asserts the same instant renders
      differently in each. A timezone test that runs only in the machine's own zone proves
      nothing. Prefer a pair whose offset crosses a calendar day, so a whole-day error is caught
      and not just a clock offset.

---

## 5. Accessibility floor

Non-negotiable. Each item is **pass/fail**, not an aspiration. A fail blocks the review.

- [ ] **Every interactive element is reachable and operable by keyboard alone.** Tab through the entire screen with the mouse unplugged and complete the primary action.
- [ ] **Focus is always visible.** In every verified theme. A `:focus` style removed without an equivalent `:focus-visible` replacement is an automatic fail.
- [ ] **Focus order matches visual order.** No jumps to the end of the DOM and back.
- [ ] **Focus is trapped in modals and returned on close** to the element that opened them.
- [ ] **No keyboard trap.** Every transient surface can be escaped with Escape.
- [ ] **Every pointer-only manipulation has a stated keyboard equivalent.** Drag-and-drop, resize, and reorder are the usual offenders: if the only way to move an item is to drag it, the feature does not exist for a keyboard user. Name the keys in the UI, not only in a comment — the navigation tree's reorder is `Alt` with the arrow keys, and the screen says so.
- [ ] **A control that is unavailable uses `aria-disabled`, not the `disabled` attribute, whenever it carries an explanation.** The attribute removes the control from the tab order, which puts its own reason — required on hover *and* focus by §3 — behind a hover a keyboard user cannot perform.
- [ ] **Contrast:** 4.5:1 for body text, 3:1 for large text and for the boundary of interactive controls. Verified in every theme shipped, not just the default.
- [ ] **Color is never the sole carrier of meaning.** Diff add/remove, presence status, validation state, and pending-revision marking all carry a second signal (icon, text, pattern).
- [ ] **Every form input has a programmatically associated label.** Placeholder text is not a label.
- [ ] **Validation errors are associated with their input** (`aria-describedby`) and are announced, not only colored red.
- [ ] **Semantic landmarks** exist: `nav`, `main`, `aside`, `header`. One `main` per page.
- [ ] **Heading order is sequential** and reflects document structure. No jumping h1 → h4 for styling.
- [ ] **`prefers-reduced-motion` is respected.** All non-essential transitions, streaming animations, and skeleton shimmer reduce or stop.
- [ ] **Async state changes are announced** to screen readers via a live region: save completed, streaming started/stopped, error occurred, permission denied.
- [ ] **Target size** is at least 24×24 CSS px for any pointer target, with adequate spacing between adjacent targets in dense areas like the page tree and comment gutter.
- [ ] **Images and diagrams have text alternatives.** A Mermaid diagram's source is its accessible fallback and must be reachable.

---

## 6. Responsive & layout

The app shell is a three-pane wiki: navigation tree · document · contextual panel (comments / AI / presence).

- [ ] **Wide (≥1280px):** all three panes usable simultaneously. The document keeps its constrained measure and does not stretch to fill.
- [ ] **Medium (768–1279px):** the contextual panel becomes an overlay or is collapsible. The document stays readable.
- [ ] **Narrow (<768px):** single pane. The navigation tree becomes a drawer that traps focus and closes on selection and on Escape.
- [ ] **The page body never scrolls horizontally.** At any breakpoint. Verify at 320px width.
- [ ] **The page body never scrolls vertically on content that fits, and this is verified by measuring the rendered box** — `document.documentElement.scrollHeight === window.innerHeight` at 1280×900 and 320×900 — not by looking at a screenshot, which hides vertical overflow below the fold. Any page pairing `UMain` with `UFooter` is the specific trap: `UMain`'s base height is the viewport minus the *header* only, so the page overflows by exactly the footer's height. Recorded in the Review Log on 2026-09-04 and fixed there inside `AuthShell`; `/` was the one screen not using that shell and still carried 49px of scroll on 2026-09-06. The height now comes from `AppShell` plus the central `main` override in `app.config.ts`, so it cannot be had per screen — but the measurement is still the check.
- [ ] **The content column's width *and* horizontal position come from the app shell, and are verified by measuring the rendered box** — `getBoundingClientRect()` on the column at 1280, 1024 and 768 in both themes, not by looking at a screenshot, which shows a plausible column and cannot show that the page beside it is empty. A screen names which of the shell's columns it stands in and states no width of its own. `max-w-*` caps a width and centres nothing: measured on 2026-09-07, the read, edit and navigation-tree screens each rendered 658.9px at x=32 in a 1280px viewport, so the right 589px of every product screen was unused, and all five screens had written their own container. This is the horizontal twin of the vertical rule above, and it failed the same way — a value that lives on one shell, spelled out per screen. `docs/DESIGN-SYSTEM.md` §2.4 names the three columns.
- [ ] **Tables scroll inside their own `overflow-x: auto` container** with a visible affordance that more content exists.
- [ ] **Code blocks scroll inside their own container** and do not wrap by default.
- [ ] **Diagrams scroll or scale inside their own container** and never overflow the document column.
- [ ] **The navigation tree behaves sanely at depth.** Deep nesting (Shelf → Book → Chapter → Page) does not produce runaway indentation or horizontal scroll on narrow viewports; long titles truncate with the full title available on hover/focus.
- [ ] **Panel widths are resizable where it matters** and the choice persists per user.
- [ ] **A pane a person can put away comes back on the same control and the same keys, and hiding it never hides what is waiting on them.** The sidebar and the comment overlay are toggleable (2026-09-15 review); the state persists beside the pane's width; the change is announced; and a hidden surface that holds something addressed to the person — a thread that names them — still says so, with a count on the control that brings it back.
- [ ] **No fixed-height containers that clip content** when the theme's font size or the user's browser zoom increases. Test at 200% zoom.
- [ ] **Sticky headers and toolbars do not obscure content** when navigating to an anchor. Anchored scroll accounts for sticky chrome height.

### Observable breakage — automatic fail if any is present

- [ ] No clipped text or controls.
- [ ] No overlapping elements.
- [ ] No distorted or stretched media/avatars (aspect ratio preserved).
- [ ] No inaccessible controls (off-screen, behind an overlay, zero-size).
- [ ] No inert interactions — every control that looks clickable does something.

---

## 7. E2E coverage expectations

**Runner: Playwright.**

### Minimum coverage per screen

- [ ] **One happy-path e2e** exercising the screen's single primary action from the Pre-build contract, end to end, against a real backend.
- [ ] **One permission-denied e2e** asserting the coherent denied state — not a crash, not an empty list. This app's permission model is its highest-risk surface; every screen that renders permission-scoped content needs this.
- [ ] **The read → edit → save round trip** for any screen that touches a document, asserting the saved content survives a reload.

### Additional coverage where applicable

- [ ] Empty state reachable and asserted.
- [ ] Recoverable error path: fail the request, assert the retry affordance, retry, assert success.
- [ ] Soft-lock path: second user opens the same page, both "Open read-only" and "Take over editing" are present and functional.
- [ ] AI panel: stream starts, stop control aborts it, partial output is retained and marked incomplete.
- [ ] Theme switch: primary flow completes in a second, contrasting theme.

### Rules

- [ ] **A screen is not "done" until its happy-path e2e passes.** Not written — passes, in CI.
- [ ] **Assertions target user-visible behavior and accessible roles/names** (`getByRole`, `getByLabelText`, `getByText`). CSS classes and internal test IDs are used only where no role or accessible name can express the target — and reaching for one is a signal the element is probably missing an accessible name, which is itself a section 5 failure.
- [ ] **No assertions on implementation details:** class names, DOM structure, internal state, or request counts.
- [ ] Tests are independent and can run in any order. No shared mutable fixture state between tests.
- [ ] Flaky tests are fixed or deleted, never retried into passing.

---

## 8. Definition of done for a screen

All boxes checked before the screen is presented for owner review. No partial submissions.

- [ ] Pre-build contract answered and recorded (section 2).
- [ ] All required states implemented and **demonstrable**: empty, first-run vs. filtered-empty, loading (skeleton), partial/streaming where applicable, recoverable error, fatal error, permission-denied, offline/stale, success, disabled (section 3).
- [ ] Uses Nuxt UI primitives; no hand-rolled equivalents; no arbitrary values fighting the scale (section 4.1).
- [ ] Zero hardcoded visual literals; verified in two contrasting themes including a dark one; screenshots attached (section 4.2).
- [ ] Verified with two different icon packs; no icon is the sole carrier of meaning; icon collections bundled for offline (section 4.3).
- [ ] Reading density respected: constrained measure, real hierarchy, chrome quieter than content (section 4.4).
- [ ] Domain rules for the surfaces this screen touches — read/edit mode, editor menus, block anchors, presence, AI panel — all checked (sections 4.5–4.9).
- [ ] **Full keyboard pass completed with the mouse unplugged.**
- [ ] Accessibility floor fully passed (section 5).
- [ ] Verified at 320px, 768px, 1280px, and at 200% browser zoom; no horizontal body scroll; no observable breakage (section 6).
- [ ] Happy-path e2e passes in CI; permission-denied e2e passes; read→edit→save round trip passes where applicable (section 7).
- [ ] Screen rendered and visually inspected at least once by the implementer before submission.
- [ ] Any new pattern introduced was added to the design system deliberately, not improvised inline.

---

## 9. Review Log

Append a new entry after every owner review. **Never delete an entry** — if a rule is superseded, add a new entry that says so and link back.

### Entry format

```markdown
### YYYY-MM-DD — <Screen or component name>

**Reviewer:** <name>
**Verdict:** Pass | Fail | Pass with follow-ups

**Findings** (max 3, ordered by user impact)

1. **<One-line defect statement>**
   - *Observable evidence:* what was seen in the running UI, with the viewport/theme/role it was seen under.
   - *Root cause:* why it happened, not just what happened.
   - *Correction applied:* the smallest concrete fix.
   - *Rule added:* the checklist item added or amended to prevent recurrence, with its section number. Write "None — one-off" if it does not generalise.
```

### Format example

> **This is a format example, not a real finding.** It exists to show the shape of an entry. Delete nothing; real entries go below it.

```markdown
### 2026-01-15 — Book settings panel

**Reviewer:** Eduardo
**Verdict:** Fail

**Findings**

1. **Panel renders a blank white card for members without `book:manage`.**
   - *Observable evidence:* Logged in as a Cell member with read-only access to "Platform" at 1440×900 in the dark theme; the settings panel opened with an empty card, no message, and a still-enabled Save button.
   - *Root cause:* The component fetched settings without checking the resolved permission, and rendered its shell before the (denied) response arrived. No permission-denied state existed.
   - *Correction applied:* Added a permission-denied state that names the missing permission and offers "Request access"; Save is disabled with a reason on hover.
   - *Rule added:* §3 "Permission-denied" — a denied user gets a coherent screen, never a half-rendered one. §7 — every permission-scoped screen needs a permission-denied e2e.

2. **Two hardcoded hex values in the panel header made the title invisible in the dark theme.**
   - *Observable evidence:* `#1f2937` on the header title and `#fff` on its container; in the dark theme the title rendered near-black on near-black.
   - *Root cause:* Component written and checked against the default light theme only.
   - *Correction applied:* Replaced both with theme tokens.
   - *Rule added:* §4.2 — zero hardcoded visual literals; grep for `#`, `rgb(`, `hsl(` before review; verify in two contrasting themes.
```

### Entries

### 2026-09-04 — Authentication screens (sign-in, password reset, invitation accept)

**Reviewer:** Eduardo
**Verdict:** Pass with follow-ups

**Findings** (ordered by user impact)

1. **Every auth page carried permanent vertical scroll, pushing the footer below the fold.**
   - *Observable evidence:* spotted as a stray horizontal rule at the bottom edge of the sign-in
     screen. Measured: at 1280x900 `body.scrollHeight` 949 against `innerHeight` 900; at 320x900,
     1021 against 900. The rule was the footer's top border peeking above the fold.
   - *Root cause:* Nuxt UI's `UMain` carries `min-h-[calc(100vh-var(--ui-header-height))]`, which
     subtracts the header and never the footer. Any page pairing the two overflows by exactly the
     footer's height. No existing test measured rendered geometry, so the suite stayed green.
   - *Correction applied:* `AuthShell` is `min-h-svh flex flex-col` with `flex-1` on the main
     region. `e2e/auth-layout.spec.ts` (10 tests) now asserts `scrollHeight === innerHeight` and
     no horizontal overflow on all four pages at both viewports.
   - *Rule added:* §6 — a layout that pairs `UMain` with `UFooter` must be verified by measuring
     the rendered box, not by looking at it. Screenshots hide vertical overflow.

2. **The dark theme rendered surface containers as near-black, and the primary button read washed out.**
   - *Observable evidence:* the card measured **1.14:1** against the page ground in dark theme and
     read as a hole punched in the page. App ground against header measured 1.04:1.
   - *Root cause:* an M3 *tone* is a CIE L\*, not an oklch lightness. The token block wrote
     `oklch(<tone>%)`, which is close above tone 90 and badly wrong below tone 25 — tone 4 landed
     at L\* 0.4, effectively pure black. Separately, two neutral rungs were tonally adjacent.
   - *Correction applied:* all tones recomputed from the exact transform; card now 1.48:1. The
     three dark container rungs each moved up one M3 tone. Dark `--ui-primary` moved from tone 80
     to tone 70 — at tone 80 the palette was already at the sRGB gamut ceiling for that hue
     (max chroma 0.0793, in use 0.078), so the button could not be made less washed out without
     changing tone. Now 6.35:1 against its label.
   - *Rule added:* §4.2 — never write an M3 tone as an oklch percentage; convert it. The formula
     and this failure are recorded in `docs/DESIGN-SYSTEM.md` §11 and its §14 change log.

3. **Redundant eyebrow, and required-field asterisks that carried no information.**
   - *Observable evidence:* the eyebrow read "Sign in" above an `h1` reading "Sign in to
     deep-wiki". Both fields on the form were required and both were asterisked.
   - *Root cause:* the shell provided an eyebrow slot and every screen filled it because it was
     there. The asterisks came from `UFormField`'s `required` prop.
   - *Correction applied:* eyebrow removed from the shell and all four screens; each form states
     "All fields are required" once.
   - *Rule added:* §4.4 — an eyebrow must add context the heading does not; repeating the heading
     spends hierarchy for nothing. Mark the exception, not the rule, on required fields.

**Follow-ups carried forward, not fixed**

- `UFormField`'s `required` prop renders only a glyph: `UAuthForm`'s `omitFieldProps` strips it
  before it reaches the input, so `required` and `aria-required` are absent. This predates the
  review. Recorded in `docs/TODO.md` Findings; any future form must set the attribute itself and
  test it.
- The mobile footer stacking order was fixed with CSS `order`, so at narrow widths a screen reader
  reads the two static paragraphs in the opposite order to how they appear.
- The two-icon-pack requirement (§4.3) remains untested — only `lucide` is installed.
- Contrast was measured on the specific pairs named above, not audited exhaustively across every
  component.

---

### 2026-09-06 — Cross-screen consistency audit (`/`, `/login`, `/forgot-password`, `/reset-password`, `/invite/accept`)

**Reviewer:** Eduardo
**Verdict:** Pass with follow-ups

This audit compared the screens **to each other** rather than each one to this
checklist. Computed styles were extracted from the running app at 1280×900 in
both themes and tabulated per component class. Findings are the values that
differed between screens; a value that differs is a finding even where both
sides are defensible in isolation. The four auth screens measured identical to
each other on every value taken. Every divergence found was on `/`, which was
styled before both the shape ruling (§3.4) and the rhythm ruling (§7.4) landed.

**Findings** (max 3, ordered by user impact)

1. **`/` carried 49px of permanent vertical scroll; the auth screens fit exactly.**
   - *Observable evidence:* at 1280×900 in both themes, `/` measured
     `scrollHeight` 949 against `innerHeight` 900 — the overflow is exactly the
     49px footer, on a page whose content ends 150px above the fold. All four
     auth screens measured 900 against 900.
   - *Root cause:* this is the identical defect found on 2026-09-04 (finding 1,
     above). It was fixed *inside `AuthShell`*, so it was fixed for the four
     screens that use the shell and for no others. `/` renders its own header,
     `UMain` and footer, and `UMain`'s base is
     `min-h-[calc(100vh-var(--ui-header-height))]` — viewport minus the header,
     with no allowance for a footer. The rule the last review recorded ("verify
     by measuring the rendered box") went into the Review Log and never into §6,
     so nothing carried it forward. `e2e/auth-layout.spec.ts` asserts exactly
     this and enumerates only the four auth paths.
   - *Correction applied:* the fix moved out of the shell. `AppShell.vue` owns
     the `min-h-svh` column, the header and the footer, and every route renders
     inside it; `app.config.ts` replaces `main.base` with `flex min-h-0 flex-1
     flex-col` centrally, so no screen can reintroduce the calculation.
     Re-measured: `/` is now 900/900 in both themes.
   - *Rule added:* §6 — the vertical-overflow measurement, with the `UMain` +
     `UFooter` trap named. §4.1 — anything appearing on more than one screen is
     one component, not one copy per screen.

2. **The two screens disagreed about what a container is: `/`'s panels sat on the same tonal rung as the header and footer.**
   - *Observable evidence:* `/`'s two panels were hand-rolled
     `div.rounded-lg.bg-elevated.ring.ring-default.p-4.sm:p-6` and measured
     `oklch(0.94828…)` light / `oklch(0.28448…)` dark — byte-identical to the
     measured header and footer background on the same screen. The auth card is
     `UCard variant="soft"` and measured `oklch(0.91379…)` / `oklch(0.34483…)`.
     Same radius (16px) and same padding (24px), one rung apart in tone, and
     one of the two carried a ring the other did not.
   - *Root cause:* `/` predates §9.4's ruling and built its container by hand
     instead of reaching for `UCard`, so the tone was chosen rather than read.
     `bg-elevated` is the *chrome* rung (§1.4 gives it to the nav pane, the
     contextual panel and the top app bar) — which is why the panels read as
     chrome rather than as content, most visibly in dark.
   - *Correction applied:* both panels are now `UCard variant="soft" as="section"`,
     the same component and tone as the auth card. The status block inside was
     `bg-emphasized` — identical to the card it would now sit on, and already
     identical to the idle status chip inside it — and moved down to `bg-default`,
     the recessed rung the auth screens' input fields already use inside that
     same card tone.
   - *Rule added:* §4.1 — compare against the nearest existing screen before
     building. `docs/DESIGN-SYSTEM.md` §9.4 now states which card a container
     sitting directly on the app ground gets, which is the question `/` answered
     differently.

3. **The page heading block was set three ways at once on `/`, none of them the auth screens'.**
   - *Observable evidence:* heading block → container below measured **40px** on
     `/` against **32px** on all four auth screens (§7.4 rules 32px); the
     supporting sentence was `doc-body` 16px/**26px** with a **16px** gap under
     the `h1` against `body-large` 16px/**24px** and **12px**; and `/` carried
     an eyebrow, "Phase 0 · Bootstrap", above an `h1` reading "Bootstrap smoke
     page". The `h1` itself measured 28px/400 on every screen — that one had not
     drifted.
   - *Root cause:* the heading block existed twice in markup, so §7.4's 32px
     landed on the copy inside `AuthShell` and not on the copy inside `/`. The
     eyebrow rule from the 2026-09-04 review was recorded in the Review Log and
     never added to §4.4, so it bound nothing.
   - *Correction applied:* `PageHeading.vue` now owns the eyebrow, the `h1`, the
     supporting sentence and all three distances; both `AuthShell` and `/` use
     it. `/`'s eyebrow is "Phase 0" — the part that was not already in the
     heading. Re-measured: 8 / 12 / 32px on every screen, in both themes.
   - *Rule added:* §4.4 — the eyebrow rule, and a page description is `body-large`
     chrome, not `doc-body` prose.

**Checked and found already consistent — no action**

- Primary action geometry: 40px tall, 12px radius, 14px label, `px-2.5 py-1.5`,
  identical on all five screens in both themes.
- Text fields: 56px tall, 12px radius, 16px text, 16px inset; label→field 8px,
  field→field 24px, last field→submit 24px. Identical on all four auth screens.
- Focus ring: 3px solid `secondary` at 2px offset on every control on every
  screen in both themes. An earlier reading that showed inputs at
  `primary/25` was a sampling artefact — the input's `transition-colors`
  animates `outline-color`, and the sample was taken mid-transition. Measured
  again after the transition settles, it is uniform.
- `h1`: 28px/36px/400 everywhere.
- Horizontal overflow at 320px: none on any screen.

**Follow-ups carried forward, not fixed**

- `e2e/auth-layout.spec.ts` still enumerates only the four auth paths. Its
  measurement is what would have caught finding 1 on `/`; `/` should be added to
  its `AUTH_PAGES` list (or the file renamed to cover the app chrome). Not done
  here — `e2e/**` is outside this audit's owned paths.
- `/`'s heading column keeps `max-w-measure` while the auth screens use
  `max-w-md`. Deliberate: one is a reading column, the other a form column.
- `/` top-aligns its content while the auth screens centre theirs with
  `my-auto`. Deliberate: a form is centred in the space it has; a content page
  starts at the top.
- Three `apps/web` composable suites (`useApiHealth`, `useAcceptInvitation`,
  `usePasswordResetRequest`) fail on this host with `setupNuxt` exceeding the
  60s hook timeout under concurrent load. Environmental, unrelated to these
  files; the five page suites (27 tests) pass.

---

### 2026-09-07 — Phase 2 product screens (read, edit, navigation tree) against the five existing screens

**Reviewer:** Eduardo
**Verdict:** Pass with follow-ups

The three new screens were compared **to the five that already existed** rather than
each to this checklist on its own. Computed styles were extracted from the running
app at 1280×900 in both themes, for eight screens plus four extra states (locked,
refused, permission-denied, empty), and tabulated per component class; a value that
differed between two screens is a finding even where both sides are defensible
alone. Chrome measured identical everywhere before and after — header 56px, footer
49px, `oklch(0.94828)` light / `oklch(0.28448)` dark — and no screen carried
vertical overflow at 1280×900 or horizontal overflow at 320px, in either theme.

**Findings** (max 3, ordered by user impact)

1. **The navigation tree could not be used without a mouse, and a click on a row did nothing at all.**
   - *Observable evidence:* at 1280×900 in both themes, tabbing through
     `/workspaces/:id/tree` produced exactly two stops — the brand mark and the
     theme toggle — and then left the page. Every row measured `tabindex: null`,
     `role: null` on the element carrying the label, `isLink: false`, and
     `cursor: grab`; clicking one changed nothing. The screen's own pre-build
     contract says its user is there to "find a page", and there was no way to
     open one by keyboard or by mouse. Reordering existed only as a drag.
   - *Root cause:* `NavigationTreeNode` is a deliberate hand-rolled exception to
     §4.1, taken because `UTree` cannot drag-reorder. The exception was scoped to
     the *drawing* and silently took the *behaviour* with it: `UTree`'s roving
     tabindex, arrow-key navigation, activation and `aria-*` wiring were all
     forfeited along with the one feature it lacks. Nothing in §4.1 said that a
     hand-rolled primitive still owes the contract the library one brings, so the
     trade read as sanctioned.
   - *Correction applied:* the tree is now one tab stop with a roving tabindex;
     arrows move between rows, `Home`/`End` jump to the ends, `ArrowLeft`/`Right`
     walk to parent and first child, `Enter`/`Space` opens a page, and `Alt` with
     the arrow keys is the keyboard equivalent of the three drop zones — stated on
     the screen, not only in a comment. Rows carry `aria-level`, `aria-posinset`,
     `aria-setsize` and `aria-expanded`, the icon's meaning is also given in text,
     and the focus ring is relocated from the `treeitem` (which contains its whole
     subtree) to the row, at the same width and role. Three tests in
     `tree.test.ts` now hold it. Re-measured: the tab order is brand → toggle →
     tree.
   - *Rule added:* §4.1 — a hand-rolled replacement for a library primitive owes
     the keyboard and ARIA contract that primitive would have brought, enumerated
     before it is written. §5 — every pointer-only manipulation has a stated
     keyboard equivalent, and an unavailable control that carries an explanation
     uses `aria-disabled` rather than the attribute that removes it from the tab
     order.

2. **Every container on the three new screens sat on the chrome's tonal rung, measuring byte-identical to the header above it.**
   - *Observable evidence:* the permission-denied, not-found, locked, empty and
     network-error panels, and the tree's own list, were all hand-rolled
     `div.flex.items-start.gap-3.rounded-lg.bg-elevated.p-6` and measured
     `oklch(0.94828 0.002 262)` light / `oklch(0.28448 0.004 262)` dark — the same
     values measured on the header and footer of the same screen. The auth card,
     the nearest existing container, measured `oklch(0.91379)` / `oklch(0.34483)`,
     one rung up. Same object, same radius, same padding, two tones on two screens.
     The `<h1>` inside them measured 24px against 28px on the same screens' loaded
     state, so the type scale reported how the request had gone; and they spanned
     1216px while the document beside them held 659px.
   - *Root cause:* the containers were built by hand, so the tone was chosen by
     eye rather than read from a ruling. `docs/DESIGN-SYSTEM.md` §9.4 ruled only on
     a card *inside a pane*, and none of these screens has a pane — the case that
     actually occurs had no rule. §1.4's row naming "navigation tree" as
     `bg-elevated` is about the tree as a pane, and was read as licence for the
     tree rendered as a column.
   - *Correction applied:* one `PageNotice.vue` replaces all eight copies — a
     `UCard variant="soft"`, the same component and tone as the auth card, with the
     heading *element* chosen by `level` and its *size* following §2.3 from that
     level, so an `h1` is `headline-medium` in every state. The tree's list moved
     into the same card. Both new columns are `max-w-measure` at the column, not
     per branch. Re-measured: every content container on all eight screens is
     `oklch(0.91379)` / `oklch(0.34483)`, the two deliberate exceptions being the
     editor body at `bg-default` (§1.4's document canvas) and the error panels at
     `error-container` (an accent role, not a surface rung).
   - *Rule added:* §4.1 — anything on more than one screen is one component; and
     compare against the nearest existing screen before building. §4.4 — a
     screen's `<h1>` keeps one type role across every state. `docs/DESIGN-SYSTEM.md`
     §9.4 now states which card a container on the app ground gets, and that
     `bg-elevated` is never it.

3. **Hover was painted by stepping to another surface rung, which was invisible on the tree and reversed direction between themes in the editor menus.**
   - *Observable evidence:* a tree row's `hover:bg-elevated` resolved to
     `oklch(0.94828)` in light over a container already at `oklch(0.94828)`, and
     `oklch(0.28448)` over `oklch(0.28448)` in dark — the same tone painted over
     itself, in both themes. The mention and slash menu rows carried the same class
     over `bg-accented`: measured `oklch(0.93103)` → `oklch(0.94828)` in light
     (lighter) and `oklch(0.32759)` → `oklch(0.28448)` in dark (darker). Those two
     menus were also the only 16px menus in the app, beside `UDropdownMenu` at
     12px, and a focused editor carried two focus indicators at once — the global
     3px `secondary` outline plus a 2px `primary` ring of its own.
   - *Root cause:* §5.2 supplied the state-layer mechanism and M3's opacities but
     never said in one line that a surface rung is not a state, so reaching for
     `hover:bg-*` passed a reading of the section that produced it. The 16px menus
     came from §3.4 listing "menus" under Controls without saying the row binds a
     menu the project draws itself.
   - *Correction applied:* both the tree rows and both menus use `dw-state-layer` —
     M3's `currentColor` overlay at 0.08/0.12 — so hover moves away from whatever
     ground it is on, identically in both themes; the opaque
     `secondary-container` fill is kept for the genuinely selected row, so selected
     and hovered stay unmistakably different. Menus moved to `rounded-md`. The
     editor's own ring was removed in favour of the one global indicator, and the
     menus gained `aria-activedescendant` so the arrow keys are announced.
   - *Rule added:* `docs/DESIGN-SYSTEM.md` §5.2 — a new subsection, "a state is a
     layer, never a step to another surface rung", with both measured failure
     modes. §3.4 — the Controls row's "menus" binds project-authored menus.

**Checked and found already correct — no action**

- **Read mode never boots the editor.** `scripts/checks/bundle-isolation.ts` and
  `bundle-isolation-build.ts` both exit 0, and the read route's built chunk closure
  was walked directly: 11 nodes, zero matching `prosemirror|milkdown|tiptap`, with
  `packages/editor/src/mount/index.ts` reachable only through the edit route's
  `dynamicImports`. Driving the real screen, 895 requests were made and none was
  editor-shaped.
- **The soft lock reads as a soft lock.** "Open read-only" and "Take over editing"
  render simultaneously, both at 40px, and "Take over" states its consequence for
  the other person before the confirm dialog (§4.8).
- **The refused state names the construct and the line** ("Found *a setext heading*
  on line 42") and offers both exits.
- **Both editor menus are keyboard-first:** Escape dismisses and returns focus to
  the editor at the cursor; neither fires inside a code block (verified by placing
  the caret in a `<pre>` and typing `@`); the mention menu has a distinct
  empty-query state ("Type to search people and pages…") and a no-results state
  ("No matches"), and the slash menu shows its full command list on an empty query
  and "No matching commands" on a miss.
- **The tree's empty state names the object in the product's vocabulary** — "No
  shelves yet" / "Create a shelf to start organising books, chapters and pages".
- **Wiki-links are inert, and an unreadable target is indistinguishable from a
  nonexistent one.** `render()` emits `[[Target]]` as literal text with no anchor,
  class or attribute, so the two are byte-identical by construction. This holds
  *because* nothing hyperlinks them yet; `docs/SPECS.md` §14 and `docs/TODO.md`
  already record that closing that gap has to preserve the property, and it is the
  one item here that a later batch can silently break.
- Text fields: 56px tall, 12px radius, 16px text, 16px inset, identical on all four
  auth screens. Container padding 64/64/32 on all eight screens.

**Follow-ups carried forward, not fixed**

- `e2e/auth-layout.spec.ts` still enumerates only the four auth paths. Its
  measurement is what catches the `UMain` + `UFooter` trap, and the three new
  screens are not in its list. Not done here — `e2e/**` is outside this review's
  owned paths.
- The tree renders unvirtualized. §6's "a book with 400 pages" is unmet; `UTree`'s
  `virtualize` is the intended answer and is blocked on the same drag-reorder gap
  that produced the hand-rolled node.
- The three-pane shell of §6 does not exist yet: all three screens are a single
  centred column, so the medium/narrow pane rules could not be exercised beyond
  measuring that nothing overflows.
- The two-icon-pack requirement (§4.3) remains untested — only `lucide` is
  installed. Unchanged since 2026-09-04.
- Contrast was not re-audited exhaustively; the tones in use here are the ones
  measured on 2026-09-04, and no new colour pair was introduced.

---

### 2026-09-07 — The content column, and the screen a bad URL lands on

**Reviewer:** Eduardo
**Verdict:** Pass with follow-ups

Both findings came out of the same screenshots: one about what every screen
does with a wide viewport, one about what the product does with an address
that does not resolve. Geometry was measured with `getBoundingClientRect()`
on the running app at 1280, 1024, 768 and 320, in both themes, for seven
screens; the reading measure was counted from real laid-out text rather
than from the token, by splitting each paragraph where its line boxes
change. Before and after are the same instrumentation on the same seeded
content.

**Findings** (max 3, ordered by user impact)

1. **Every screen put its content against the left edge, leaving the right half of a wide viewport empty.**
   - *Observable evidence:* at 1280×900 in both themes, the read, edit and
     navigation-tree columns each measured **658.9px wide at x=32** — 589px
     of unused page beside them. The same three at 1024 measured 658.9px at
     x=32 (334px unused) and at 768, 658.9px at x=24 (85px unused). The
     auth screens, alone, were centred: 448px at x=416. So the product
     centred its narrowest screen and left-aligned the three a user spends
     their day in.
   - *Root cause:* `AppShell` owned the height and not the width. It
     rendered `<UMain><slot /></UMain>` — no container, no max width, no
     centring — so all five screens wrote their own `UContainer`, their own
     column `div` and their own `py-10 sm:py-16`. Each then applied
     `max-w-measure`, which is what `docs/DESIGN-SYSTEM.md` §2.4 asks for
     and which sets a maximum width and no horizontal position at all.
     §8.3's "Don't" list four sections later does say "then centre"; nobody
     implementing §2.4 read that far. The five copies had already drifted in
     the way §4.1 predicts: two centred, three not, and the smoke page
     capped for its heading and uncapped for the grid under it.
   - *Correction applied:* the column moved into `AppShell` beside the
     height, as three named kinds a screen chooses between — `measure`
     (72ch, `mx-auto`), `narrow` (`max-w-md`, the auth card) and `wide`
     (`--ui-container`, a grid of panels). Read, edit, the tree and the new
     error screen take `measure`; the choice is stated per screen and its
     meaning exists once. `PageHeading` now caps its own block at
     `max-w-measure` so prose stays measured even on the `wide` column.
     Re-measured: 658.9px at **x=310.5** at 1280, x=182.5 at 1024, x=54.5 at
     768, and 288px at x=16 at 320 — centred at every width, in both
     themes, with the auth screens unmoved at 448px/x=416 and the smoke
     page's grid still 1216px with its heading capped at 658.9px. The
     reading measure holds a median of 77 characters (76–82) at 1280, 1024
     and 768. No horizontal overflow at 320 anywhere; no vertical overflow
     introduced on a page that fits. Read and edit mode now share the
     column exactly — `<h1>` and document surface both 658.9px at x=310.5 —
     though not yet the last 16px of it; see the follow-ups.
   - *Rule added:* §6 — the content column's width *and* horizontal position
     come from the app shell, verified by measuring the rendered box; a
     screen names its column and states no width. §4.4 — count the measure
     in the browser on real content, because 72ch is a prediction about a
     font the theme may change. `docs/DESIGN-SYSTEM.md` §2.4 gains "a
     measure is a cap, not a position", the three-column table, and the
     reasoning for edit mode and the tree sharing the reading measure;
     recorded in its §14.

2. **A bad URL left the product: no error screen existed, so Nuxt's default one answered for it.**
   - *Observable evidence:* `/this/route/does/not/exist` at 1280×900
     rendered the framework's error page — no header, no footer, no theme,
     no type scale, a stack trace in development. Probed for the shell's
     landmarks it had none: `document.querySelector('main')` was `null` in
     both themes at all four widths. There was no `error.vue` and no
     catch-all route.
   - *Root cause:* nothing in this checklist asked for one. §3 enumerates
     the states *of a screen*, and a 404 is the absence of a screen rather
     than a state of one, so it fell between the sections — the same shape
     of gap as §9.4's "a card inside a pane" ruling that said nothing about
     the case every screen actually had.
   - *Correction applied:* `apps/web/app/error.vue`, built on `AppShell` and
     `PageNotice` like every other screen, with two distinct states because
     the next action differs: **not found** (neutral card, one action) and
     **the server failed** (`error-container`, `role="alert"`, "Try again",
     and `Reference: HTTP <code>` set beside the message for a bug report,
     never instead of it). The 404's action comes out of the address the
     user typed — a workspace in the URL offers that workspace's tree, a
     page offers that page, and otherwise sign-in, since this product has
     no public pages. Verified in the built app: all three navigate, and the
     tab order is brand → theme toggle → the action.
   - *Rule added:* §3 — route-level failure has a screen, it is one screen,
     it uses the product's shell, and it distinguishes not-found from a
     server failure.

**Checked and found already correct — no action**

- **The 404 cannot become a disclosure channel.** `apps/api/src/routes/
  pages.ts` looks a node up before calling `can()` and therefore returns a
  real 403 for a page that exists and is denied — deliberate for a direct
  URL request, and recorded in `usePageRead`'s own note. The new screen is
  built so that a *different* surface can choose otherwise: the not-found
  branch is selected by status code alone and no field of the error object
  reaches the DOM, so `createError({ statusCode: 404, message: 'forbidden' })`
  renders byte-identically to a plain 404. Two tests hold it, and the copy
  says out loud that the ambiguity is deliberate so a reader is not misled
  into believing a page they cannot see was deleted.
- **Nothing regressed that the last two reviews fixed.** GATE-2 green; both
  bundle-isolation layers exit 0 against a fresh production build, so read
  mode still never reaches ProseMirror; the tree's roving tabindex and
  `Alt`-arrow reorder are untouched; and the `min-h-svh` column plus the
  central `main` override still hold, measured at
  `scrollHeight === innerHeight` on every screen whose content fits.
- Chrome measured identical to the previous review — header 56px, footer
  49px — and the auth screens' geometry is unchanged to the pixel.

**Follow-ups carried forward, not fixed**

- ~~**Read and edit now share the column but not the last 16px.**~~ **Closed 2026-09-15.**
  Measured at 1280×900: the `<h1>` and the document surface are identical in both modes
  (658.9px at x=310.5), but a paragraph is 658.9px at x=310.5 in read mode
  and **626.9px at x=326.5** in edit — the editor's canvas carries `p-4`
  (§1.4 gives it `bg-default` as the document canvas) while read mode's
  prose sits directly on the app ground with no canvas at all. So the text
  still steps 16px sideways when the mode changes. Two fixes exist and both
  are a change to a surface the owner reviewed and passed on 2026-09-07:
  drop the editor's inset, or give read mode the same `bg-default` canvas —
  which is arguably what §1.4 already says, since it names the document
  canvas and the editor body as one rung. That is a design-system ruling to
  be made once and deliberately (§1's standing rule), not improvised inside
  this batch, so it is recorded rather than taken.
  **Resolution:** edit mode's move onto the workspace frame (`b5a7f55`, 2026-09-15) puts both
  modes on the frame's own `bg-default` pane, which settled the ruling in the second
  direction — read mode's canvas, not the editor's inset, is what the pane now supplies.
  Measured in `e2e/editor.spec.ts`: title and first paragraph identical in x, width and y
  across the two modes, both themes, at 1280×900. See this file's Review Log, 2026-09-15, and
  `docs/DESIGN-SYSTEM.md` §14.
- No test asserts the column geometry. Both findings above were caught by
  measuring the running app, and the suite would be green with the column
  back against the left edge. `e2e/auth-layout.spec.ts` is the right home
  and still enumerates only the four auth paths — unchanged since
  2026-09-04, and now three screens plus the error screen behind it.
- The server-error state has no e2e: reaching it needs a route that fails,
  which this batch produced with a temporary probe page and then removed.
- The three-pane shell of §6 still does not exist; every screen is one
  centred column, so the medium/narrow pane rules remain unexercised.
- The two-icon-pack requirement (§4.3) remains untested — only `lucide` is
  installed. Unchanged since 2026-09-04.
- No new colour pair was introduced, so contrast was not re-audited; the
  error screen reuses `error-container`/`on-error-container`, already in use
  on the refused and network-error notices.

---

### 2026-09-14 — Shipped since the last review, un-reviewed: ten surfaces waiting on the owner's gates

**Reviewer:** none yet — this entry is the backlog, not a review. It exists because §1 says
no screen is done until the owner reviews it and work does not continue on top of an
unreviewed screen, and the log's last entry was 2026-09-07 while all of the below landed
between 2026-09-08 and 2026-09-14.
**Verdict:** Pending — six gates open

**The gates are the owner's.** `openspec/changes/versioning-and-collaboration/tasks.md`
places one STOP per surface — **10.2** page history, **10.4** page diff, **10.6** book
changeset history and diff, **10.8** comment gutter and thread panel, **10.10** orphaned-
comment surface, **10.12** presence indicators — and every one is still `[ ]`. Nothing here
was reviewed by the owner against this checklist or `docs/DESIGN-SYSTEM.md`; the audits
named below were an agent's cross-screen pass and are inputs to the review, not a
substitute for it.

**What shipped, in commit order, with where it lives:**

1. **Page history** — `apps/web/app/pages/pages/[id]/history.vue` over
   `GET /pages/:id/history`. Gate 10.2. Added the timestamp rule §4.11 (2026-09-08) after
   shipping with a decision this file had no rule for.
2. **Page diff** — `pages/pages/[id]/diff.vue` over `GET /pages/:id/diff?from=&to=`;
   added / removed / modified / moved treated distinctly (§4.7). Gate 10.4. The audit read
   it as "a highlighter pass over source, not a document" and laid out directions (a)–(c);
   (b) shipped in part, (a) and (c) are in `docs/TODO.md` Open Questions for the owner.
3. **Book changeset history** — `pages/books/[id]/history.vue`. Gate 10.6.
4. **Book diff** — `pages/books/[id]/diff.vue`, navigable between changed pages without
   returning to the list (§4.7). Gate 10.6. Page order is the database's, not a declared
   one (`docs/TODO.md` Findings 2026-09-14).
5. **Comment gutter and thread panel on the read screen** — `pages/pages/[id]/index.vue`,
   `CommentGutter`/`CommentThreadPanel`/`CommentThreadItem`, composed over unchanged cached
   HTML; reply and resolve; indicator absent for `read`-only (e2e against a real backend,
   `e2e/comments.spec.ts`). Gate 10.8. **No affordance to start a new thread** — recorded as
   out of scope in the screen's own contract and in `docs/TODO.md`.
6. **Orphaned and unplaced comment surface** — first-class states on the same screen: an
   orphaned thread is shown, never dropped; a thread whose block the cached HTML does not
   yet name ("no anchors known", pre-backfill) is counted in a chip. Gate 10.10.
7. **Presence indicators** on read and edit — `PresenceIndicator.vue` over
   `usePresenceStream.ts`: who, since when, never a hard lock (§4.8). Gate 10.12.
8. **New workspace** — `pages/workspaces/new.vue` and the way to it from the list. No gate
   in the Phase 3 change; owner review still owed under §1.
9. **Members and invitations** — `pages/workspaces/[workspaceId]/members.vue`, reached from
   the tree by a link that renders for every caller (no `manage` signal reaches the client;
   `docs/TODO.md` Open Questions). Review owed.
10. **Instance registration** — `pages/admin/registration.vue` for the Super Root, reached
    from the app chrome by a link that renders for every caller for the same reason.
    Review owed.

**Cross-cutting changes in the same window that touch every screen above and the five
already-reviewed ones**, each to be looked at once rather than per screen:

- Every tonal control gained a 1px inset accent ring (`DESIGN-SYSTEM.md` §9.1/§9.7
  deviation, §14) after `soft` measured 1.00–1.09:1 on containers.
- Notices consolidated to three tiers in `InlineNotice.vue` (§14).
- The tree's selection made visible, container rows folded, the workspace skeleton put in
  the loaded box (`4b2fcd3`); the read and history skeletons occupy the loaded box
  (`347a0c5`) — but the tree skeleton still omits the toolbar row (`docs/TODO.md` Findings
  2026-09-14).
- Auth results take focus and are announced; links meet the 24px target (`9a44460`).
- The app bar now carries four controls beside the brand on the read screen; the 320px
  measurement in that screen's comment covers three and predates the fourth.

**Known-but-unreviewed items carried from earlier entries, unchanged:** the mention menu's
ARIA ownership (Open Questions), the two-icon-pack requirement (§4.3), the three-pane shell
(§6), no e2e for the server-error state.

---

### 2026-09-15 — The workspace frame: sidebar, contextual bar, dashboard — awaiting the owner's review

**Reviewer:** none yet — this entry is what was shipped for review, not a review.
**Verdict:** Pending

Built from the owner's rejection of the tree screen (`docs/TODO.md` Findings, 2026-09-15)
and `apps/web/PRODUCT.md`'s three answers: one workspace at a time, "what changed and who is
here" first, a mixed team. `AppShell` gained the workspace frame; `pages/workspaces/[workspaceId]/index.vue`
is the dashboard; `pages/pages/[id]/index.vue` renders inside the frame; `tree.vue` is gone.
Measured, in `e2e/frame.spec.ts`, at 1280×900 in both themes and at 320×900: a 280px
sidebar at x=0; the dashboard's changes list beside a side column at ≥ 1.8× its width; the
read article at its 72ch measure, centred in the content pane to within 2px; no body scroll
in either axis; below `lg` a focus-trapped drawer that closes on Escape. Screenshots
`frame-*.png` in the session scratchpad. Every other screen renders inside the frame
unchanged in its own layout, which is the next batch after this review.

Known before review, not fixed: the sidebar is rebuilt per route (no layout yet); the
two-icon-pack requirement (§4.3) is still untested; §6's contextual (third) pane — comments,
AI, presence — is still an overlay.

---

### 2026-09-15 — The workspace frame: owner review, and the batch that answered it

**Reviewer:** Eduardo
**Verdict:** Pass with follow-ups

The owner's words: "ha mejorado mucho la UI y UX… más profesional." Two requests came with
the pass; both shipped in the following batch, together with the structural debt the frame's
own entry above flagged (the sidebar rebuilt per route). Measured in `e2e/frame.spec.ts` and
`e2e/read.spec.ts` at 1280×900 in both themes and at 320×900; screenshots `frame2-*.png` in
the session scratchpad.

**Findings** (ordered by user impact)

1. **"Que se pueda hacer toggle de la sidebar para poder tener una interacción más limpia con el documento."**
   - *Observable evidence:* the sidebar was always present from `lg` up; a person reading a
     long page had 280px of tree beside it with no way to put it away.
   - *Root cause:* the frame shipped `UDashboardSidebar` resizable but not collapsible, and no
     control in the contextual bar addressed the sidebar at all above `lg`.
   - *Correction applied:* focus mode. `SidebarToggle` at the sidebar's edge of the bar —
     accessible name and tooltip (§4.3), a live region announcing the change and naming the
     keys (§5), `Ctrl`/`⌘`+`\` — hides the sidebar **to nothing**, not to a rail, and the
     article's 72ch measure re-centres in the whole pane. Persisted in the same cookie as the
     width. Measured: the content bar at x=0, the article unchanged in width and centred to
     within 2px of the viewport, still hidden after a reload, back on the keys; focus that
     was in the sidebar lands on the content bar. Below `lg` the drawer is unchanged.
   - *Rule added:* §6 — a pane a person can put away comes back on the same control and the
     same keys, its state persists with its width, and hiding it never hides what is waiting
     on the person.

2. **"Los comentarios sobre el documento… también debería ser posible togglearlos."**
   - *Observable evidence:* the gutter marks appeared beside every commented block whenever
     the caller could comment, with no way to read the page without them.
   - *Root cause:* the overlay had a permission gate and no preference.
   - *Correction applied:* a toggle in the same bar, persisted per browser (`dw-comments`),
     offered only to a caller with threads to hide. It hides the marks, the panel and the
     "not placed yet" chip; the orphan chip stays. **It changes nothing about what is fetched
     or what a read-only caller sees** — `e2e/read.spec.ts` drives a reader with both cookie
     values and finds no toggle and no marks either way. While hidden, the toggle carries the
     count of open threads that mention the caller, in its name and as a badge, so "hidden"
     never means "unaware" (§3's honesty rule applied to a preference).
   - *Rule added:* §6, the same line as above — a hidden surface still says what waits on
     the person.

3. **The sidebar was rebuilt on every navigation** (the frame's own entry, above).
   - *Observable evidence:* tree scroll position reset on every click; a resize mid-navigation
     was lost.
   - *Root cause:* every route mounted its own `AppShell`.
   - *Correction applied:* `layouts/workspace.vue` mounts the frame once; the dashboard and
     the read page opt in. Measured: after a click on a tree row the sidebar is the same DOM
     node and the tree keeps its scroll offset and a fold. `/` now opens onto the last
     workspace the person was in, from a cookie, decided on the server.
   - *Rule added:* None — one-off, though the remaining screens must opt in before the
     per-route frame in `AppShell` can go.

**Follow-ups carried forward, not fixed**

- Edit, history, diff, members, book history and book diff have not opted into the layout.
- A user with no display name renders as "Someone"; display name should be required at
  registration (`docs/TODO.md`, Findings). An API and registration-screen change.
- The contextual (third) pane is still an overlay.
- The sidebar's resize handle is pointer-only (§5); the mention count is capped by the
  activity endpoint's twenty threads; below `sm` the breadcrumb shows only the last crumb.
- The two-icon-pack requirement (§4.3) remains untested.

---

### 2026-09-15 — Members, the workspaces chooser, book history and diff, edit mode, and page history and diff onto the frame — awaiting the owner's eye

**Reviewer:** none yet — this entry is what was shipped for review, not a review.
**Verdict:** Pending

The follow-up above ("Edit, history, diff, members, book history and book diff have not
opted into the layout") is closed: all six are now inside `layouts/workspace.vue`, each its
own commit (`8fe04ef`, `84337d3`, `8a5673d`/`25c23ba`, `b5a7f55`, `613e274`; full detail in
`docs/TODO.md` Findings, 2026-09-15). Measured at 1280×900 in both themes and at 320×900 in
light, against `e2e/editor.spec.ts`, `e2e/history.spec.ts`, `e2e/diff.spec.ts`,
`e2e/frame.spec.ts` and the book screenshot batch (`DEEPWIKI_BOOK_SHOTS`): every screen's
breadcrumb carries its real identity in place of the hand-built "Workspace home"/"Back to
history" buttons it replaced; edit mode's article and first paragraph land at the same x,
width and y as read mode's, closing the 2026-09-07 16px column-step follow-up above; nothing
scrolls sideways at 320. Screenshots `frame3-{members,book-history,book-diff,history,diff,
edit,edit-focus}-{1280-light,1280-dark,320-light}.png` in the session scratchpad (not every
combination was shot — `edit-focus` is 1280-light only). The same batch also reshot the
already-frame'd list, new-workspace and registration screens (`frame3-{list,new,
registration}-*.png`) for a like-for-like set.

**Gates still open.** None of `openspec/changes/versioning-and-collaboration/tasks.md`'s six
owner-review gates move: **10.2** (page history), **10.4** (page diff), **10.6** (book
changeset history and diff), **10.8** (comment gutter and thread panel), **10.10**
(orphaned-comment surface), **10.12** (presence indicators) are all still `[ ]`. This entry is
the same kind of backlog the 2026-09-14 entry above was — an agent's cross-screen pass, not a
substitute for the owner's review against this checklist and `docs/DESIGN-SYSTEM.md`.

**Follow-ups carried forward, not fixed**

- **Known defect at 320px: the members invite card overflows.** Not yet fixed — status is
  fix in flight.
- The book-diff page switcher's order is a client-side stand-in (`940cfb4`, tree position
  falling back to title); `GET /books/:id/diff` should order server-side instead
  (`docs/TODO.md` Findings, 2026-09-14 and 2026-09-15).
- Everything the 2026-09-15 "owner review" entry above carried forward and this batch did not
  touch: the contextual (third) pane is still an overlay, the sidebar's resize handle is
  pointer-only, the mention count is capped at twenty threads, the breadcrumb below `sm` shows
  only the last crumb, and the two-icon-pack requirement (§4.3) remains untested.

---

### 2026-09-16 — Starting a thread from read mode — awaiting the owner's eye

**Reviewer:** none yet — this entry is what was shipped for review, not a review.
**Verdict:** Pending

The owner could not comment on a document: the overlay displayed, replied and resolved, and
nothing started a thread. This batch (`feat/new-thread-from-read`) adds the two ways in and one
composer, on the read screen only. Pre-build contract: a member with `comment`, arriving on a
paragraph they disagree with; "say something about this"; the single primary action is Post;
the data is the block's identity the render now names (`data-block-id` or the new
`data-derived-block-id`) and the person's own text; it does not edit or reply; with nothing
typed Post explains itself, and a 12,000-word page's two hundred slots are one tab stop.

- **A "+" beside every commentable block** without a mark (`CommentGutter`): 32px icon-only,
  accessible name "Comment on this block" and a tooltip (§4.3), quiet until its block is hovered
  or it is focused (§4.4 — chrome quieter than content), never removed from the tab order (§5).
  The gutter is a roving-tabindex group — arrows, Home, End, said in an `aria-describedby`
  description (§4.1's hand-rolled-primitive contract; §5's "name the keys").
- **A floating "Comment" beside a selection** inside one block; a selection across blocks
  offers nothing, because an anchor is one block (§4.7).
- **`CommentComposer`** at the top of the thread panel: excerpt as §2.3's blockquote,
  labelled 16px `UTextarea` (§9.5), `@` mentions through the editor's own `MentionMenu` —
  extracted from `EditorSurface` so it exists once (§4.1) — keyboard-first (§4.6: arrows,
  Enter, Escape closes only the menu, Tab moves on), Post Filled and Cancel Outlined (§9.1),
  `aria-disabled` with a reason on both (§3, §5), focus taken on open, Ctrl+Enter posts.
- **States (§3):** optimistic success (the mark and a "Posting…" thread at once, replaced by
  the server's; "Comment posted." announced in the panel's live region); recoverable failure
  (bar notice, text kept, "Your text is still here"); stale page (409 → "reload"); permission
  (a reader gets no affordance, from `canComment` on the threads response — nothing empty);
  hidden (the comments toggle hides the "+" with the marks).
- **Measured** in `e2e/comments.spec.ts` against a real backend: the "+" ≥ 24px, revealed on
  hover, level with its block; the composer's field focused; the thread and mark present after
  a reload on a page that had **no persisted anchor** (the server minted one); the selection's
  words as the excerpt; the roving keyboard; no horizontal overflow at 320 (pane and document,
  `expectNoHorizontalOverflow`); a reader with `read` only sees no "+" and no floating action.
  Screenshots `fb-comments-{read-hover,composer}-{1280-light,1280-dark,320-light}.png` and
  `fb-comments-selection-1280-light.png` in the session scratchpad.

**Known before review, not fixed**

- The floating "Comment" sits over the previous line while shown (transient; the Medium/Docs
  placement). If the owner prefers it in the gutter column, that is a one-line change.
- Comments on lists, code blocks, tables and raw-HTML blocks are not offered: a persisted
  anchor cannot live on them today, so a "+" there would fail at the mint.
- A provisional thread is authored "You" until the server answers; the client has no `me`.
- Gate **10.8** is still `[ ]`; this batch is what makes it exercisable.

---

### 2026-09-16 — The navigation tree's context menu and filter — awaiting the owner's eye

**Reviewer:** none yet — this entry is what was shipped for review, not a review.
**Verdict:** Pending

Two of the owner's review items on the tree, one commit each, on
`feat/tree-context-menu-filter` (`docs/TODO.md` Findings, 2026-09-16, has the detail).
The sidebar's toolbar row is untouched; a parallel branch owns it.

**Pre-build contract (§2), both items.** *Who:* a workspace member in the room, reading
more than editing, who wants to act on a row without leaving the tree or to find one among
hundreds. *What:* "rename this / add a page here / move it up" and "show me the pages
with *auth* in the name". *Primary action:* the menu's — Rename…; the filter's — type.
*Data:* `GET /workspaces/:id/tree` (id, type, title, children) and `LEGAL_PARENT_TYPES`
through `legalChildTypes()`; no per-node permission exists (Open Questions). *Not:*
delete (three open questions), a command palette (`Ctrl`+`K` is reserved), a search of
page bodies. *Empty / too much:* the filter is not offered on an empty tree; a 400-page
book filters to matches and their ancestors, and a menu on any of its rows is the same
one menu.

**Walked (§3–§6), and what holds it:**

- **Menu** — every row: right-click, `⋯` (name *and* tooltip, §4.3; 24px target, §5),
  `Shift+F10` and `ContextMenu` (§5, keyboard equivalent stated in the `?` help). Items
  from the one hierarchy table; unavailable ones stay in the menu `aria-disabled` with the
  reason as visible description (§3 "Disabled", §5). Arrow-navigable; Escape closes and
  focus returns to the row (§5, measured in `e2e/tree.spec.ts`). Menu on the `bg-accented`
  rung at `rounded-md` (`DESIGN-SYSTEM.md` §9.6, §3.4). Inside the viewport at 1280 and
  320, measured, with reasons wrapping rather than truncating. "New…"/"Rename…" open the
  toolbar's own dialogs — one component, not one copy per surface (§4.1). Copy link
  confirms in a live region (§3 "Success", §5).
- **Filter** — toggle with `aria-expanded`/`aria-controls`, name and tooltip with the
  keys; `Ctrl`/`⌘`+`Shift`+`F` only while the sidebar has focus; the field is a `UInput`
  (§4.1) with a programmatic label (§5), 16px text (§9.5) at `h-10` (§7.2, recorded in
  `DESIGN-SYSTEM.md` §14); matches marked in an opaque secondary pair, never yellow, never
  alpha (§4.2); the count in a live region always in the DOM (§5); filtered-empty distinct
  from first-run empty with "Clear filter" beside it (§3); Escape clears, hides and
  returns focus to the tree (§5); folds restored on clear (unit-tested by construction).
- **Both** — no hardcoded colour literal (grep clean); screenshots at 1280 light, 1280
  dark and 320 light (`fb-tree-{menu,filter,filter-empty}-*.png` in the session
  scratchpad); `expectNoHorizontalOverflow` at every width (§6); `prefers-reduced-motion`
  through the global override (§5).

**Findings against my own work, fixed before review:** `group` on the tree item lit
every ancestor's `⋯` (moved to the row); the menu ran to x=474 at 320 (capped at the
popper's available width). Both in `docs/TODO.md`.

**Known before review, not fixed:** a `read`-only member sees "Rename…" live and is
refused by the server — no `write` signal per node reaches the client (Open Questions,
amended); SSR renders the sidebar's no-workspace state under the dashboard and hydrates
the tree over it, with console mismatches (`AppShell`, not this branch's file); the
two-icon-pack requirement (§4.3) remains untested.

---

### 2026-09-16 — The management sidebar, and the invite dialog — awaiting the owner's eye

**Reviewer:** none yet — this entry is what was shipped for review, not a review.
**Verdict:** Pending

Two of the owner's review items from the 2026-09-15 frame batch, one commit each on
`feat/management-sidebar`; full reasoning in `docs/TODO.md` Findings, 2026-09-16.

**Pre-build contract (§2), the management sidebar.** *Who:* a workspace admin on a
management screen (members today; settings, AI & models and the person's profile when
built), and the operator on registration. *Goal:* "get to the other management things
without going back through the tree." *Primary action:* none of its own — it is
navigation; the screen beside it keeps the one primary. *Data:* the workspace's id and name
(the directory), the route. Nothing is drawn against a permission the client does not have
— see below. *Non-goals:* no gating on `manage` or `is_super_root` (no signal reaches the
client, Open Questions 2026-09-14); no building of the three placeholder screens. *Empty /
too much:* the list is fixed and short; nothing to overflow.

**What to look at**

1. **The sidebar switches region on a management screen and back.** On
   `/workspaces/:id/members` the tree steps out and `ManagementSidebar` (`UNavigationMenu`
   vertical) steps in: "Back to workspace", then Workspace (Members · Settings · AI &
   models), Instance (Registration settings), You (Profile). The open door carries
   `aria-current="page"`; "Back to workspace" never does (`exact`). The switcher stays at
   the top in both modes — the person is still in the room — and the footer keeps only the
   theme toggle, because Members and Registration settings now stand in the sections (§4.1:
   once, not twice). Measured in `e2e/management.spec.ts` at 1280×900 in both themes and at
   320×900: the drawer holds the same region; nothing scrolls sideways at the pane or in the
   list; every door is a tab stop in reading order and Enter opens it.
2. **Unbuilt doors are honest screens, not disabled rows.** Settings, AI & models and
   Profile open a `PageNotice` "Not built yet" naming what exists today and one real next
   action. A disabled `UNavigationMenu` item is `tabindex="-1"` — out of the tab order, its
   reason behind a hover — the §5 failure this file names, so the route is the honest
   shape.
3. **The active indicator is `secondary-container`, not the pane's own rung.** Nuxt UI's
   active pill is `before:bg-elevated` on a `bg-elevated` pane — the 2026-09-07 tree-row
   defect in a second component (§5.2, "a state is a layer, never a step to another surface
   rung"). Corrected centrally in `app.config.ts`, with the tree's selected fill, the
   `currentColor` hover/focus/pressed layer and the global 3px `secondary` focus ring.
4. **The invite form is a dialog.** "Invite someone" — Filled, `size="sm"`, in the
   contextual bar beside the breadcrumb, where edit mode's Save stands — opens a `UModal`
   holding the reviewed fields unchanged (email, the access radio group with its four
   descriptions, the help sentence). Escape with the field empty closes; with an address
   typed the footer swaps to "Discard this invitation?" — Keep editing (focused) / Discard —
   inside the dialog, never `window.confirm` and never a second dialog (`ConfirmDialog.vue`
   is arriving on another branch and this must not grow a copy). Sent closes the dialog,
   focus returns to the button, the live region on the screen announces it and the pending
   list updates. The two lists are the screen's single `measure` column — Members, then
   Pending — for the tree's §2.4 reason; two columns at `@2xl` were measured against and
   rejected (a pending row wraps at ~490px). `e2e/onboarding.spec.ts` drives the button, the
   dialog, the real Escape in both states, the focus return, the 320px pane and the dialog's
   own box.

**Screenshots** `fb-manage-{members,settings,registration}-1280-{light,dark}.png`,
`fb-manage-{members,settings,drawer}-320-light.png`, `fb-manage-invite-{1280-light,
1280-dark,320-light}.png`, `fb-manage-members-1280-dark.png` in the session scratchpad.

**Follow-ups carried forward, not fixed**

- `is_super_root` and `manage` still do not reach the client, so "Registration settings"
  renders for every caller in the Instance section as the footer door did; the destination
  refuses (Open Questions, 2026-09-14).
- tailwind-merge drops a project `--text-*` role written into a `:ui` slot override
  (`WorkspaceSwitcher`'s name, the breadcrumb links) — a central `ui.tv.twMergeConfig`
  fix exists and is the owner's call, since it changes reviewed screens (`docs/TODO.md`
  Findings and Open Questions, 2026-09-16).
- The confirm-on-dirty pair in the dialog's footer is the placeholder for the shared
  `useConfirm()` arriving on another branch.
- Everything the 2026-09-15 entries carried forward and this batch did not touch: the
  contextual (third) pane is still an overlay, the sidebar's resize handle is pointer-only,
  the two-icon-pack requirement (§4.3) remains untested.

---

### 2026-09-16 — Owner review of the frame: the signed-out bounce, native confirms, and edit mode's bar

**Reviewer:** Eduardo
**Verdict:** Pass with follow-ups (three requests, all shipped in `feat/frame-review-shell`)

Measured in `e2e/navigation.spec.ts` and `e2e/editor.spec.ts` against the real backend, at
1280×900 in both themes and 320×900 in light; screenshots `fb-shell-{login,edit,edit-confirm,
sidebar}-*.png` in the session scratchpad.

**Findings** (ordered by user impact)

1. **A signed-out visit to `/workspaces` rendered a "Sign in to see your workspaces" card; the owner wanted a straight redirect that comes back.**
   - *Observable evidence:* signed out, `/` → `/workspaces` showed a card with one button, and
     the button led to `/login` and, after signing in, to `/` — never back to the address the
     person had followed. Inside the frame it was worse: `/workspaces/:id`, `/pages/:id` and
     every history and diff screen classified the same 401 as "Cannot reach the server", with
     a Retry that would 401 again.
   - *Root cause:* four screens each answered their own 401 with their own card (§4.1's copy
     defect, four copies of one sentence), eight composables had no 401 branch at all, and
     nothing carried the address across the sign-in.
   - *Correction applied:* one rule in one composable, `useSignInRedirect`: the request that
     loads a screen reads `unauthenticated` → `navigateTo('/login?next=<address>', { replace })`;
     `pages/login.vue` reads `next` through `localReturnPath` (same-origin path only, never
     `/login`) and returns there after a real `Set-Cookie`, explaining the bounce once in an
     `InlineNotice tier="chip" tone="info"` — a polite status, not an alert, because nothing
     failed. The four cards are gone; the eight composables classify 401. Measured: `/`
     signed out lands on `/login?next=/workspaces`, the notice reads "Your session has ended…",
     signing in lands on `/workspaces`; `/workspaces/:id` carries its own id; an off-origin
     `next` is ignored and lands on `/`.
   - *Rule added:* None new — §3's "never a dead end" and §4.1's one-component rule already
     said it; the finding is that both were satisfied per screen and violated as a system.

2. **Edit mode asked "unsaved changes?" with `window.confirm`, and take-over had a modal of its own on the page.**
   - *Observable evidence:* leaving a dirty editor by a tree row, and the two Reload exits,
     opened the browser's native box — outside every theme, with "OK" for a verb, and no
     focus return; the take-over confirmation was a third dialog shape.
   - *Root cause:* no confirm component existed, so each call site reached for what was
     nearest.
   - *Correction applied:* `ConfirmDialog.vue` on `UModal` — no "X", Escape and the scrim
     cancel, focus lands on the safe action (Cancel first in the footer) and returns to the
     control that asked (Reka returns to a *trigger*; a promise-opened dialog has none, so the
     opener is read and restored in `onCloseAutoFocus`), the confirm action the one filled
     button, `primary` or `error` — with `useConfirm()` returning a promise, so a call site is
     `if (!(await confirm({ … }))) return`. Mounted once in `app.vue`. All three edit-mode
     confirmations use it. `beforeunload` — a tab closing — stays: no page script may draw a
     dialog while the document is torn down, so that one prompt is the browser's and is
     commented as such. The dialog headline is set centrally on `UModal` (§2.3:
     `headline-small`; the library's description already is `body-medium`), so the tree's
     dialogs read alike. Measured: a dirty editor → tree row →
     dialog; Escape and "Keep editing" keep the editor and its edits and return focus to the
     row; "Leave" navigates.
   - *Rule added:* §4.1 — no native `alert`/`confirm`/`prompt`; the product's dialog, through
     `useConfirm`. `beforeunload` is the one exception, and it is the browser's.

3. **"The top part is too much; the document loses importance" — edit mode's contextual bar.**
   - *Observable evidence:* at 1280 the bar held the toggle, the brand, the full breadcrumb
     (workspace › shelf › book › chapter › page › Editing), "Read page" and Save — restating
     the path the tree beside the editor already shows. In the sidebar, "+ New…" and "Rename…"
     sat at their natural widths with the right third of the 280px pane empty.
   - *Root cause:* the bar is one component for every screen and had one density; the toolbar
     row's controls had no fill rule.
   - *Correction applied:* `AppShell` gains `condensed`: the breadcrumb keeps its last two
     crumbs and folds the rest into one overflow control ("Show the full path", 32px, a
     `UDropdownMenu` holding the folded crumbs — the workspace as a link, the places as
     labels), composed from `UBreadcrumb`'s item slot because the installed 4.11 has no
     overflow of its own. Save stays the one filled action, "Read page" the Text button; the
     sidebar toggle's tooltip already states `Ctrl`/`⌘`+`\`. The bar's height is unchanged, so
     the column starts where read mode's does — measured: the title and the first paragraph
     at the same x, y and width in both modes, both themes, and the bar at 56px. In the
     toolbar, `New…` grows (`flex-1`) and `Rename…` keeps its width; measured at 1280 and in
     the 320 drawer: `Rename…` ends at the row's edge, both 32px tall.
   - *Rule added:* None — one-off; whether the read screen's bar should condense too is an
     open question for the owner (`docs/TODO.md`).

**Follow-ups carried forward, not fixed**

- Whether the condensed bar should be every frame screen's, not edit mode's alone.
- Dialogs render at `rounded-lg` (16px), the container rung; M3's dialog is
  `corner-extra-large` (28px) and §3.4 says dialogs keep it, but the ladder has no 28px rung
  and every dialog in the product ships at 16px. A central ruling, recorded in `docs/TODO.md`
  Open Questions rather than taken per component.
- The host ran six concurrent worktrees (load average 25–139 on four cores) throughout;
  the touched e2e specs were run green against a production build of this branch served on
  the suite's web port, because `nuxt dev` could not serve a page inside the suite's 30s
  waits. `docs/TODO.md` Findings has the numbers. A dirty editor's 300ms window before
  `isDirty` is set, and the Save test that races it, are recorded there too.
- Everything the 2026-09-15 entries carried: the contextual (third) pane is an overlay, the
  resize handle is pointer-only, the mention count caps at twenty threads, the two-icon-pack
  requirement (§4.3) is untested.

---

### 2026-09-16 — Edit-mode latency batch: route-change indicator, prefetch on intent, the skeleton held until the editor exists — awaiting the owner's eye

**Reviewer:** none yet — this entry is what was shipped for review, not a review.
**Verdict:** Pending

Built from the owner's eighth finding of 2026-09-16 ("entering edit mode is slow to load …
an nprogress-style top progress bar … the UI must feel fast") after the cause was measured
(`docs/TODO.md` Findings, 2026-09-16, "edit-mode latency: measured causes and fixes"). Two of
the four fixes are invisible by design — `reka-ui` prebundled in dev, the editor chunk loaded
beside the session request — and two touch what a person sees:

- **Route-change feedback.** `NuxtLoadingIndicator` in `app.vue`, once for every route:
  `primary` role at 3px, `error` for a failed hop, off for any hop under 200 ms, and under
  `prefers-reduced-motion` drawn full at once rather than creeping (`docs/DESIGN-SYSTEM.md`
  §14, 2026-09-16). Measured in `e2e/perf.spec.ts` with the edit route's chunk held back:
  opacity 1 during the hop, background equal to the computed `--ui-primary`, height 3px,
  opacity 0 once the screen lands; and with `reducedMotion: 'reduce'` emulated, the bar's
  transform is the identity matrix from its first visible frame.
- **Prefetch on intent.** Hover or focus on the read screen's "Edit" preloads the edit route's
  components and starts the editor chunk, so the click finds them warm. §4.5's "read mode
  does not boot the editor" still holds — nothing parses or mounts on the read screen; the
  chunk is fetched on the one control whose only purpose is to leave for edit mode, and
  `e2e/read.spec.ts`'s no-editor-request assertion (which never hovers) stays green. The
  tree rows are unchanged: `feat/tree-context-menu-filter` owns `NavigationTree.vue`, and
  their `NuxtLink` conversion waits for it.
- **The skeleton stays until the editor exists.** `EditorSurface` keeps the `doc-body` text
  lines up and hides (never removes — ProseMirror needs the element to mount into) its own
  box until `createEditorView` has attached; measured before, the empty 256px well stood
  120–730 ms where the skeleton had been. §3's "no layout shift on load" measurement in
  `e2e/editor.spec.ts` is unchanged and green: the loaded first paragraph lands where the
  skeleton's first line stood.
- **No heartbeat at open.** `useLockHeartbeat.start()` no longer sends a `PATCH …/lock` in
  the instant the session response has just acquired the lock; the first beat is one
  interval later. Not visible, but it changes when the lock-lost notice can first appear —
  `e2e/editor.spec.ts`'s 320px lock-lost test now advances the clock one interval.

Screenshots `fb-perf1-{loading,edit,edit-skeleton}-{1280-light,1280-dark,320-light}.png` in
the session scratchpad; `expectNoHorizontalOverflow` measured on the edit screen at 320.

Known before review, not fixed: the report's fixes B (a cached, SSR-capable read layer), E
(optimistic tree writes), F (icons bundled offline) and G (bundle hygiene) are not in this
batch; the presence `EventSource` is still reopened on every hop; the two-icon-pack
requirement (§4.3) remains untested.

---

### 2026-09-16 — The block UI in edit mode: selection toolbar, block handle and tunes, undo/redo — awaiting the owner's eye

**Reviewer:** none yet — this entry is what was shipped for review, not a review.
**Verdict:** Pending

The owner's fourth finding of 2026-09-16 ("clean, Notion-like editing — a block handle, inline
floating tools, `/` to insert") on the API `feat/editor-block-commands` built. Branch
`feat/editor-block-ui`, `apps/web` only, one commit per piece; `docs/TODO.md` Findings,
2026-09-16, has the detail and what was found on the way.

**Pre-build contract (§2).** *Who:* a member with `write`, already inside the editor, most
often arrived from "Edit" on the read screen. *Goal:* "make this bold", "move this paragraph
under that one", "turn this into a heading", "undo that" — without leaving the text. *Primary
action:* still Save; every control here is in-place editing, and the tools appear only when
there is something to act on. *Data:* the selection plugin's report (`kind`, `marks`, `link`,
both ends' coordinates), the history depths after every transaction, `blockAt` under the
pointer, and each block command's dry run. *Not:* a permanent toolbar, a sidebar of blocks,
turning a whole list at once, an AI action. *Empty / too much:* an empty page shows nothing
until a range or a hover exists; a 12,000-word page has one handle and one toolbar, never a
decoration per block.

**Walked (§3–§6), and what holds it:**

- **Undo / Redo** — icon-only beside Save, named and tooltipped with their keys (§4.3),
  `aria-keyshortcuts`, `aria-disabled` with "Nothing to undo yet." / "Nothing to redo." while
  that side of the history is empty (§3, §5), running the handle's commands so a button and
  `Ctrl`+`Z` agree on a step. At 320 "Read page" is icon-only (label kept for assistive
  technology) so the bar holds; measured: the "Editing" crumb whole, no sideways scroll.
- **Selection toolbar** — `role="toolbar"` "Text formatting", one tab stop with arrows, Home,
  End, Escape back to the editor (§4.1's hand-rolled contract, §4.6), `Ctrl`/`⌘`+`Shift`+`.`
  from the editor to reach it (§5); pressed as `aria-pressed` plus the opaque
  `secondary-container` fill, never colour alone (§5); `mousedown` cancelled so a click keeps
  the caret; Link a `UPopover` with a labelled `h-10` URL field (§9.5's 16px text kept). Placed
  above the first line, below the last near the top edge, never past a viewport edge — measured
  whole at 1280 and 320 (§4.6, §6). Shown only while the editor or the toolbar has focus, so a
  Save click takes it down.
- **Block handle** — one 24px named, tooltipped control (§5, §4.3) in the left margin from `md`
  up, a floating chip inside the column below (the comment gutter's own trade); the tooltip
  states the keys that open the menu and the keys that move a block, so the drag has a stated
  keyboard twin (§5). Out of the tab order: `Ctrl`/`⌘`+`/` opens the same menu for the caret's
  block. Drag through the package's hooks; the drop cursor is the `primary` role, the selected
  block `secondary-container` (`DESIGN-SYSTEM.md` §14).
- **Tunes menu** — `UDropdownMenu` (§4.1): Turn into… (a submenu, Text first; disabled with the
  reason on a table, footnote or verbatim block; "Already a heading 2." on the block's own kind),
  Move up / Move down with `Alt`+arrows shown, Duplicate, Delete — every refusal stays in the
  menu `aria-disabled` with its reason on show (§3, §5); capped at the popper's free width so a
  reason wraps at 320; closing returns focus to the editor.
- **`/` menu** — icons beside the labels, never instead (§4.3); Enter and Tab confirm again
  (a regression in the package since 2026-09-14, worked around on the host — `docs/TODO.md`).
- **Measured** in `e2e/editor.spec.ts` against the real backend, reading the saved bytes back:
  bold saves as `__word__` and a second toggle restores the original bytes; the link as
  `[text](url)` and back; the drag reorders with anchors intact; Duplicate saves one `^id`;
  Turn into on a list lifts to text first; `/table` and `/footnote` land the caret where the
  package says; `expectNoHorizontalOverflow` at 1280 light/dark and 320 with the toolbar, the
  menu and a drag up. Screenshots `fb-editor-ui-{surface,toolbar,tunes,drag}-{1280-light,
  1280-dark,320-light}.png` in the session scratchpad.

**Known before review, not fixed**

- Below `md` the handle covers the block's first glyphs while it shows; touch devices never
  show it (no hover), so at phone widths the tunes are the keyboard's or nobody's.
- The toolbar covers the previous line while shown (the Medium/Docs placement).
- "Turn into" on a list tunes its first item, not the whole list (a package command would).
- Undo/Redo keep keyboard focus on the button; a pointer click keeps the caret.
- The two-icon-pack requirement (§4.3) remains untested; the contextual (third) pane is still
  an overlay; everything the 2026-09-16 entries above carried forward.

---

### 2026-09-16 — Frame follow-ups: the tree's rows as links, optimistic writes, and the presence stream — awaiting the owner's eye

**Reviewer:** none yet — this entry is what was shipped for review, not a review.
**Verdict:** Pending

Four follow-ups from the 2026-09-16 latency report and the frame batches, one commit each on
`fix/frame-followups` (`docs/TODO.md` Findings, 2026-09-16, "Frame follow-ups", has the
measurements). Two are invisible by design — the presence stream no longer drops every ten
seconds (`Bun.serve`'s idle timeout; a keep-alive comment inside it), and it is one
connection per workspace shared across hops instead of one per screen — and two touch the
tree a person uses all day:

- **A page row's title is a link** (`NavigationTreeNode.vue`). An `<a href>` the browser can
  open in a new tab, copy or drag, out of the tab order (`tabindex="-1"`) so the tree stays
  one tab stop on the `treeitem` (§4.1's hand-rolled-primitive contract, §5); it takes the
  row's colour and no underline, so it reads as a row and not as prose in the accent. A click
  on the link records the selection and leaves the navigation to the link; a click elsewhere
  on the row, and Enter, open the page through the tree as before. Pointer enter or focus on
  the row preloads the route, once, so the hop finds it warm — `NuxtLink`'s own prefetch
  skips it in dev. Measured in `e2e/perf.spec.ts`: the read route's chunk requested on hover,
  none of it after the click; `e2e/tree.spec.ts` and `e2e/navigation.spec.ts` unchanged and
  green (keyboard model, context menu, filter, clicking through).
- **Writes draw before the server answers** (`useTree.ts`, `NavigationTree.vue`,
  `NavigationTreeActions.vue`). A dropped row is where it was dropped at once and stays there
  on success — no reload, no snap-back — and only a refusal puts it back, with the reason in
  the existing chip-tier notice beside the tree (§3, recoverable with a real reason). A
  created or renamed row is drawn from the response that made it; the toolbar's specific
  announcement is unchanged. Measured in `e2e/tree-writes.spec.ts` against the real API with
  the `PATCH` held: the new order while the response is held, zero `GET /tree` after a
  successful `PATCH` or `POST`, the server's tree agreeing, and a 403 snapping back with the
  notice. Found and fixed on the way: a pointer drop below the dragged row among its own
  siblings landed one row further than the pointer said (the drawn slot versus the server's
  after-removal slot); the keyboard and the menu were never affected.

Screenshots `fb-frame2-tree-{row-hover,drag-refused}-{1280-light,1280-dark,320-light}.png` in
the session scratchpad, each measured with `expectNoHorizontalOverflow` on the pane and the
document (§6). No new colour, token or rung: the link inherits the row's `text-default`, the
notice is the chip tier that was already there.

**Known before review, not fixed:** the SSR hydration mismatch on `/workspaces/:id` was
dropped from this batch by the owner — `perf/data-layer-icons-bundle` fixes it; the report's
fixes B, F and G are on that branch too; the two-icon-pack requirement (§4.3) remains
untested.

---

### 2026-09-16 — Integration regressions after the eight merges — awaiting the owner's eye

**Reviewer:** none yet — this entry is what was shipped for review, not a review.
**Verdict:** Pending

Four e2e failures on `main` after the day's eight merges, each two branches right alone and
wrong together; fixed on `fix/integration-regressions`, one commit each, the failing e2e as
the red and a unit test where the cause lives (`docs/TODO.md` Findings, 2026-09-16,
"Integration regressions after the eight merges", has the measurements). What a person sees
changed in two places, and what a keyboard user gets in a third:

1. **The tree's history item is "Page history" / "Book history", never "History".** The
   context-menu branch had labelled both "History". Decided with §5: a screen-reader user
   hears the menu item, not the row it hangs off, so the name says what it is the history of
   on its own; visible label and accessible name are the same words (§4.3). Screenshots
   `fb-fix1-tree-menu-*` (a page row) and `fb-fix1-tree-book-menu-*` (a book row).
2. **Cancel on "Leave without saving?" lands focus on the tree row again** (§5, "returned on
   close to the element that opened them"). A page row's title had become a `tabindex="-1"`
   link, a mouse click focuses the element under the pointer, and the dialog dutifully
   returned focus to that link — inside the `treeitem`, not on it, and off the tree's one tab
   stop (§4.1's hand-rolled-primitive contract). Focus arriving on the link is now the row's.
   `fb-fix1-edit-confirm-*` and `fb-fix1-edit-confirm-returned-1280-*`.
3. **The floating "Comment" appears for a selection made before the caller was known to be
   allowed to comment** (§4.7's affordance, §3's honesty: the article is readable before the
   threads response arrives). `fb-fix1-selection-*`, by a real pointer drag.
4. The management drawer at 320 was never broken; its e2e clicked before hydration.
   `fb-fix1-management-*` for the record.

`expectNoHorizontalOverflow` measured on every screenshot at 1280 light, 1280 dark and 320.

**Known before review, not fixed:** at 320 the sidebar drawer stacks *above* "Leave without
saving?" when a row in the drawer is clicked with a dirty editor — Escape answers the dialog,
a pointer cannot reach it (`docs/TODO.md`, same entry; a stacking ruling between two overlays,
for the owner). After Cancel the row holds focus but Chrome draws no `:focus-visible` ring
for a script focus that follows a pointer; a keyboard user gets the ring.

---

### 2026-09-16 — The last three e2e failures: the smoke test's stale landmarks, the drag the focus handoff killed, the compose stack left `Created` — awaiting the owner's eye

**Reviewer:** none yet — this entry is what was shipped for review, not a review.
**Verdict:** Pending

Three items on `fix/final-e2e-regressions`, one commit each, the failing e2e as the red and a
unit test where the cause lives (`docs/TODO.md` Findings, 2026-09-16, "Three e2e failures left
on `main`", has the measurements). One touches what a person sees; one touches only the test;
one is the harness.

1. **The smoke test asked the sign-in screen for an app bar.** `AuthShell` renders none, on
   purpose (this log's 2026-09-15 entries; `docs/DESIGN-SYSTEM.md` §14): a person who has not
   signed in is not inside the product. The screen was **not** changed to satisfy the test.
   `e2e/smoke.spec.ts` now proves the boot as it is: `/` signed out lands on `/login?next=
   /workspaces`, the sign-in `h1` in the one `main`, **no** `banner`/`contentinfo`/`navigation`
   and no link named for the product (§5's landmarks, inverted for a screen that must not have
   them), the theme toggle changing two painted properties — the app ground and the Filled
   button — and, new, the same screen at 320 with `expectNoHorizontalOverflow` (§6).
   `fb-fix2-front-door-{1280-light,1280-dark,320-light}.png`.
2. **A page row could not be dragged with a mouse.** The previous entry's fix 2 handed focus
   from the row's link to the `treeitem` on the link's `focus` event; Chromium cancels a link's
   native drag when its mousedown moves focus, so `dragstart` never fired — every mouse
   reorder of a page row was gone, while the keyboard's `Alt`+arrows (§5's stated equivalent)
   and the context menu still worked. The handoff now happens on the **click, before the
   link acts** (capture phase — in the bubbling phase the dirty-editor dialog had already
   opened and trapped focus, `e2e/editor.spec.ts` caught it) and at the **end of a drag**: a
   click on the title still leaves the tree's one tab stop where focus is (§4.1's
   hand-rolled-primitive contract, §5) and `ConfirmDialog` still returns focus to the row; a
   drag from the title now lands, and ends with the dragged row's `treeitem` focused
   (asserted in `e2e/tree-writes.spec.ts`'s review material) — and therefore drawn as the
   selected row, since the tree's focus is its selection (the row's `focus` emits `activate`):
   after a drag the dragged row carries the `secondary-container` fill, where before the row
   it was dragged from kept it. `fb-fix2-tree-after-drag-{1280-light,1280-dark,320-light}.png`
   show the row after a refused drag, with the notice beside the tree.
3. The e2e harness's own containers: `podman compose up -d --wait` left a container in
   `Created` under load and every later run failed the same way; provisioning now starts what
   compose left behind, once, before raising the failure with its manual command. Not a
   screen.

**Known before review, not fixed:** after a drag from a page row's link the `treeitem` holds
focus but Chrome draws no `:focus-visible` ring for a script focus that follows a pointer (the
previous entry's Cancel case, again); the stacking of the 320 drawer over "Leave without
saving?" from the previous entry; the two-icon-pack requirement (§4.3) remains untested.

---

### 2026-09-17 — Page diff and book diff: word-level marks and a side-by-side layout — awaiting the owner's eye on gates 10.4 / 10.6

**Reviewer:** none yet — this entry is what was shipped for review, not a review.
**Verdict:** Pending

The owner's review of 2026-09-17 failed gates **10.4** (page diff) and **10.6** (book diff) with
one sentence: "a diff like GitHub's". Branch `feat/word-level-diff`, one commit per piece;
`docs/TODO.md` Findings, 2026-09-17, has the two entries (the empty history row, and the diff).

**Pre-build contract (§2).** *Who:* a member with `read`, arriving from page history or book
history to see what a save changed. *Goal:* "show me the words that changed, not just which
paragraphs." *Primary action:* none — a reading surface; "Unified | Side by side" is a view
preference, not an action on data. *Data:* `GET /pages/:id/diff` and `GET /books/:id/diff`,
whose `modified` changes now carry `segments` (`diffInline()` in `packages/core`); nothing is
computed in the browser. *Not:* a character diff, a line differ between blocks (block-diff
spec), restore. *Empty / too much:* "No differences" is unchanged; a 2,000-word paragraph
rewritten end to end is one `<del>` and one `<ins>`, wrapped inside its row.

**What to look at**

1. **Inside an edited block, the words that changed** (`DiffInlineText`, on both screens
   through the one `DiffBlockChanges` — §4.1): `<ins>` on `success-container` /
   `on-success-container`, `<del>` on `error-container` / `on-error-container` — M3's
   `tertiary-container` role carried by `success`, the alias that already names "Added" on the
   badge beside it (`docs/DESIGN-SYSTEM.md` §14, 2026-09-17) — each with the 1px inset accent
   ring every tonal chip carries, so the mark has a boundary and not only a fill (§4.2, §5).
   Never raw red/green, never alpha. The underline and the strike stay as the second signal
   (§5, "never colour alone"), and the elements themselves are the semantics assistive
   technology reads. A legend once per screen, drawn with the real marks. "Moved up/down"
   is unchanged; a block that moved *and* changed shows the directional badge and its marks.
2. **"Unified | Side by side"** (`DiffLayoutControl`): M3's segmented button — a `UFieldGroup`
   of outlined segments, the pressed one on `secondary-container` with `aria-pressed` (§5),
   icon beside label (§4.3), a tooltip each; the side-by-side one states that below 768px the
   choice is honoured as one column. Persisted per browser in `dw-diff-layout` like
   `dw-comments`, read before the first render. Side by side is a two-column grid per row:
   before carries the deletions, after the insertions, an added or removed block says which
   side it is not on, and column headings stand once above the list (each cell also carries
   a visually hidden "Before:"/"After:").
3. **The page diff's rows are now the book diff's rows.** The full-row accent-container wash
   the 2026-09-14 audit called "a highlighter pass over source" is gone from the page screen;
   both screens carry the signal on the 4px accent border and the outlined badge, on the
   neutral `bg-default` inset (§9.4). The page-diff skeleton draws the new row and the
   header row by the same classes.
4. **History no longer offers a comparison that shows nothing.** A revision storing the same
   bytes as the one before it — rows minted before `savePage()` refused byte-identical saves
   (the "empty history entry", `docs/TODO.md` Findings 2026-09-17) — says "Same content as the
   previous revision" and its "Compare with previous" is `aria-disabled` with the reason in the
   tooltip (§3 "Disabled — explains why", §5). New rows of that kind cannot be minted.

**Measured** in `e2e/diff.spec.ts` against the real backend, at 1280×900 in both themes and
320×900 in light: the seeded edit renders exactly `<ins>now </ins>`, `<del>no edits yet</del>`,
`<ins>one small edit</ins>`; each mark's boundary (`boundaryContrast`, §5's 3:1) at
**6.19:1** (`<ins>`) and **7.08:1** (`<del>`) in light, **12.13:1** and **11.46:1** in dark;
one legend; the control present on the server-rendered DOM (its first cut was not — see
`docs/TODO.md`); the control toggles, the cookie reads `side-by-side`, a reload keeps it; the
two columns sit beside each other (the after column starts past the before column's right
edge, same top); at 320 with the side-by-side cookie the row has one column, the control
still pressed; and `expectNoHorizontalOverflow` holds on every screenshot. Screenshots
`fb-diff-page-{unified,side-by-side}-1280-{light,dark}.png`,
`fb-diff-page-{unified,side-by-side}-320-light.png`,
`fb-diff-book-{unified,side-by-side}-1280-{light,dark}.png`,
`fb-diff-book-unified-320-light.png` in the session scratchpad.

**Findings against my own work, fixed before review:** the layout control was drawn with
`UButtonGroup`, a tag Nuxt UI 4 does not have (`UFieldGroup` is its name) — it rendered its
children on the client and nothing on the server, so every server-rendered screenshot lacked
it while every test passed. Now `UFieldGroup`, asserted on the server's DOM.

**Known before review, not fixed**

- Whitespace-only changes inside a block (a doubled space) mark the space itself, which
  reads as an empty mark; a visible-space glyph is a follow-up.
- Side by side on a block that only moved shows the same text in both columns; a "moved from
  here" ghost at the old position (the audit's direction (c)) is still the owner's call, as
  is direction (a), the diff as `doc-body` prose (`docs/TODO.md` Open Questions).
- The two-icon-pack requirement (§4.3) remains untested; everything the 2026-09-16 entries
  carried forward and this batch did not touch stands.

---

*The next entry goes below this one.*
