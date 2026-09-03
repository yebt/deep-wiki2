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

### 4.4 Reading density — this is a tool people live in all day

- [ ] Long-form document content has a **constrained measure**: roughly 65–80 characters per line. Full-viewport-width prose on a 27" monitor is a defect, not a feature.
- [ ] Real typographic hierarchy. Heading levels are visually distinguishable from each other and from body text by more than weight alone. A wiki whose h2 and h3 look identical has no scannable structure.
- [ ] Generous vertical rhythm between blocks. Paragraph, list, code block, and diagram spacing is consistent and comes from tokens.
- [ ] Reading comfort beats visual flourish. No gradient text, no animated headers, no decorative motion in the document body.
- [ ] Code blocks and tables scroll inside their own container and never widen the page (see section 6).
- [ ] Chrome (nav, toolbars, panels) is visually quieter than content. If the sidebar competes with the document for attention, the sidebar loses.

### 4.5 Read mode vs. edit mode

- [ ] The two modes are **visually unmistakable** at a glance — not a single small pencil icon changing state.
- [ ] The transition between them is obvious, reversible, and loses no data in either direction.
- [ ] Leaving edit mode with unsaved changes prompts. Browser navigation away with unsaved changes prompts.
- [ ] Read mode renders pre-rendered HTML and does **not** boot the editor. Verify: the ProseMirror bundle must not load on a read-mode page view.
- [ ] Entering edit mode when someone else holds the soft lock shows the presence state before the editor opens, not after.

### 4.6 Editor — ProseMirror / Milkdown

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

---

## 5. Accessibility floor

Non-negotiable. Each item is **pass/fail**, not an aspiration. A fail blocks the review.

- [ ] **Every interactive element is reachable and operable by keyboard alone.** Tab through the entire screen with the mouse unplugged and complete the primary action.
- [ ] **Focus is always visible.** In every verified theme. A `:focus` style removed without an equivalent `:focus-visible` replacement is an automatic fail.
- [ ] **Focus order matches visual order.** No jumps to the end of the DOM and back.
- [ ] **Focus is trapped in modals and returned on close** to the element that opened them.
- [ ] **No keyboard trap.** Every transient surface can be escaped with Escape.
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
- [ ] **Tables scroll inside their own `overflow-x: auto` container** with a visible affordance that more content exists.
- [ ] **Code blocks scroll inside their own container** and do not wrap by default.
- [ ] **Diagrams scroll or scale inside their own container** and never overflow the document column.
- [ ] **The navigation tree behaves sanely at depth.** Deep nesting (Shelf → Book → Chapter → Page) does not produce runaway indentation or horizontal scroll on narrow viewports; long titles truncate with the full title available on hover/focus.
- [ ] **Panel widths are resizable where it matters** and the choice persists per user.
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

*No real entries yet — this project has not yet presented a screen for review. The first entry goes here.*
