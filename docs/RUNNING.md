# Running deep-wiki locally

Everything you need to get from a clean checkout to a signed-in browser, and the routes
once you are there. Written because remembering ports and URLs across three git worktrees
is not a reasonable thing to keep in your head.

If something here disagrees with the code, the code is right and this file is a bug.

---

## 1. The short version

```bash
cp env.example .env            # then fix the ports — see §3, this is where people trip
podman compose up -d --wait    # five services
bun run db:migrate
bun run db:seed                # prints the credentials and URLs it just created
```

Then, in two terminals:

```bash
bun --env-file=.env run -F @deep-wiki/api start
bun run -F @deep-wiki/web dev -- --port 4173
```

Open `http://localhost:4173/login`.

The seed prints the sign-in credentials it creates. They are development-only and
deliberately obvious. `SEED_EMAIL` and `SEED_PASSWORD` override them if you share a machine.

---

## 2. Routes

| Route | What it is | Where it lives |
| --- | --- | --- |
| `/` | Bootstrap smoke page — proves the shell boots and can reach the API | `main` |
| `/login` | Sign in | `main` |
| `/forgot-password` | Request a reset link | `main` |
| `/reset-password?token=…` | Set a new password | `main` |
| `/invite/accept?token=…` | Accept a workspace invitation | `main` |
| `/workspaces/:workspaceId/tree` | Navigation tree — shelves, books, chapters, pages | `content-and-editor` |
| `/pages/:id` | Read mode — pre-rendered HTML, no editor loaded | `content-and-editor` |
| `/pages/:id/edit` | Edit mode — ProseMirror, `@` mentions, `/` commands, soft lock | `content-and-editor` |

The last three are **not on `main` yet**. To see them, run from the worktree — see §4.

The seed prints a real workspace id and page id, so you can paste a URL rather than
hunting for one.

### The API

| Route | Method | Notes |
| --- | --- | --- |
| `/health` | GET | Returns `{"status":"ok"}` |
| `/auth/login` | POST | Sets an HttpOnly session cookie; no token in the body |
| `/auth/password-reset` | POST | Always 202 — the response is identical whether or not the account exists |
| `/auth/password-reset/confirm` | POST | Single-use, expiring token |
| `/invitations/*` | | Create, read, accept |
| `/pages/:id` | GET / PUT | Read and save, behind `can()` and optimistic concurrency |
| `/pages/:id/lock` | | Heartbeat and take-over for the soft lock |
| `/links`, `/tags`, `/mentions` | GET | All filtered through `can()`; they disclose nothing |
| `/tree/:workspaceId` | GET | Permission-filtered node tree |
| `/ai/credentials` | | BYOK storage, on the `ai-provider-foundation` branch |

---

## 3. Ports — the part that actually goes wrong

Two variables hold the same fact and **nothing but `bun run env:check` compares them**.
This has broken four separate times in this project. If a service is unreachable, check
this before anything else.

| If you change… | You must also change… |
| --- | --- |
| `POSTGRES_HOST_PORT` | the port inside `DATABASE_URL` |
| `MAILPIT_SMTP_HOST_PORT` | `SMTP_PORT` |
| `PORT` (where the API listens) | the port inside `NUXT_PUBLIC_API_BASE_URL` |

`APP_URL` is the **browser's** origin for `apps/web` — the Nuxt dev server, not the API.
It is the CORS allowlist entry and the host of the reset and invitation links sent by
mail. Pointing it at the API's port breaks sign-in and mails dead links.

```bash
bun run env:check    # names both values when a pair disagrees
```

The published compose ports default to the conventional 5432 / 1025 / 8025 / 9000 / 9001 /
8000. `podman compose up` fails on a port collision **before any service starts**, so on a
machine already running another project, move them in `.env`.

Once the stack is up:

| Service | Default | What for |
| --- | --- | --- |
| Postgres + pgvector | 5432 | The database |
| Mailpit SMTP | 1025 | Where the app sends mail |
| Mailpit web UI | 8025 | **Where you read it** — reset and invite links arrive here |
| MinIO | 9000 / 9001 | S3-compatible blob storage |
| Kroki + Mermaid | 8000 | Server-side diagram rendering |

To see a reset or invitation link end to end, open Mailpit's web UI. The mail really is sent.

---

## 4. Worktrees

Two feature branches live in sibling worktrees under `deep-wiki2-worktrees/`. **Each derives
its own harness ports and compose project name from its path**, so their stacks cannot
collide with each other or with the main checkout. Nothing to configure.

```bash
bun run packages/db/testing/worktree.ts    # prints this worktree's derived values
```

| Worktree | Branch | API | Web |
| --- | --- | --- | --- |
| `deep-wiki2` | `main` | 4000 | 4173 |
| `deep-wiki2-worktrees/content-editor` | `content-and-editor` | 13149 | 13150 |
| `deep-wiki2-worktrees/ai-provider` | `ai-provider-foundation` | 14821 | 14822 |

A fresh worktree needs its own `bun install` — about 35 seconds.

To review the Phase 2 screens today, run the whole sequence from §1 inside
`deep-wiki2-worktrees/content-editor`, using `--port 13150` for the web server.

---

## 5. Commands

| Command | What it does |
| --- | --- |
| `bun run typecheck` | Every workspace member plus the root scripts |
| `bun run lint` | ESLint across the repository |
| `bun run test` | Every package and app. `packages/db` auto-provisions a disposable Postgres |
| `bun run check` | The structural guard rail — what `.githooks/pre-commit` runs |
| `bun run verify` | Every gate. Run it before tagging a milestone |
| `bun run env:check` | Compares your `.env`'s ports against what compose publishes |
| `bun run db:migrate` / `db:seed` | Schema and development data |
| `bun run compose:smoke` | Proves the container stack actually works, not just that it started |

---

## 6. Things that will confuse you once

- **`bun run test` provisions containers.** Set `DEEPWIKI_TEST_NO_AUTOSTART=1` to opt out and
  fail fast instead. It also leaves them running for reuse, so `podman ps` may show more than
  you started.
- **`podman-compose` is unsafe under concurrent invocation against one project.** Parallel
  test files racing to provision produce failures on `podman network create` that look like
  application bugs. Re-run serially before believing them.
- **This host has 4 cores.** `apps/web`'s Nuxt suites exceed their 60-second startup budget
  under load. Run that package's tests in isolation before treating a timeout as real.
- **There is no git remote**, so `.github/workflows/ci.yml` never executes. Enforcement is
  local: `bun run check` on every commit, `bun run verify` before tagging.
- **Never `pkill -f "nuxt dev"`.** It reaches other projects' dev servers on this machine.
  Find the pid with `ss -ltnp | grep :<port>` and kill that one.
