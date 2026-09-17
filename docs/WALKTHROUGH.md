# Walkthrough — touch every feature by hand

A manual tour of everything deep-wiki can do today, in the order a real team would meet it.
Each stop names the screen, what to do, what you should see, and the failure states worth
provoking on purpose. Written 2026-09-14 against `main`; `docs/RUNNING.md` is the authority on
bringing the stack up, and this file assumes you did.

Two accounts are needed from stop 4 onward. The seed gives you one; you make the other at stop 3.

| Role | Email | Password | Comes from |
| --- | --- | --- | --- |
| Operator (Super Root, has a plan) | `owner@deep-wiki.local` | `deep-wiki-dev` | `bun run db:seed` |
| Second user | whatever you invite | whatever you set | stop 3, via Mailpit |

Mailpit's inbox is at `http://localhost:8025` (or `MAILPIT_UI_HOST_PORT` from your `.env`).
Keep the second user in a private window so both sessions live at once.

---

## 0. Before you start

- `bun run env:check` passes. If it does not, fix `.env` before anything else — it names the
  symptom you would otherwise chase for an hour.
- Web is on `http://localhost:3001`, started **without** `--env-file` (`docs/RUNNING.md` §1).
- `podman ps` shows postgres, mailpit and minio healthy.

## 1. Sign in — `/login`

**Do:** open `http://localhost:3001`. Signed out, `/` sends you to `/login` (the way in, not a
screen of its own). Sign in as the operator.

**See:** `/` now opens onto the last workspace you were in — a `dw-workspace` cookie, decided
on the server before anything renders — so a returning session lands straight on its
dashboard, not a list. The seed's first sign-in has nothing remembered yet, so you land on
`/workspaces`, the chooser: one workspace, "Demo workspace".

**Provoke:**
- Wrong password → "Invalid credentials", form kept, no hint about whether the account exists.
- Click **Sign in** the instant the page paints, before it hydrates. The button reads
  "Preparing the form…" and does nothing until it is ready — it used to submit a native POST and
  bounce you back to an empty form.
- `/forgot-password` with a made-up address → the same 202 acknowledgement as a real one. Check
  Mailpit: nothing arrived, and the response gave nothing away. With the operator's address, a
  reset link arrives; follow it to `/reset-password`, set a new password, sign back in. Then set
  it back — the seed will not reset it for you (`ON CONFLICT DO NOTHING`).

## 2. Create a workspace — `/workspaces/new`

**Do:** "New workspace" above the list. Name it; the slug follows the name until you edit it.

**See:** success names the workspace and offers "Invite your team" as the next action.

**Provoke:**
- Create a second one with the same slug → the form stays, the slug field carries the error.
- The operator's seeded plan allows a limited number; keep creating until the plan-limit state
  appears. It names the plan and the number, removes the form, and links back. That is a real
  state, not an error.

## 3. Invite a colleague — `/w/<slug>/members`

**Do:** "Members" in the sidebar's footer — it stands beside Registration settings and the
theme toggle, and is reachable from any screen inside the workspace, not only the dashboard.
Invite an address you can read in Mailpit, pick the starting grant (read / comment / write /
manage on the root).

**See:** a live region confirms the address; the invitation appears under pending with its time
in **your** zone, zone named. In Mailpit, open the mail, follow `/invite/accept` in a private
window, set a password, land on the workspace's dashboard signed in as the new user.

**Provoke:**
- Follow the same link twice → "already used", with a way out.
- Open `/invite/accept` with no token → not a blank page: an explanation and a link to sign in.
- As the **second user**, open `/w/<slug>/members` by address → the same 404 a
  nonexistent workspace gives. Absence and denial are one answer here, on purpose.

## 4. The dashboard, and the tree in the sidebar — `/w/<slug>`

**Do:** as the operator. `/w/<slug>` is the workspace's dashboard, not the tree — the
tree moved into the sidebar, mounted once by `layouts/workspace.vue` and present on every
screen inside the workspace, not just this one. In the sidebar: "New…" → shelf → book (under
the shelf) → chapter → page. Rename one. Click a row to select it (the fill shows which);
Enter folds a container; Alt+↑/↓ reorders; drag works too.

**See:** every tree row does something; the toolbar acts on the row you picked, and says so;
folded subtrees are skipped by the arrow keys. The dashboard pane beside it answers "what
changed and who is here": recent saves (added / changed / moved / removed), your own recent
saves, open comment threads that mention you, and who is editing right now — `GET
/workspaces/:id/activity` plus the workspace-wide presence stream. A click on any tree row
swaps only this pane; the sidebar itself — its scroll position, its folds, a drag in
progress — survives the navigation.

**Provoke:**
- Try to create a book directly under a page → refused, and the refusal names both types. The
  same table that refuses the move refuses the create; there is one table.
- Name two siblings the same → 409, quoting the name. The product does not rename you to
  `overview-2` behind your back.
- Move your book under a shelf the second user cannot read, then look as the second user: the
  book is gone from their tree, with no trace. Move it back. (Moving needs `write` on both ends
  now; before today it needed neither.)
- As the second user with `read` only, "New…" and "Rename…" explain why they are unavailable
  instead of being greyed out with no reason.

## 5. Read a page — `/w/<slug>/p/<id>`

**Do:** open any page. This is the cached, sanitised HTML — no editor code loads here. The
address carries the workspace's slug and the page's id (2026-09-17): the id is what stays
stable when the page is renamed or moved, the slug is the name the team chose, and the
hierarchy is the breadcrumb's, not the address's. An old `/pages/<id>` address still lands —
type one and watch it become the new shape, permanently (a 301).

**See:** the measure column, the heading block, and the workspace frame's contextual bar:
from `lg` up, the sidebar toggle at its edge, then the breadcrumb, then — screen-specific —
the comments toggle (only when there are threads to hide), **history** (clock icon, tooltip
"Revision history") and **Edit**. If someone else is editing, a chip says who and since when.

**Provoke:**
- Open a page the second user cannot read, as the second user, by address → the not-found
  screen, byte-identical to a page that never existed. Offers "Your workspaces", not "sign in".
- Resize to 320px: nothing scrolls sideways; the bar holds the drawer toggle, up to four
  controls and the breadcrumb (below `sm` the breadcrumb shows its last crumb only).
- Toggle dark. The card is a card, not a hole — measured 1.49:1 against the ground.
- **Focus mode:** `Ctrl`/`⌘`+`\`, or the sidebar-toggle icon in the bar. The sidebar hides to
  nothing — not a rail — and the article re-centres in the whole pane. Reload: still hidden.
  Press the keys again: it comes back where it was, and the width you left it at.
- **Hide the comments:** with at least one thread on the page, the comments toggle in the bar
  hides the gutter marks and the panel (the "not placed yet" chip stays). While hidden, its
  label and badge still carry the count of open threads that mention you — hiding the marks
  never means you stop hearing about them. The choice survives a reload (`dw-comments`
  cookie); a reader with `read` but not `comment` sees no toggle and no marks either way.

## 6. Edit and save — `/w/<slug>/p/<id>/edit`

**Do:** Edit. Type. Put a word in **bold with Ctrl+B inside an italic phrase**. Type `/` for
the slash menu, `@` for mentions; use the arrow keys **and** the mouse on both. Save.

**See:** "Saved “<title>”." — and it clears when you type again. Reload: the markdown came
back from the server exactly as you wrote it. Open the saved markdown's history later: the
bold-inside-italic round-tripped byte-identically. (Until today, `_x y z_` with `y` bolded saved
as `_x&#x20;____y____&#x20;z_` and the page could never be reopened.)

**Provoke:**
- Paste `![alt](https://example.com/x.png)` → the page still opens in edit mode (carried as an
  opaque atom) and read mode still renders it.
- Paste `<details><summary>Rollback</summary>steps</details>` → readers now see it. Paste
  `<script>alert(1)</script>` → readers see nothing; view source, it is gone.
- Clear the whole document and save → allowed; reopens fine.
- Open the same page as the second user in the private window: **"Another editor holds this
  page"**, with *Take over* and *Open read-only*. Take over. Back in your window, the next
  heartbeat tells you the lock was lost and Save is unavailable with the reason.
- Stop the API (`Ctrl+C`), press Save → a network-error banner that says your work is
  **preserved**. Start it again, Save succeeds.
- Delete a paragraph that carries a `^anchor` (see stop 9), then paste the same text back with
  its anchor, Save → refused with the corrected document offered, not a silent resurrection of
  a retired block.

## 7. Revision history — `/w/<slug>/p/<id>/history`

**Do:** the clock icon from read mode.

**See:** every save, newest first, author and time in your zone. "Compare with previous" on all
but the oldest. Empty state on a never-saved page explains why and offers "Start editing".

## 8. Page diff — `/w/<slug>/p/<id>/diff`

**Do:** "Compare with previous". Make a revision that adds a paragraph, edits one, deletes one,
and **moves** one, then compare.

**See:** four classes, four treatments. *Moved* says "Moved down" or "Moved up" with an arrow —
a move is a move, not a delete plus an insert. The badges are legible on their rows (they were
1.00:1 until today).

**Provoke:** compare two identical revisions → "no differences", a real state.

## 9. Comments — read mode, second user

**Do:** grant the second user `comment` on the page (stop 3's members screen, or `manage` on
the root). As the second user, open the page and **start a thread**: hover a paragraph and a
"+" appears beside it in the gutter (or Tab to the gutter and use the arrow keys); press it,
type, Post. Then select a few words inside a paragraph: a "Comment" floats beside the
selection; press it and the selected words are the thread's excerpt. Open a thread, reply,
resolve. As the operator, reply back.

**See:** the mark and the thread appear the moment you post ("Posting…" until the server
answers, then "Comment posted."), and are still there after a reload — on a paragraph nobody
had commented on before, the server wrote a ` ^id` anchor into the Markdown for it. One request
for the page's threads; a read-only user sees no gutter, no "+", no floating "Comment" at all
(the API answers `canComment: false` and nothing else, and the client draws nothing — not an
empty gutter). Type `@` in the composer for the same mention menu the editor has.

**Provoke:**
- Press Post with nothing typed → it explains itself and stays reachable; press Cancel on a
  block with no thread → the panel closes and focus returns to the "+".
- Stop the API, Post → the composer stays open, the notice says your text is still here; start
  it, Post again.
- As the operator, save an edit to the paragraph while the second user has the composer open on
  it, then Post → "this block has changed since you opened the page — reload".
- Try a list or a code block: no "+". A persisted anchor cannot live on those yet.
- As the operator, delete the commented paragraph and save. As the second user, reload: a chip
  says a comment points at text that is gone; the panel shows **Text removed** and the original
  excerpt. The thread did not vanish and did not attach itself to someone else's paragraph.
- Mention the operator in a reply → mail in Mailpit. Mention a user who cannot read the page →
  no mail, no error, no hint.

## 10. Presence

**Do:** second user opens Edit on a page. Operator opens the same page in read mode.

**See:** "**<name> is editing since <time>**" in the operator's window within a heartbeat.
Second user closes the tab: the chip goes away after the lock lapses (two minutes by default),
visibly, without a reload.

**Provoke:** revoke the operator's `read` on that page mid-stream (members screen) → the chip
stops updating on the next event; presence never tells you about a page you can no longer see.

## 11. Book history and diff — `/w/<slug>/b/<id>/history`, `/w/<slug>/b/<id>/diff`

**Do:** "Book history" from a book row's own action in the sidebar tree. History groups saves
into **changesets** — same author, same book, within thirty minutes — and its bar offers
"Compare since…" without scrolling to the top row. Diff answers "what changed in this book
since <date>" and lets you step page to page, previous/current/next, **without going back to
a list**.

**See:** both screens inside the workspace frame: the breadcrumb carries the book's identity
("workspace › shelf › book › History", then "… › History › Changes since <date>") and is
itself the way back — there is no separate "Workspace home" or "Back to history" button, the
breadcrumb's own crumbs are the links. Each changed page is named, in tree order.

**Provoke:** a book with no saves → empty state with a way forward.

## 12. Instance settings — `/admin/registration`

**Do:** as the operator (Super Root), the shield icon in the sidebar footer ("Registration settings").

**See:** registration mode (closed / invitation-only / open), the domain allowlist, and an SMTP
test send. `open` needs a **successful** test send first; the screen says so and shows the
server's refusal verbatim if you try without one.

**Provoke:**
- As the second user, open it by address → a plain denied state (instance settings are no
  secret, only their control is).
- Change the SMTP config in `.env`, restart the API, reload → mode has reverted from `open`,
  and the screen says why.

## 13. Not-found, denied, and the chrome

**Do:** type `/w/nope/nowhere`.

**See:** "This link doesn't lead anywhere", the address in its own box, and **"Open this
workspace"** as the primary way out — the address named one — with sign-in demoted to
second. A page you cannot read answers identically to one that does not exist, everywhere.

**Provoke:** take a real page's address and change the slug to another workspace's — one you
can open — keeping the page id. "There is nothing at this address", in the pane, with the
sidebar standing on the workspace the address named and no row marked: the address's two
names disagree, and the screen does not say which one was wrong. Then type the old shape,
`/pages/<that id>`, and land on the page through its real workspace.

---

## What you cannot do yet — so you do not go looking

- **Delete** anything. Three questions are open in `docs/TODO.md` and the schema currently
  answers "cascade" by accident.
- **Comment on a list, a code block, a table or a raw-HTML block.** Threads start from read
  mode on paragraphs and headings (stop 9); the other block kinds cannot carry an anchor yet.
- **Self-register and create a workspace.** Registration works when the mode allows it, but a
  new user has no plan and nothing assigns one; they stop at "ask the operator".
- **Click a wiki-link.** `[[Page]]` renders inert by decision until the overlay carries it.
- **See backlinks or tags** in the UI. Both endpoints exist; no screen calls them.
- **Log out.** There is no route. Clear the cookie.
- **Render a diagram.** Mermaid and D2 fences round-trip as code and stay code until Phase 4.
- **Talk to an AI or an MCP client.** Phases 5 and 7.

## While you go — the six gates

Stops 7, 8, 11, 9, 9's orphan, and 10 are tasks 10.2, 10.4, 10.6, 10.8, 10.10 and 10.12 of
`openspec/changes/versioning-and-collaboration/tasks.md`: owner-review gates that have never
been passed. Each is a screen that shipped against `docs/UI-CHECKLIST.md` but not against your
eye. When a stop passes, tick its gate; when it does not, write what is wrong in the Review Log
of `docs/UI-CHECKLIST.md`, dated, and the next batch starts there.
