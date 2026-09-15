# Running deep-wiki locally

Everything you need to get from a clean checkout to a signed-in browser, and the routes
once you are there. Written because remembering ports and URLs across three git worktrees
is not a reasonable thing to keep in your head.

If something here disagrees with the code, the code is right and this file is a bug.

---

## 1. The short version

```bash
cp env.example .env            # then read §3 before changing a single port
podman compose up -d --wait    # five services
bun run db:migrate
bun run db:seed                # prints the credentials and URLs it just created
```

Then, in two terminals:

```bash
bun --env-file=.env run -F @deep-wiki/api start   # apps/api, on PORT (3000)
bun run -F @deep-wiki/web dev                     # apps/web, on 3001
```

The two lines differ on purpose. The API needs the file. The web server **must not see it**:
`nuxt dev` reads `PORT` from the environment ahead of `devServer.port`, so
`bun --env-file=.env run -F @deep-wiki/web dev` starts Nuxt on the *API's* port — or, if the
API is already there, on whatever port is free (measured 2026-09-14: `[get-port] Unable to
find an available port (tried 14606 …). Using alternative port 3000.`). Either way `APP_URL`
no longer names the page's origin and sign-in fails the way §3 describes. Do not export `PORT`
in the shell you start the web server from, for the same reason.

Open **`http://localhost:3001/login`** and sign in with:

| | |
| --- | --- |
| Email | `owner@deep-wiki.local` |
| Password | `deep-wiki-dev` |

Those are development-only and deliberately obvious. `SEED_EMAIL` and `SEED_PASSWORD`
override them if you share a machine. The seed is idempotent and **never resets a password
you changed on purpose** — it inserts `ON CONFLICT DO NOTHING`.

`bun run db:seed` also prints the real workspace id and page id it created, so you can paste
a working URL rather than hunt for one:

```
seed: ready
  sign in at /login with  owner@deep-wiki.local  /  deep-wiki-dev
  workspace "Demo workspace" (<uuid>), manage granted at its root
  tree:  /workspaces/<uuid>/tree
  page "Local Development Setup" (<uuid>):
    read:  /pages/<uuid>
    edit:  /pages/<uuid>/edit
```

**Do not pass `--port` to the web server.** It used to be required, and forgetting it is what
broke sign-in for a day — see §3. `apps/web/nuxt.config.ts` now declares `devServer.port`, so
the port is a fact in the repository rather than a flag in your shell history.

---

## 2. Routes

Every screen this branch has. All of them need a session except `/login` and the two
token-bearing screens, because this product has no public pages.

| Route | What it is | Needs |
| --- | --- | --- |
| `/` | Redirects to `/workspaces` — the way in, not a screen of its own | nothing |
| `/login` | Sign in | apps/api + a seeded user |
| `/forgot-password` | Request a reset link | apps/api + Mailpit |
| `/reset-password?token=…` | Set a new password | a token from the mail in Mailpit |
| `/invite/accept?token=…` | Accept a workspace invitation | a token from the mail in Mailpit |
| `/workspaces` | The wikis you can open | a session |
| `/workspaces/new` | Create a workspace — the way in from the list | a session **and an account with a plan**: the seed user has one, an account created by registration or invitation does not (`403 no_plan`; `docs/TODO.md` Open Questions, "Default plan policy") |
| `/workspaces/:workspaceId/tree` | Navigation tree — shelves, books, chapters, pages; create, rename, drag-reorder | a session with read on the workspace |
| `/workspaces/:workspaceId/members` | Members and invitations — the list, and the form that sends an invite | `manage` on the workspace root; anyone else gets the not-found state, deliberately (the API answers "no such workspace" and "not yours to manage" identically). The link to it on the tree renders for everyone — see Open Questions, "Which signal tells the client `manage`" |
| `/admin/registration` | Instance registration mode, allowed domains, SMTP test | Super Root (`users.is_super_root`); anyone else gets the forbidden state. Linked from the app chrome for everyone, for the same reason as Members |
| `/pages/:id` | Read mode — pre-rendered HTML, no editor loaded; comment gutter and thread panel; who is editing | a session with read on the page (`comment` to see threads) |
| `/pages/:id/edit` | Edit mode — ProseMirror, `@` mentions, `/` commands, soft lock, who else is here | a session with write on the page |
| `/pages/:id/history` | Revision history for a page | a session with read on the page |
| `/pages/:id/diff?from=<revisionId>&to=<revisionId>` | Block diff between two revisions — added, removed, modified, moved | a session with read on the page |
| `/books/:id/history` | Changeset history for a book — who changed what, grouped by the changeset window | a session with read on the book |
| `/books/:id/diff?since=<ISO date>[&page=<pageId>]` | Everything that changed in a book since a moment, navigable page to page without returning to the list | a session with read on the book |

Anything else lands on `apps/web/app/error.vue` — the product's own error screen, not Nuxt's.
It distinguishes *not found* from *the server failed*, and its recovery action comes out of
the address you typed: a workspace id in the URL offers that workspace, a page id offers that
page, and anything else offers `/workspaces`. It never claims to know whether you are signed
in, because it cannot — see §6.

### The API

Every route apps/api mounts, read off `apps/api/src/index.ts` and `apps/api/src/routes/*.ts`
on 2026-09-14 (`scripts/checks/routes-mounted.ts` fails `bun run check` if a route module
exists that `index.ts` does not mount, so this list can only go stale by a route being
*added*). All are on `PORT` (3000 by default). All except `/health`, `/auth/*` and
`/invitations/accept` require the session cookie (`401` without it — measured); "not found"
below means the deliberate `404` that covers both "no such thing" and "not yours", so that
no route answers whether a thing exists.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{"status":"ok"}` — the only unauthenticated read |
| POST | `/auth/login` | Sets an HttpOnly session cookie; no token in the body |
| POST | `/auth/register` | Subject to the instance registration mode; `403` in `closed` and `invitation_only` before the address is looked up |
| POST | `/auth/password-reset` | Always the same response whether or not the account exists; the mail is handed off, never awaited |
| POST | `/auth/password-reset/confirm` | Single-use, expiring token |
| GET | `/admin/instance-settings` | Super Root only. What `/admin/registration` renders; reading reconciles a stale SMTP verification and says so |
| PUT | `/admin/registration-mode` | Super Root only |
| PUT | `/admin/registration-domains` | Super Root only |
| POST | `/admin/smtp-test` | Super Root only |
| POST | `/invitations` | Create an invitation — `manage` on the workspace root, else not found |
| POST | `/invitations/accept` | Redeem one; creates the account (with no plan — see `/workspaces`) |
| POST | `/uploads/avatar` | Validated, resized, scoped to the caller's workspace |
| GET | `/workspaces` | The workspaces you can open |
| POST | `/workspaces` | Create one; the creator gets `manage` on its root in the same transaction. `403 no_plan` for an account without a plan, `403` with the plan's name and limit when it is full |
| GET | `/workspaces/:id/members` | `manage` on the root, else not found |
| GET | `/workspaces/:id/tree` | Permission-filtered node tree |
| POST | `/nodes` | Create a shelf, book, chapter or page under a parent |
| PATCH | `/nodes/:id` | Rename |
| PATCH | `/nodes/:id/position` | Drag-reorder and re-parent |
| GET / PUT | `/pages/:id` | Read (with the workspace's name) and save, behind `can()` and optimistic concurrency; `409` with `canonical` for non-canonical markdown, `409` with `corrected` for a reintroduced dead anchor |
| GET | `/pages/:id/edit-session` | What edit mode opens with — acquires the soft lock |
| PATCH | `/pages/:id/lock` | Soft-lock heartbeat; the one place presence is published from. The interval is `PAGE_LOCK_HEARTBEAT_SECONDS`; boot refuses a `.env` whose `PAGE_LOCK_TTL_SECONDS` is less than twice it |
| POST | `/pages/:id/lock/take-over` | Soft-lock take-over |
| GET | `/pages/:id/history` | Revisions, newest first |
| GET | `/books/:id/history` | Changesets in a book, newest first, with the book's name |
| GET | `/pages/:id/diff?from=&to=` | Block diff between two revision ids — added, removed, modified, moved, with block text |
| GET | `/books/:id/diff?since=` | Every page changed in the book since an ISO instant, each with its diff. Page order is the database's, not a declared one (`docs/TODO.md` Findings 2026-09-14) |
| GET | `/pages/:id/backlinks` | Index lookup over `links`; no screen calls it yet |
| GET | `/pages/:id/comments` | Threads, replies, resolution and anchor status — what the read screen fetches. `read` to reach it; without `comment` the response is indistinguishable from a page with no comments |
| GET | `/pages/:id/comments/indicators` | Anchored-thread counts per block. Mounted and tested; the client derives its own from `/comments` instead |
| POST | `/pages/:id/comments` | A root thread (`blockId`, `quote`, offsets) or a reply (`parentId`); mints the block's persisted anchor if it has none; mentions go out over `MailSender` only to people who can read the page |
| PATCH | `/comments/:threadId/resolved` | |
| GET | `/mentions/pages` | Autocomplete, filtered by what the caller can read |
| GET | `/mentions/subjects` | Users and cells, same rule |
| GET | `/pages/:id/mentions/:userId/check` | Can this person be mentioned into this page |
| GET | `/tags/:name/pages` | No screen calls it, and there is no tag *listing* route |
| GET | `/workspaces/:workspaceId/presence/stream` | Server-sent events: who is editing what. Membership opens the stream; each event is dropped unless the subscriber can read that page |

The API answers `OPTIONS` preflights for `GET, POST, PUT, PATCH, DELETE` from `APP_URL` only —
measured 2026-09-14 (`204`, `Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS`).
`PATCH` was missing until `a4bec8c`, and no route test could see it: `app.request()` never
preflights.

`/ai/credentials` is **not** here — it lives on the `ai-provider-foundation` branch.

---

## 3. Ports — the part that actually goes wrong

Several variables hold the same fact, and **only `bun run env:check` compares them**. This has
broken five separate times in this project. If something is unreachable, or if a screen tells
you the server cannot be reached while the server is plainly running, check this before
anything else.

| If you change… | You must also change… |
| --- | --- |
| `POSTGRES_HOST_PORT` | the port inside `DATABASE_URL` |
| `MAILPIT_SMTP_HOST_PORT` | `SMTP_PORT` |
| `PORT` (where apps/api listens) | the port inside `NUXT_PUBLIC_API_BASE_URL` |
| `devServer.port` in `apps/web/nuxt.config.ts` | the port inside `APP_URL` |

```bash
bun run env:check    # names both values when a pair disagrees
```

It reads **`env.example` and your `.env`**, so a wrong shipped default fails even on a clone
that has no `.env` yet.

### `APP_URL` is the one that blames the wrong thing

The other three fail loudly *and honestly*: the connection is refused, or it lands on some
other project's service and *that* service complains. `APP_URL` fails loudly and points you
somewhere the fault is not.

`apps/api` installs `cors({ origin: APP_URL, credentials: true })`, so the API allows exactly
one origin through CORS with credentials. Name a different one and the browser refuses the
credentialed sign-in request **before the page ever sees a response**: Chromium logs
`net::ERR_FAILED`, Firefox `NS_ERROR_DOM_BAD_URI`, the `fetch` rejects, no cookie is stored,
and the sign-in form shows

> Could not reach the server. Check your connection and try again.

There is no `200 OK` to go looking for, because the request is refused rather than answered.
That is what makes this worse than a silent failure: the screen blames the connection, the
connection is fine, and neither server logs a word about CORS — so you go and check the
network, the API process, the containers, everything except the one line that is wrong.
Measured 2026-09-09 in both browsers against a live stack; until then this section said the
opposite, and the afternoon that cost is the reason it now says this.

So `APP_URL` is the browser's origin for **apps/web**, never the API's. It is also the host of
the `/reset-password` and `/invite/accept` links sent by mail, so pointing it at the API's port
mails dead links as well.

### The two port sets, and why they are different

**The dev stack** — five containers from the root `compose.yaml`, plus two host processes:

| Service | Default | What for |
| --- | --- | --- |
| Postgres + pgvector | 5432 | The database |
| Mailpit SMTP | 1025 | Where the app sends mail |
| Mailpit web UI | 8025 | **Where you read it** — reset and invite links arrive here |
| MinIO | 9000 / 9001 | S3-compatible blob storage |
| Kroki + Mermaid | 8000 | Server-side diagram rendering |
| apps/api | 3000 | `PORT` in `.env` |
| apps/web | 3001 | `devServer.port` in `apps/web/nuxt.config.ts` |

The container ports come from the environment with those conventional defaults
(`${POSTGRES_HOST_PORT:-5432}`), so a fresh clone needs no configuration and a busy machine can
move them in `.env` without editing a tracked file. `podman compose up` fails on a collision
**before any service starts**.

**The test harness** publishes a *completely separate* set, and they are not interchangeable —
see §4.

To see a reset or invitation link end to end, open Mailpit's web UI at
`http://localhost:8025`. The mail really is sent.

---

## 4. Worktrees, and why the harness ports are not the dev ports

Feature branches live in sibling worktrees under `deep-wiki2-worktrees/`. `content-and-editor`
is merged into `main`, so every screen in §2 runs from the main checkout; only
`ai-provider-foundation` is still outstanding. Each worktree derives its own harness ports,
compose project names and MinIO bucket **from the absolute path of its own worktree**
(`packages/db/testing/worktree.ts`), so two worktrees can run their suites at the same time
without destroying each other's containers. Nothing to configure.

```bash
bun run packages/db/testing/worktree.ts    # prints this worktree's derived values
```

The main checkout is slot 0 and keeps the values the harness has always used. Every linked
worktree gets a contiguous block of 8 ports from 13000 up, chosen by a hash of its path:

| Worktree | Branch | Postgres | Mailpit | MinIO | e2e API | e2e web |
| --- | --- | --- | --- | --- | --- | --- |
| `deep-wiki2` | `main` | 55432 | 11025 / 18025 | 19000 / 19001 | 4000 | 4173 |
| `deep-wiki2-worktrees/content-editor` | `content-and-editor` | 13144 | 13145 / 13146 | 13147 / 13148 | 13149 | 13150 |
| `deep-wiki2-worktrees/ai-provider` | `ai-provider-foundation` | 14816 | 14817 / 14818 | 14819 / 14820 | 14821 | 14822 |

Run the command above rather than trusting that table: it is derived, and it will be right
after any worktree is added, moved or removed.

**These are the test harness's ports, and nothing else's.** They belong to
`bun run test` and `bun run e2e`. They are not the dev stack's, they hold a *different,
disposable database*, and they are torn down and recreated by the suites at will. The dev
ports in §3 are the ones you browse. Confusing the two is trap 3 in §6.

A fresh worktree needs its own `bun install` — about 35 seconds.

---

## 5. Commands

Run from the repository root.

| Command | What it does |
| --- | --- |
| `bun run typecheck` | Every workspace member plus the root scripts |
| `bun run lint` | ESLint across the repository |
| `bun run test` | Every package and app, plus the check scripts' own tests. `packages/db` auto-provisions a disposable Postgres |
| `bun run check` | The structural guard rail — what `.githooks/pre-commit` runs |
| `bun run verify` | Every gate, `e2e` included. Run it before tagging a milestone |
| `bun run env:check` | Compares `env.example` and your `.env` against compose and the dev-server port |
| `bun run db:migrate` / `bun run db:seed` | Schema and development data |
| `bun run e2e` | Playwright, against a real backend on this worktree's harness ports |
| `bun run e2e:install` | Downloads the browser Playwright needs (once per machine) |
| `bun run check:bundle` | Proves read mode never pulls in the editor bundle |
| `bun run gate-2-round-trip` | Markdown → ProseMirror → markdown must be lossless |
| `bun run compose:smoke` | Proves the container stack actually works, not just that it started |
| `bun run setup:hooks` | Points git at `.githooks` — do this once per clone |

`bun run check` deliberately excludes `env:check`: `.env` is your machine's state, not the
repository's, and blocking a docs commit over a local misconfiguration is over-reach.

---

## 6. Things that will confuse you once

These four have each cost real time. They are in the order you are likely to meet them.

### 1. A stale `.env` fails at boot naming a variable you have never heard of

`CHANGESET_WINDOW_MINUTES` has **no default in the schema**, on purpose: the number lives in
`env.example` and nowhere else, so there is no second copy to go stale. The cost is that a
`.env` copied before that variable existed makes `apps/api` refuse to start.

The error names the variable and points at `env.example`. The fix is to copy that one line
across — not to invent a value. The same is true of anything else `env.example` gained since
you last copied it; `bun run check` fails if the template and the schema ever disagree.

### 2. Sign-in says it cannot reach the server, and the server is running

This is `APP_URL` naming an origin that is not where `apps/web` is actually serving. Read §3.
It shipped this way: `env.example` carried `APP_URL=http://localhost:4173` while `nuxt dev`
listened on 3000, so a fresh clone could not sign in at all. `bun run env:check` now catches
it, and `devServer.port` gives `APP_URL` something to be checked against.

The form shows *"Could not reach the server. Check your connection and try again."* and it is
lying to you by accident: the browser refused the credentialed cross-origin request itself, so
neither server logged anything and there is nothing wrong with your connection. If the API is
up, `curl` reaches it, and the sign-in screen still says that sentence — check `APP_URL`
before you touch the network or the session code.

### 3. You are browsing a leftover e2e server, and it is showing you another database

The e2e harness starts its own `apps/web` and `apps/api` on this worktree's derived ports
(§4), against its own **disposable, separately-seeded** database. Both `bun run e2e` and a
killed Playwright run can leave those servers up, and `reuseExistingServer` means the next run
happily adopts them.

The symptom is a wiki that renders perfectly and contains the wrong content — pages you did
not create, or your own pages missing. Check the port in your address bar. If it is in the
13000s, or 4173 in the main checkout, you are on the harness, not on your dev stack. The dev
web server is on **3001**.

`podman ps` will also show harness containers you did not start: the suites keep them alive
between runs on purpose.

### 4. `env.example` is a template, not your machine

`env.example` is committed, and every developer copies it. It is therefore the one file whose
ports must stay the *conventional* ones — 5432, 1025, 3000 — even when your machine cannot use
them. Move your own ports in `.env`, which is gitignored and exists for exactly this.

This has leaked twice, both times by editing the template while debugging and committing it by
habit. If you find `env.example` carrying a port like 25432 or 4400, that is somebody's laptop,
and it should be reverted rather than accommodated.

### And a few smaller ones

- **`bun run test` provisions containers.** Set `DEEPWIKI_TEST_NO_AUTOSTART=1` to opt out and
  fail fast instead. It also leaves them running for reuse.
- **`podman-compose` is unsafe under concurrent invocation against one project.** Parallel test
  files racing to provision produce failures on `podman network create` that look like
  application bugs. Re-run serially before believing them.
- **This host has 4 cores.** `apps/web`'s Nuxt suites exceed their 60-second startup budget
  under load. Run that package's tests in isolation before treating a timeout as real.
- **There is no git remote**, so `.github/workflows/ci.yml` never executes. Enforcement is
  local: `bun run check` on every commit, `bun run verify` before tagging.
- **Never `pkill -f "nuxt dev"`** — or `pkill -f` anything broad. It reaches other projects'
  dev servers on this machine, and other agents' on this checkout (§7). Find the pid with
  `ss -ltnp | grep :<port>` and kill that one.
- **Nuxt refuses a second `nuxt dev` for the same checkout** ("Another Nuxt dev is already
  running"), which is a lock in `apps/web/.nuxt/nuxt.lock`, not a port collision. If the
  first one is yours, kill it by pid; if it is not, you need a second worktree (§7).

---

## 7. Working beside another agent or session

Several agents worked this checkout at once on 2026-09-14. Each rule below cost a sibling
its work, which is why it is a rule and not advice; the incidents are in `docs/TODO.md`,
Findings of that date, and the first four are non-negotiables in `CLAUDE.md`.

**Never kill a process you did not start.** Three times in one session a `pkill -f <pattern>`
matched another agent's dev server or test run and killed it mid-flight. Record the pid when
you spawn something, or find the listener with `ss -ltnp | grep :<port>`, and kill that one.
And remember that killing the `bun run -F` wrapper leaves the real server running — measured
again that day: the wrapper died and `nuxt dev` kept the port, reparented to pid 1.

**Never `git add -A`, and `git diff --cached` before every commit.** `-A` staged another
agent's half-written files under a message that described none of them. The quieter version:
`git add` on a package's `src/index.ts` staged a sibling's hunk in the same barrel, because a
barrel is the one file every change in a package touches. Add the paths you changed, read the
staged diff, and `git add -p` any shared file that carries hunks that are not yours.

**Never `git stash` on a shared tree.** A stash takes every uncommitted change in the checkout,
not "yours". One agent stashed to get a clean tree and dropped the stash afterwards; a
sibling's completed task went with it and was rewritten from scratch. If you need a clean
tree, you need your own worktree — see §4.

**`git commit -F <file>`, never `-m "…"` with backticks.** A message that quoted a command in
backticks inside double quotes had the command substituted by the shell; the quoted command
was the e2e suite, and a full Playwright run started as a side effect of committing.

Three environment facts that read as application bugs when you meet them beside someone
else's work:

- **One `nuxt dev` per checkout.** The lock is per checkout, not per port, so
  `DEEPWIKI_TEST_SLOT` — which moves every port the harness uses — does not route around it.
  `bun run e2e` refuses to start while a foreign lock is live and names it (`scripts/e2e.ts`).
  A second dev server or a second e2e run means a second worktree.
- **`podman compose up --wait`'s exit code is not the health signal.** It has been observed
  returning `125` with every container healthy, and `0` on other days including the bring-up
  that verified this file. Read `podman ps` for `(healthy)`; never run `podman compose` for a
  project while another invocation for the same project may be in flight — `podman-compose`
  is unsafe under concurrent invocation (§6).
- **`expect(sql\`…\`).rejects` hangs `bun test`, and `bun test` does not typecheck.** A
  postgres.js query is a thenable, not a native Promise, and `.rejects` never settles on it —
  `packages/db/src/schema.test.ts` carries `assertRejects()` for exactly this. And a green
  `bun test` says nothing about types: `bun run typecheck` is its own gate, and a shape that
  drifts (as `SeedResult` did) passes every test until something reads `undefined`.

The bring-up in §1 — compose up, migrate, seed, API start, web dev — and the route probes
this file cites were run on 2026-09-14 against a fresh copy of `env.example` moved to a
private port block (14600–14606) under a private compose project name (`podman compose
--env-file <copy> -p <name> up -d --wait`, so the owner's `.env` and stack were never
touched), then torn down with `podman compose --env-file <copy> -p <name> down -v`. That is
also how to verify this file without disturbing whoever else is on the machine. If you
change a command here, run it first.
