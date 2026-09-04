# Design: Tenancy and Permissions (Phase 1)

## Technical Approach

Three structural moves carry this change.

1. **The workspace is a node.** `nodes` gains a `workspace` root row per workspace. Every permission resource is then a real row in one table, the resource foreign key becomes unconditional, and the resolver loses its "is this the workspace level?" special case entirely.
2. **Cross-tenant isolation is a foreign key, not a `WHERE` clause.** `nodes` carries `UNIQUE (id, workspace_id)`; children, permissions and cell grants reference *that* pair. A row that crosses a tenant boundary cannot be inserted, so the resolver is not the last line of defence.
3. **Precedence is a pure function; row-gathering is SQL.** `packages/db` runs one `WITH RECURSIVE` that returns at most ten `(effect, depth)` pairs. `packages/core` folds them. The precedence rule therefore exists in exactly one place, is framework-free, and is exhaustively unit-testable with no database.

Path handling follows the superseding engine decision: `text` materialised path with `text_pattern_ops`, **no `ltree`, no GiST**. Recursive CTEs are retained and load-bearing.

---

## The `nodes` path encoding

| Question | Answer |
|---|---|
| Delimiter | `/`, both **leading and trailing**: `/{ws}/{shelf}/{book}/{chapter}/{page}/` |
| Ids or slugs | **Ids.** Slugs are mutable — a rename would rewrite a subtree for a cosmetic edit — and are only unique per parent. UUIDs are immutable and fixed width, which is what bounds the length |
| Self-inclusive | Yes. `descendants(n) = path LIKE n.path ‖ '%'`; strict descendants add `AND id <> n.id` |
| Why the trailing `/` | It makes prefix containment exact independently of the id format. `/a/b` would prefix-match `/a/bc`; `/a/b/` cannot match `/a/bc/` |
| Length bound | 5 levels max × 37 chars + 1 = **186**. Enforced by `CHECK (char_length(path) <= 256)` |
| Shape | Enforced by `CHECK (path ~ '^(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})+/$')`. Lowercase-only, so no `ILIKE` is ever needed and no `%`/`_` can ever appear in a pattern |
| Who writes it | **Only the `nodes_set_path` trigger.** Application code never supplies `path`; it is derived from `parent_id` on insert and on parent change |
| Index | `CREATE INDEX nodes_ws_path_idx ON nodes (workspace_id, path text_pattern_ops)` |

`text_pattern_ops` is not optional decoration: the database runs a non-`C` collation, and a plain `btree(path)` will **not** serve `LIKE 'prefix%'` there. That is the sharpest edge of the `text` path and the reason the index test exists.

### Reparent — subtree rewrite and its concurrency guard

```sql
BEGIN;
  SELECT id FROM workspaces WHERE id = $ws FOR UPDATE;        -- 1. serialise moves per workspace
  -- 2. cycle check, inside the lock: the new parent must not be a descendant
  --    (and must be a legal parent type for the moved node's type)
  -- 3. capture $oldPrefix := moved.path
  UPDATE nodes SET parent_id = $newParent WHERE id = $moved;   -- 4. trigger recomputes moved.path
  UPDATE nodes                                                  -- 5. uniform prefix substitution
     SET path = $newPrefix || substring(path FROM char_length($oldPrefix) + 1),
         updated_at = now()
   WHERE workspace_id = $ws
     AND path LIKE $oldPrefix || '%'
     AND id <> $moved;
COMMIT;
```

Step 5 is a **uniform** substitution, so row-visit order is irrelevant — every descendant still carries the whole old prefix at the moment the statement runs. The trigger deliberately fires only on `INSERT` or `parent_id IS DISTINCT FROM OLD.parent_id`, so step 5 does not fight it. Steps 4 and 5 in either order would corrupt the tree if `$oldPrefix` were read late; it is captured in step 3.

The `FOR UPDATE` on the workspace row is a **portable** row lock, deliberately chosen over `pg_advisory_xact_lock` under the engine cost test. The same pattern is reused for the plan workspace-count limit, so there is one concurrency idiom in this change, not two.

**Integrity is asserted, not assumed.** `verifyPaths()` (`packages/db/src/nodes/verify-paths.ts`) runs a `WITH RECURSIVE` that recomputes every path from `parent_id` and returns mismatching rows. Every move test asserts it returns empty, and `bun run -F @deep-wiki/db verify:paths` exposes it as an operational repair check.

---

## Schema

All ids are `uuid` (`gen_random_uuid()`, built in on PG13+, no extension). All timestamps `timestamptz not null`.

**Enums** — `node_type(workspace, shelf, book, chapter, page)`, `subject_kind(user, cell, role, agent)`, `perm_action(read, comment, write, manage)`, `perm_effect(allow, deny)`, `registration_mode(closed, invitation_only, open)`.

| Table | Key columns | Constraints and indexes |
|---|---|---|
| `plans` | `name`, `max_workspaces`, `max_seats`, `max_storage_bytes`, `max_ai_tokens_monthly` | `UNIQUE (name)`. Authored by Super Root |
| `users` | `email`, `password_hash`, `display_name`, `avatar_key`, `plan_id`, `is_super_root` | `CHECK (email = lower(email))`, `UNIQUE (email)`. No `citext` extension — normalisation is a pure function in core |
| `workspaces` | `owner_id`, `name`, `slug`, `settings jsonb` | `UNIQUE (slug)`, index `(owner_id)` |
| `nodes` | `workspace_id`, `parent_id`, `type`, `path`, `position`, `slug`, `title` | `UNIQUE (id, workspace_id)`; `FK (parent_id, workspace_id) → nodes(id, workspace_id) ON DELETE CASCADE`; `CHECK ((parent_id IS NULL) = (type = 'workspace'))`; unique partial index `(workspace_id) WHERE type='workspace'`; `UNIQUE (parent_id, slug)`; path CHECKs above; `(workspace_id, path text_pattern_ops)`; `(workspace_id, parent_id, position)` |
| `cells` | `workspace_id`, `name` | `UNIQUE (id, workspace_id)`, `UNIQUE (workspace_id, name)` |
| `cell_members` | `cell_id`, `user_id`, `workspace_id` | PK `(cell_id, user_id)`; `FK (cell_id, workspace_id) → cells`; index `(workspace_id, user_id) INCLUDE (cell_id)` |
| `permissions` | `workspace_id`, `subject_type`, `subject_id`, `resource_id`, `action`, `effect` | see below |
| `invitations` | `workspace_id`, `email`, `token_hash`, `invited_by`, `starting_action`, `starting_cell_id`, `expires_at`, `accepted_at`, `revoked_at` | `UNIQUE (token_hash)`; unique partial `(workspace_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL` |
| `sessions` | `user_id`, `token_hash`, `idle_expires_at`, `absolute_expires_at`, `last_seen_at`, `revoked_at`, `user_agent`, `ip` | `UNIQUE (token_hash)`, index `(user_id)` |
| `password_resets` | `user_id`, `token_hash`, `expires_at`, `consumed_at` | `UNIQUE (token_hash)`, index `(user_id)` |
| `instance_settings` | `registration_mode`, `open_registration_domains text[]`, `smtp_verified_at` | `id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1)` — single row |

**`resource_type` is dropped as a stored column.** It is `nodes.type` of `resource_id`, so storing it a second time creates a value that can disagree with the tree. The resolver reads the node's own type when it needs it.

### `permissions` — structural tenant isolation

```sql
permissions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  subject_type subject_kind not null,
  subject_id   uuid not null,
  resource_id  uuid not null,
  action       perm_action not null,
  effect       perm_effect not null,

  -- generated columns exist only to carry a composite FK per subject kind
  subject_cell_id  uuid generated always as
    (case when subject_type = 'cell'  then subject_id end) stored,
  subject_agent_id uuid generated always as
    (case when subject_type = 'agent' then subject_id end) stored,

  foreign key (resource_id, workspace_id)
    references nodes (id, workspace_id) on delete cascade,
  foreign key (subject_cell_id, workspace_id)
    references cells (id, workspace_id) on delete cascade,
  unique (workspace_id, subject_type, subject_id, resource_id, action)
);

create index permissions_lookup_idx on permissions
  (workspace_id, resource_id, subject_type, subject_id, action, effect);
```

Composite FKs on a nullable pair are `MATCH SIMPLE`, so they are inert for the kinds they do not apply to — which is exactly the wanted behaviour. `subject_agent_id` is created now and its FK target lands with the `agents` table in Phase 7; adding the FK later is a one-line migration rather than a table rewrite.

**Isolation therefore holds at three structural points**: a node cannot parent across workspaces, a grant cannot name a resource outside its workspace, and a grant cannot name a cell outside its workspace. The resolver's workspace filter is defence in depth, not the boundary itself. `workspace_id` is derived from the authenticated subject and the resolved resource, **never read from a request body** (GATE-3's prerequisite).

---

## The permission resolver

### Pure half — `packages/core/src/permissions/`

```ts
export type Action = 'read' | 'comment' | 'write' | 'manage';
export type Effect = 'allow' | 'deny';

/** depth 0 = the resource itself; larger = further up the ancestor chain. */
export interface ResolvedGrant { readonly depth: number; readonly effect: Effect; }

/** allow(X) covers every action <= X; deny(X) covers every action >= X. */
export function impliedAllowActions(requested: Action): readonly Action[];
export function impliedDenyActions(requested: Action): readonly Action[];

/** Total. No grants -> deny. Smallest depth wins; deny wins at equal depth. */
export function decide(grants: readonly ResolvedGrant[]): Effect;

export interface GrantLookup {
  (q: GrantQuery): Promise<readonly ResolvedGrant[]>;   // the port
}
export function can(lookup: GrantLookup, q: GrantQuery): Promise<boolean>;
```

The action lattice lives here rather than in SQL so the resolver does not depend on Postgres enum declaration order. `deny(X)` covering every action **above** X encodes the only coherent reading: denying `read` must deny `write`, because you cannot write what you may not read.

Imports: none. `packages/core` stays framework-free and the purity check is unaffected.

### SQL half — `packages/db/src/permissions/resolver.ts`

```sql
WITH RECURSIVE ancestors AS (
    -- depth 0 = the resource itself, walked through the AUTHORITATIVE
    -- parent_id edge, never through the derived path cache.
    SELECT n.id, n.workspace_id, n.parent_id, 0 AS depth
      FROM nodes n
     WHERE n.id = $resource_id
    UNION ALL
    SELECT p.id, p.workspace_id, p.parent_id, a.depth + 1
      FROM nodes p
      JOIN ancestors a ON p.id = a.parent_id
     WHERE p.workspace_id = a.workspace_id
),
subjects AS (
    -- the subject set, expanded INSIDE the resource's own workspace
    SELECT $subject_type::subject_kind AS subject_type, $subject_id::uuid AS subject_id
    UNION ALL
    SELECT 'cell'::subject_kind, cm.cell_id
      FROM cell_members cm
     WHERE $subject_type::subject_kind = 'user'
       AND cm.user_id = $subject_id::uuid
       AND cm.workspace_id = (SELECT workspace_id FROM nodes WHERE id = $resource_id)
)
SELECT DISTINCT p.effect, a.depth
  FROM permissions p
  JOIN ancestors a ON a.id = p.resource_id
                  AND a.workspace_id = p.workspace_id
  JOIN subjects  s ON s.subject_type = p.subject_type
                  AND s.subject_id   = p.subject_id
 WHERE (p.effect = 'allow' AND p.action = ANY($allow_actions::perm_action[]))
    OR (p.effect = 'deny'  AND p.action = ANY($deny_actions::perm_action[]));
```

| Property | How it holds |
|---|---|
| Bounded output | 2 effects × ≤5 depths = **at most 10 rows**, so the pure fold is free |
| No precedence in SQL | There is no `ORDER BY`, no `LIMIT`, no `CASE`. SQL gathers; `decide()` decides |
| Team grants | The `subjects` union arm. Cells are flat (no nesting), so no recursion is needed there |
| Agent subjects | Fall through the first union arm unchanged. An agent is a subject, never a second path — the query has no `subject_type = 'agent'` branch at all |
| Cross-workspace isolation | `cell_members.workspace_id` is pinned to the *resource's* workspace, and both joins carry `p.workspace_id = a.workspace_id`. Combined with the composite FKs, a foreign-workspace grant has no representable form |

**Ancestors are walked through `parent_id`, not through `path`** — a deliberate departure from the wording of `docs/SPECS.md` §4 rule 1, recorded as D5. Authorisation must not depend on a denormalised cache; the path serves subtree queries, where its prefix index is genuinely superior. The truth-table suite includes a **differential case** asserting that path-derived and CTE-derived ancestors agree, which turns the two representations into a mutual check.

`can()` is the single decision point, enforced by `scripts/checks/query-boundaries.ts`: no file outside `packages/db/src/permissions/` may reference the `permissions` table.

---

## Two proofs, because correctness and cost fail differently

### Proof 1 — the ~30-case truth table (correctness)

`packages/db/src/permissions/truth-table.test.ts`. One seeded fixture tree (workspace → shelf → book → chapter → page, two users, two cells, one agent), then 30 **read-only** assertions against real Postgres. Read-only means one seed and no per-case teardown, so the suite is fast enough to stay in the red-green loop. Categories and counts are the proposal's, unchanged. The action lattice is proved separately by a pure property test in `packages/core` — it adds no rows to GATE-1's 30.

### Proof 2 — the `EXPLAIN` assertion (cost)

`packages/db/src/permissions/resolver.explain.test.ts`.

| Element | Decision |
|---|---|
| Fixture size | ~20k `nodes` and ~60k `permissions` rows, generated in-database with `generate_series`, then `ANALYZE`. A 30-row fixture would make a sequential scan *correct*, so the assertion would prove nothing |
| Assertion | `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, plan tree walked recursively; **fails if any node is a `Seq Scan` on `nodes` or `permissions`** — JSON node inspection, not string matching |
| Anti-cheat | Asserts `SHOW enable_seqscan` is still `on`. Forcing the planner would make the test tautological |
| Both extremes | Runs against a depth-0 resource (workspace root) and a depth-4 resource (deep page) |
| BUFFERS | Asserts `Shared Hit + Shared Read < 200` blocks for one decision. Ceiling is deliberately generous — it catches order-of-magnitude regressions, not cache jitter |
| Also covered | The subtree query must use `nodes_ws_path_idx`, which is what proves `text_pattern_ops` is doing its job |

### How both get a database

`packages/db/testing/provision.ts`:

1. `TEST_DATABASE_URL` set → use it. **This is the CI path** (`.github/workflows/ci.yml` gains a `pgvector/pgvector:pg17` service container).
2. Otherwise probe `localhost:5432`; if unreachable, run `podman compose up -d --wait postgres` (or `docker` when podman is absent), bounded at 90s. **This is the local path — no hand-started database.**
3. Migrate once into `deepwiki_test_template`, then per suite `CREATE DATABASE dw_test_<n> TEMPLATE deepwiki_test_template`; drop in `afterAll`.
4. Refuses to operate on any database whose name does not start with `dw_test_`.
5. On total failure it **throws with the exact command to run**. It never skips: `describe.skipIf` would make GATE-1 green while proving nothing, which is the precise failure this gate exists to prevent.

`DEEPWIKI_TEST_NO_AUTOSTART=1` opts out of step 2 and fails fast instead. `bun run check` and the pre-commit hook stay database-free; `bun run test` and `bun run verify` now require containers, and `README.md` says so.

---

## Authentication

| Concern | Decision | Rationale |
|---|---|---|
| Password hashing | **Argon2id**, `Bun.password` (m=19456 KiB, t=2, p=1 — OWASP floor) behind a `PasswordHasher` port in `packages/core`, adapter in `apps/api` | Memory-hard; no bcrypt 72-byte truncation; zero dependencies. The port keeps the Bun API out of `core` |
| Session token | 256-bit `crypto.getRandomValues`, stored **SHA-256 hashed**, looked up by hash | The token is already high-entropy, so a slow KDF buys nothing and would cost on every request |
| Session cookie | `HttpOnly; Secure; SameSite=Lax; Path=/` | — |
| Session lifetime | Sliding `idle_expires_at`, hard `absolute_expires_at` | — |
| Invalidation | Logout deletes the row; "sign out everywhere" deletes by `user_id`; a password change or a consumed reset deletes **all** sessions for that user | Server-side rows are why sessions, not JWTs — revocation is a `DELETE`, not a denylist that is a session table with extra steps |
| Reset token | 256-bit random, SHA-256 at rest, single use (`consumed_at`), 30-minute TTL, issuing a new one revokes prior unconsumed ones | — |
| Reset comparison | Lookup by hash, then `timingSafeEqual` on the fetched hash | Removes early-exit comparison as a signal |
| **Account non-disclosure** | `POST /auth/password-reset` **always** returns the same `202` body. On a miss the handler performs an equivalent dummy hash so latency does not become the oracle the response body refuses to be | A different status, body or response time is the same leak |
| Reset link hygiene | `Referrer-Policy: no-referrer` on the reset page; short TTL; single use | The token unavoidably rides in a URL |
| No `SESSION_SECRET` | Opaque DB-backed tokens need no signing key | A secret we do not need is a secret we cannot leak |

### Credentials that must never be logged, serialised or rendered

`password_hash`, session tokens and `token_hash`, reset tokens and `token_hash`, invitation tokens, `SMTP_PASSWORD`, `BLOB_STORE_S3_SECRET_ACCESS_KEY`, the password inside `DATABASE_URL`.

Three enforcement layers:

1. **`Secret<T>` in `packages/core/src/secret.ts`** — a wrapper whose `toString()` and `toJSON()` return `'[redacted]'`. Framework-free, so accidental `JSON.stringify` or template interpolation is inert by construction. Unit-tested directly.
2. **Query layer** — a `publicUser` projection; the raw `users` row is never returned from a route handler.
3. **`scripts/checks/query-boundaries.ts`** — fails the build if any zod **response** schema in `packages/contracts` declares a denylisted field name. Tested against violating fixtures, in the established `scripts/checks/` idiom.

---

## Ports and adapters

`packages/core` gains **no** adapter code; the purity check remains untouched.

| Adapter | Path | Notes |
|---|---|---|
| SMTP `MailSender` | `apps/api/src/adapters/mail/smtp-mail-sender.ts` | `nodemailer`; STARTTLS and auth optional so Mailpit (1025, no auth) works unchanged in dev |
| S3 `BlobStore` | `apps/api/src/adapters/blob/s3-blob-store.ts` | `Bun.S3Client` with an explicit `endpoint`, so MinIO works and no AWS SDK is pulled in |
| Filesystem `BlobStore` | `apps/api/src/adapters/blob/fs-blob-store.ts` | Rejects `..`, absolute paths, backslashes and NUL; resolves and asserts containment inside `BLOB_STORE_FS_ROOT` |
| Selection | `apps/api/src/adapters/blob/index.ts` | `BLOB_STORE_DRIVER=s3｜filesystem`, resolved once at composition root |

**Profile photos.** Keys are server-generated (`workspaces/{ws}/avatars/{userId}/{uuid}.webp`), never user-supplied. Uploads are capped at 5 MiB, typed by **magic bytes rather than the declared `Content-Type`**, restricted to png/jpeg/webp, then resized to 256×256 and re-encoded with `sharp` — which also strips EXIF (GPS is a privacy leak) and neutralises polyglot files.

**Registration mode.** Switching to `open` performs a real send through the configured `MailSender`; only on `ok` is the mode persisted and `smtp_verified_at` stamped. Changing SMTP configuration clears `smtp_verified_at` and reverts the mode to `invitation_only` with an operator notice, because a verified-once flag over a since-changed configuration is exactly the silent failure the rule exists to stop.

---

## Configuration

New variables in `packages/contracts/src/env.ts`, each mirrored into `env.example`:

`APP_URL`, `SESSION_IDLE_TIMEOUT_MINUTES`, `SESSION_ABSOLUTE_TIMEOUT_DAYS`, `PASSWORD_RESET_TTL_MINUTES`, `INVITATION_TTL_DAYS`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `BLOB_STORE_DRIVER`, `BLOB_STORE_S3_ENDPOINT`, `BLOB_STORE_S3_REGION`, `BLOB_STORE_S3_BUCKET`, `BLOB_STORE_S3_ACCESS_KEY_ID`, `BLOB_STORE_S3_SECRET_ACCESS_KEY`, `BLOB_STORE_FS_ROOT`.

Two constraints that shape the implementation:

- **`scripts/checks/env-example.ts` reads `Object.keys(envSchema.shape)`.** Wrapping the schema in `.superRefine(...)` turns it into a `ZodEffects`, which has no `.shape`, and the check breaks. Conditional validation ("if `BLOB_STORE_DRIVER=s3`, the four S3 variables are required") therefore lives in a separate `refineEnv()` called by `parseEnv()` **after** the object parse. `envSchema` stays a plain `ZodObject`.
- **`env.example` must never contain a secret.** SMTP and S3 credentials ship empty or with the already-committed local MinIO development values. Mail and S3 variables are `.optional()` so a fresh clone boots without them; they are validated at first use and surface as a `Result` error, not a crash.

`TEST_DATABASE_URL` is deliberately **not** in `envSchema` — it is read by the test harness, not the app, and adding it would make it a boot requirement. The check only asserts schema ⊆ template, so documenting it in `env.example` is safe.

---

## Testing strategy (Strict TDD, `bun run test`)

| Layer | What | Database |
|---|---|---|
| Pure unit — `packages/core` | `decide()`, the action lattice, `Secret<T>`, email normalisation, path build/parse/containment, reset and invitation lifecycle state machines, registration-mode transitions | None |
| DB integration — `packages/db` | The CTE, **GATE-1's 30 cases**, path trigger, path CHECK rejections, composite-FK rejections, reparent + cycle rejection, concurrent-move serialisation, `verifyPaths()` | Real, auto-provisioned |
| Cost — `packages/db` | `EXPLAIN (ANALYZE, BUFFERS)` on the resolver and the subtree query | Real, large fixture |
| Adapter — `apps/api` | FS `BlobStore` against a temp dir (always); SMTP against Mailpit and S3 against MinIO (compose) | Compose |
| Route — `apps/api` | `app.request()` in-process: auth, invitation, upload; the non-disclosure assertion | Real |
| Structural — `scripts/checks` | `query-boundaries.ts` against violating fixtures | None |
| E2E — Playwright | Sign in, accept an invitation, reset a password | Full stack |

Every unit is RED first. The DB-backed suites are RED-able from the first commit because the provisioning harness (WU-2) lands before any schema.

### Preventing the non-sargable `text` path

| Mechanism | Effect |
|---|---|
| One helper module | `packages/db/src/nodes/subtree.ts` is the **only** place a `path` predicate is written |
| `scripts/checks/query-boundaries.ts` | Fails the build on a `path` `LIKE`/`like()` outside that module, on any pattern literal starting with `%`, and on `lower(path)`/`upper(path)` (a function-wrapped column) |
| Path CHECK regex | Lowercase hex and `/` only — `ILIKE` is never needed and no LIKE metacharacter can ever be stored |
| `EXPLAIN` test | Asserts the subtree query actually uses `nodes_ws_path_idx`, which is what would catch a missing `text_pattern_ops` |

---

## Architecture Decisions

| # | Decision | Rationale | What would reverse it |
|---|---|---|---|
| D1 | `text` materialised path with `text_pattern_ops`, not `ltree` + GiST | The engine cost test (SPECS §14): the portable form is barely worse and `ltree` would be a third hard lock-in. Supersedes the proposal | A decision to ship an appliance is *not* it — that would push further from `ltree`. Only a measured subtree-query cost that `text_pattern_ops` cannot meet |
| D2 | Path stores **ids**, `/`-delimited, leading and trailing, self-inclusive | Immutable and fixed-width, so a rename never rewrites a subtree and the length bound is exact. The trailing delimiter makes prefix containment id-format-independent | An id format that is not fixed-width |
| D3 | `path` is written **only** by a trigger | Removes "application forgot to update the path" as a bug class outright | Nothing foreseeable |
| D4 | The workspace is a `nodes` row of type `workspace` | Makes the resource FK unconditional and deletes the workspace-level special case from the resolver. Adds one node type beyond SPECS §3.1's four | Nothing foreseeable |
| D5 | The resolver walks **`parent_id`**, not `path` | Authorisation must not depend on a derived cache. Depth is bounded at 5 and each step is a PK lookup. Deviates from the literal wording of SPECS §4 rule 1; the differential truth-table case keeps both representations honest | A measured cost difference at realistic depth, which would then need the path integrity check running continuously, not per test |
| D6 | Isolation by composite FK `(id, workspace_id)`, not by `WHERE` | A cross-tenant row becomes unrepresentable rather than merely unqueried. This is what GATE-3 will rely on | Nothing foreseeable |
| D7 | Precedence is a pure fold in `core`; SQL returns ≤10 `(effect, depth)` rows | The rule exists in one place, is exhaustively unit-testable with no database, and SQL carries no `ORDER BY`/`CASE` that could silently disagree with it | A row count large enough for the transfer to matter, which the ≤10 bound forecloses |
| D8 | Deny wins at equal depth **regardless of subject kind**; a direct user grant does not outrank a cell grant | SPECS §4 rule 3 names specificity, not subject type. A subject-type tiebreak means a deny can never be relied upon | An explicit product requirement for user-overrides-team, which would need its own truth-table category |
| D9 | Action lattice: `allow(X)` covers actions ≤ X, `deny(X)` covers actions ≥ X | Denying `read` must deny `write`. Kept in `core` so the query never depends on Postgres enum declaration order | A product need for non-monotone actions |
| D10 | `resource_type` is not stored | It is `nodes.type` of `resource_id`; storing it twice creates a value that can disagree with the tree | A resource that is not a node |
| D11 | Super Root does **not** bypass `can()` | An operator is not a reader. A bypass is the same failure mode as a machine read path (SPECS §2). Instance operations use a separate `canOperateInstance()` | A break-glass requirement, which would need its own audit trail |
| D12 | Moves and workspace-quota checks serialise on `SELECT … FROM workspaces … FOR UPDATE` | A portable row lock beats `pg_advisory_xact_lock` under the engine cost test, and one concurrency idiom is reused for both | Measured contention, which would mean far more moves than a wiki generates |
| D13 | Argon2id via `Bun.password`, behind a `PasswordHasher` port | Memory-hard, no bcrypt truncation, zero dependencies; the port keeps the Bun API out of `core` | A measured latency breach on target hardware |
| D14 | Opaque DB-backed sessions, SHA-256 hashed at rest; no `SESSION_SECRET` | Revocation is a `DELETE`. The token is already high-entropy, so a slow KDF costs every request and buys nothing | Horizontal scale where the session lookup is measurably hot — and even then, a cache, not a JWT |
| D15 | Tests auto-provision Postgres; they never skip | A skipped GATE-1 is a green gate that proves nothing | Nothing foreseeable |
| D16 | `EXPLAIN` runs against a ~20k-row fixture with `enable_seqscan` left on | On a small table a sequential scan is *correct*, so a small fixture makes the assertion meaningless; forcing the planner makes it tautological | Nothing foreseeable |
| D17 | `S3Client` from Bun rather than the AWS SDK | Zero dependencies and an explicit `endpoint` covers MinIO | An S3 feature Bun's client lacks |
| D18 | Extension creation lives in a migration; the init script covers fresh bootstraps only | `/docker-entrypoint-initdb.d` runs only against a fresh data directory, so an existing dev volume would silently never receive it (`docs/TODO.md` Findings) | Nothing foreseeable |

---

## File Changes

| Path | Action | Purpose |
|---|---|---|
| `packages/core/src/permissions/{decide,actions,can,types}.ts` | Create | Pure precedence, action lattice, `can()`, the `GrantLookup` port |
| `packages/core/src/{secret,email,paths}.ts` | Create | `Secret<T>`, email normalisation, path build/parse/containment |
| `packages/core/src/ports/password-hasher.ts` | Create | Hashing port (Argon2id adapter lives in `apps/api`) |
| `packages/core/src/index.ts` | Modify | Re-export the above |
| `packages/db/src/schema.ts` | Modify | The full Drizzle schema; currently empty |
| `packages/db/src/permissions/{resolver,queries}.ts` | Create | The CTE; the only module allowed to touch `permissions` |
| `packages/db/src/nodes/{subtree,move,verify-paths}.ts` | Create | The only module allowed to write a `path` predicate; move + integrity check |
| `packages/db/src/auth/{sessions,password-resets,invitations}.ts` | Create | Token lifecycle queries |
| `packages/db/testing/provision.ts` | Create | Deterministic test-database provisioning |
| `packages/db/drizzle/0000_extensions.sql` | Create | `CREATE EXTENSION IF NOT EXISTS vector` — converges existing dev volumes (D18) |
| `packages/db/drizzle/0001_tenancy.sql` … `0004_auth.sql` | Create | Migrations, each with a tested `down` |
| `packages/db/package.json` | Modify | `verify:paths` script |
| `packages/contracts/src/env.ts` | Modify | New variables + `refineEnv()`; `envSchema` stays a `ZodObject` |
| `packages/contracts/src/{auth,invitations,uploads}.ts` | Create | Request/response schemas |
| `env.example` | Modify | Mirror every new schema variable; no secrets |
| `apps/api/src/adapters/{mail,blob,crypto}/*` | Create | SMTP, S3, filesystem, Argon2id adapters |
| `apps/api/src/routes/{auth,invitations,uploads,admin}.ts` | Create | Route handlers, all authorising through `can()` |
| `apps/api/src/middleware/session.ts` | Create | Cookie → session → subject resolution |
| `scripts/checks/query-boundaries.ts` (+ fixtures) | Create | Single decision path; path sargability; secret-field denylist |
| `package.json` | Modify | Add `query-boundaries` to `check` |
| `.github/workflows/ci.yml` | Modify | Postgres service container + `TEST_DATABASE_URL` |
| `README.md` | Modify | `bun run test` now provisions containers |
| `openspec/specs/container-stack/spec.md` | Modify | The proposal's `ltree` assertion is **withdrawn** — D1 removes the dependency entirely |

---

## Data Flow

```
   HTTP (Hono)      MCP (Phase 7)      background jobs
        │                 │                   │
        └────────┬────────┴───────────────────┘
                 ▼
        can(lookup, {subject, action, resource})     packages/core — pure, no imports
                 │                                   ├─ impliedAllow/DenyActions()
                 ▼                                   └─ decide()  ← the ONLY precedence rule
        GrantLookup (port)
                 │
                 ▼
        packages/db/src/permissions/resolver.ts      WITH RECURSIVE ancestors + subjects
                 │                                   returns ≤10 (effect, depth) rows
                 ▼
        Postgres ── nodes ── parent_id (authoritative ancestry)
                        └─── path      (derived; subtree queries only)
                    permissions ── composite FKs pin every row to one workspace
```

---

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | **Applicable** — the FS `BlobStore` writes files from a key | Keys are server-generated; the adapter still rejects `..`, absolute paths, backslashes and NUL, and asserts the resolved path stays inside `BLOB_STORE_FS_ROOT`. Content is written as an opaque blob and never executed | One test per rejected key class (`../`, `/etc/x`, `a\b`, NUL) plus a containment-escape attempt |
| Executable-file classification | **Applicable** — uploaded images | Type is decided by magic bytes, not the declared `Content-Type`; every accepted image is re-encoded to webp, which neutralises polyglots and strips EXIF | A `.png`-named PHP/HTML polyglot is rejected; a valid image with a lying `Content-Type` is classified by its bytes |
| Subprocess | **Applicable** — the test harness spawns `podman｜docker compose` | Fixed argument vector, no shell, no user-supplied token; only ever `compose up -d --wait postgres`; bounded at 90s; refuses to act on any database not named `dw_test_*` | Harness refuses a non-`dw_test_` target; times out cleanly with an actionable message when no runtime exists |
| Git repository selection | N/A — no VCS automation in this change | — | — |
| Commit / push state, PR commands | N/A — no VCS or PR automation | — | — |

---

## Work Units

Ordered, independently reviewable, tests with their code. Delivery is `single-pr` with `size:exception` accepted, so these are commits within one PR. **The 400-line budget risk is High and is accepted under that strategy** — the units below are the review path, in order.

| # | Commit | Gate | Rollback boundary |
|---|---|---|---|
| 1 | `feat(core): permission precedence as a pure total function` | — | `packages/core/src/permissions/` |
| 2 | `test(db): deterministic postgres provisioning for database-backed tests` | — | `packages/db/testing/` |
| 3 | `feat(db): tenancy schema — plans, users, workspaces, and the nodes tree` | — | migrations `0000`–`0001` + schema section |
| 4 | `feat(db): node move with locked subtree path rewrite and cycle rejection` | — | `packages/db/src/nodes/` |
| 5 | `feat(db): cells, cell members, and the single permissions table` | — | migrations `0002`–`0003` |
| 6 | `feat(db): recursive-CTE grant lookup wired to can()` | **GATE-1 — the 30 cases land here and must be green** | `packages/db/src/permissions/` |
| 7 | `test(db): EXPLAIN assertion that the resolver never sequentially scans` | — | the explain test + large fixture |
| 8 | `feat(checks): single decision path, path sargability, and secret-field guards` | — | `scripts/checks/query-boundaries.ts` |
| 9 | `feat(contracts): auth, invitation and storage environment schema` | — | `env.ts` diff + `env.example` diff |
| 10 | `feat(api): argon2id hashing and revocable server-side sessions` | — | `adapters/crypto/`, `middleware/session.ts`, migration `0004` |
| 11 | `feat(api): password reset that does not disclose account existence` | — | reset route + queries |
| 12 | `feat(api): SMTP MailSender adapter bound to mailpit in development` | — | `adapters/mail/` |
| 13 | `feat(api): registration mode with SMTP-verified open registration` | — | `routes/admin.ts` + `instance_settings` |
| 14 | `feat(api): invitation lifecycle — create, send, accept, join` | — | `routes/invitations.ts` |
| 15 | `feat(api): BlobStore adapters for S3-compatible and filesystem storage` | — | `adapters/blob/` |
| 16 | `feat(api): profile photo upload with byte sniffing, resize and re-encode` | — | `routes/uploads.ts` |
| 17 | `feat(web): sign-in, invitation accept, and password reset screens` | **Human gate** (new UI) **and blocked until WU-6 is green** | `apps/web` routes + components |
| 18 | `docs: record the phase-1 schema and resolver in SPECS and TODO` | — | doc diffs only |

Units 1–2 are infrastructure-first so every later unit is RED-able at creation. Unit 17 is the only permission-aware UI in this change and is doubly gated: GATE-1 must be green, and it stops for the owner's review.

---

## Migration / Rollout

Additive greenfield — no data exists to migrate. Migrations are ordered so each `down` is independently applicable.

| Migration | Up | Down |
|---|---|---|
| `0000_extensions` | `CREATE EXTENSION IF NOT EXISTS vector` | **No down.** Dropping a shared extension is destructive and it is inert if unused |
| `0001_tenancy` | Enums, `plans`, `users`, `workspaces`, `nodes`, the path trigger, indexes | Drop in reverse; drops the enums last |
| `0002_cells` | `cells`, `cell_members` | Drop |
| `0003_permissions` | `permissions`, generated columns, composite FKs, lookup index | Drop |
| `0004_auth` | `sessions`, `password_resets`, `invitations`, `instance_settings` | Drop |

Rollback order is `0004 → 0003 → 0002 → 0001`. Triggers, `CHECK` constraints, partial indexes and `text_pattern_ops` are not expressible in Drizzle's schema DSL, so they are hand-written into the generated SQL; a migration test asserts each object **exists after migrate**, so a `drizzle-kit generate` that silently drops one fails the suite rather than the tenant.

Code rollback is a PR revert: `packages/db` returns to an empty schema and no consumer references it. Dev reset is `podman compose down -v` and re-bootstrap. No production deployment exists, so the practical path remains roll-forward with a corrective migration.

---

## Open Questions

- [ ] Must a `book` always sit inside a `shelf`? This design says yes, to keep the tree regular. Allowing a book directly under the workspace is a one-row change to the parent-type table if the owner wants it.
- [ ] Login and reset rate limiting is **not** in this change's scope. The non-disclosure response closes the enumeration oracle, but not online brute force. Recommended as a follow-up before any public deployment.
- [ ] `role` exists in `subject_kind` but has no producer in Phase 1. It is in the enum now so no `ALTER TYPE` is needed later.
- [ ] This document exceeds the 800-word design budget. The orchestrator's brief required the concrete CTE, schema, work units, decisions and rollback; those cannot be stated at that length without becoming unverifiable.
