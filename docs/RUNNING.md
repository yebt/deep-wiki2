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
| `/workspaces/:workspaceId/tree` | Navigation tree — shelves, books, chapters, pages | a session with read on the workspace |
| `/pages/:id` | Read mode — pre-rendered HTML, no editor loaded | a session with read on the page |
| `/pages/:id/edit` | Edit mode — ProseMirror, `@` mentions, `/` commands, soft lock | a session with write on the page |
| `/pages/:id/history` | Revision history for a page | a session with read on the page |

Anything else lands on `apps/web/app/error.vue` — the product's own error screen, not Nuxt's.
It distinguishes *not found* from *the server failed*, and its recovery action comes out of
the address you typed: a workspace id in the URL offers that workspace, a page id offers that
page, and anything else offers `/workspaces`. It never claims to know whether you are signed
in, because it cannot — see §6.

### The API

Every route apps/api mounts. All are on `PORT` (3000 by default) and all except `/health`,
`/auth/*` and `/invitations/accept` require the session cookie.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{"status":"ok"}` — the only unauthenticated read |
| POST | `/auth/login` | Sets an HttpOnly session cookie; no token in the body |
| POST | `/auth/register` | Subject to the instance registration mode |
| POST | `/auth/password-reset` | Always the same response whether or not the account exists |
| POST | `/auth/password-reset/confirm` | Single-use, expiring token |
| PUT | `/admin/registration-mode` | Super Root only |
| PUT | `/admin/registration-domains` | Super Root only |
| POST | `/admin/smtp-test` | Super Root only |
| POST | `/invitations` | Create an invitation |
| POST | `/invitations/accept` | Redeem one |
| POST | `/uploads/avatar` | |
| GET / PUT | `/pages/:id` | Read and save, behind `can()` and optimistic concurrency |
| GET | `/pages/:id/edit-session` | What edit mode opens with |
| PATCH | `/pages/:id/lock` | Soft-lock heartbeat |
| POST | `/pages/:id/lock/take-over` | Soft-lock take-over |
| GET | `/pages/:id/history` | Revisions |
| GET | `/pages/:id/diff` | Page diff |
| GET | `/books/:id/diff` | Changeset (book-level) diff |
| GET | `/pages/:id/backlinks` | |
| GET | `/pages/:id/comments/indicators` | |
| POST | `/pages/:id/comments` | |
| PATCH | `/comments/:threadId/resolved` | |
| GET | `/mentions/pages` | |
| GET | `/mentions/subjects` | |
| GET | `/pages/:id/mentions/:userId/check` | |
| GET | `/tags/:name/pages` | |
| GET | `/workspaces` | The workspaces you can open |
| GET | `/workspaces/:id/tree` | Permission-filtered node tree |
| PATCH | `/nodes/:id/position` | Tree reorder |
| GET | `/workspaces/:workspaceId/presence/stream` | Server-sent events |

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
- **Never `pkill -f "nuxt dev"`.** It reaches other projects' dev servers on this machine. Find
  the pid with `ss -ltnp | grep :<port>` and kill that one.
- **Nuxt refuses a second `nuxt dev` for the same project** ("Another Nuxt dev is already
  running"), which is a lock, not a port collision. Kill the first one.
