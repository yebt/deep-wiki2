# Tasks: Tenancy and Permissions (Phase 1)

> This artifact exceeds the nominal size budget by explicit necessity, the same
> justification `design.md` already recorded: 40 requirements across 7 capabilities,
> 75 scenarios, and an 18-work-unit strict-TDD breakdown cannot stay traceable at a
> shorter length without becoming unverifiable.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | High — first real schema (5 tables + `permissions`), 4 migrations, a pure resolver, 2 storage adapters, an SMTP adapter, sessions/reset/invitations, 3 UI screens, and a new structural check |
| 400-line budget risk | High |
| Chained PRs recommended | No — `delivery_strategy: single-pr` explicitly forbids chained/stacked PRs |
| Suggested split | Single PR, 18 ordered commits (work units below), `size:exception` |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High
```

`openspec/config.yaml` sets `review.budget_lines: unlimited` with `accepted_exception: "size:exception"` already recorded, and the session config confirms it is accepted up front. No further decision gate blocks `sdd-apply`; `design.md`'s Work Units table already treats the High risk as accepted under this strategy.

### Suggested Work Units

| # | Goal | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| 1 | Pure precedence + action lattice | `bun run -F @deep-wiki/core test permissions` | N/A — no database, pure functions | `packages/core/src/permissions/` |
| 2 | Deterministic Postgres provisioning | `bun test packages/db/testing` | `podman compose up -d --wait postgres` via the harness itself | `packages/db/testing/` |
| 3 | Tenancy schema (plans/users/workspaces/nodes) | `bun run -F @deep-wiki/db test schema` | Real Postgres (auto-provisioned) | migrations `0000`–`0001` + schema section |
| 4 | Node move + path integrity | `bun run -F @deep-wiki/db test nodes` | Real Postgres | `packages/db/src/nodes/` |
| 5 | Cells + single `permissions` table | `bun run -F @deep-wiki/db test schema` | Real Postgres | migrations `0002`–`0003` |
| 6 | Resolver + GATE-1 (~30 cases) | `bun run -F @deep-wiki/db test permissions/truth-table` | Real Postgres | `packages/db/src/permissions/` |
| 7 | EXPLAIN cost proof | `bun run -F @deep-wiki/db test permissions/resolver.explain` | Real Postgres, ~20k/60k-row fixture | explain test + fixture generator |
| 8 | Structural query-boundary checks | `bun test scripts/checks` | N/A — static analysis over fixtures | `scripts/checks/query-boundaries.ts` |
| 9 | Env schema for auth/mail/blob | `bun run -F @deep-wiki/contracts test env` | N/A | `env.ts` diff + `env.example` diff |
| 10 | Argon2id + sessions | `bun run -F @deep-wiki/api test auth/session` | Real Postgres | `adapters/crypto/`, `middleware/session.ts`, migration `0004` |
| 11 | Non-disclosing password reset | `bun run -F @deep-wiki/api test auth/reset` | Real Postgres | reset route + queries |
| 12 | SMTP `MailSender` | `bun run -F @deep-wiki/api test adapters/mail` | Compose (Mailpit) | `adapters/mail/` |
| 13 | Registration mode | `bun run -F @deep-wiki/api test routes/admin` | Real Postgres + Compose (Mailpit) | `routes/admin.ts` + `instance_settings` |
| 14 | Invitation lifecycle | `bun run -F @deep-wiki/api test routes/invitations` | Real Postgres + Compose (Mailpit) | `routes/invitations.ts` |
| 15 | BlobStore adapters | `bun run -F @deep-wiki/api test adapters/blob` | Compose (MinIO) + temp dir | `adapters/blob/` |
| 16 | Profile photo upload | `bun run -F @deep-wiki/api test routes/uploads` | Compose (MinIO) | `routes/uploads.ts` |
| 17 | Sign-in/invite/reset screens | `bun run -F @deep-wiki/web test` + `playwright test e2e/auth.spec.ts` | Full stack (Playwright) | `apps/web` routes + components |
| 18 | Docs sync | N/A — docs only | N/A | doc diffs only |

---

## GATE-1 — binding sequencing

`docs/TODO.md` marks GATE-1 as a hard gate, not advice: **the permission truth table
(Phase 6) MUST be fully green, together with Phase 7's cost proof, before Phase 17
(the only permission-aware UI in this change) may begin.** Phases 8–16 do not render
permission-scoped content and are not blocked by GATE-1, but they still land after
Phase 6 in this ordering because they depend on the schema and resolver it produces.

The resolver needs **two independent proofs**, because correctness and cost fail
differently:
- Phase 6: the ~30-case truth table against real Postgres (never `describe.skipIf`).
- Phase 7: an `EXPLAIN (ANALYZE, BUFFERS)` assertion that fails on a sequential scan,
  against a fixture large enough (~20k `nodes`, ~60k `permissions`) that a seq scan is
  genuinely the wrong plan — a 30-row fixture would make a seq scan *correct*, so the
  assertion would prove nothing — and the test must assert `enable_seqscan` is still
  `on`, otherwise forcing the planner makes the assertion tautological.

---

## Phase 1 (WU-1) — `feat(core): permission precedence as a pure total function`

- [x] 1.1 RED — `packages/core/src/permissions/decide.test.ts`: `decide()` is total
      (no grants → `deny`), smallest depth wins, deny wins at equal depth regardless of
      subject kind (D8). *(permission-resolver: Default Deny — pure half)*
- [x] 1.2 RED — `packages/core/src/permissions/actions.test.ts`: `impliedAllowActions`/
      `impliedDenyActions` lattice property test — `allow(X)` covers actions ≤ X,
      `deny(X)` covers actions ≥ X (D9).
- [x] 1.3 GREEN — implement `packages/core/src/permissions/{types,actions,decide,can}.ts`:
      `Action`, `Effect`, `ResolvedGrant`, `GrantLookup` port, `can(lookup, q)`.
- [x] 1.4 GREEN — export from `packages/core/src/index.ts`; `bun run -F @deep-wiki/core test`
      and `bun run scripts/checks/core-purity.ts` stay green (zero imports).

## Phase 2 (WU-2) — `test(db): deterministic postgres provisioning for database-backed tests`

- [x] 2.1 RED — `packages/db/testing/provision.test.ts`: refuses to operate on any
      database whose name does not start with `dw_test_`; on total failure throws with
      the exact command to run (never `describe.skipIf` — D15).
- [x] 2.2 RED (subprocess threat matrix) — same file: the compose spawn uses a fixed
      argument vector with no shell and no user-supplied token (only ever
      `compose up -d --wait postgres`); asserts a clean timeout message at the 90s bound
      when no container runtime exists.
- [x] 2.3 GREEN — implement `packages/db/testing/provision.ts`: `TEST_DATABASE_URL` set
      → use it (CI path); else probe `localhost:5432`, else
      `podman compose up -d --wait postgres` (docker fallback), bounded at 90s; migrate
      once into `deepwiki_test_template`, then `CREATE DATABASE dw_test_<n> TEMPLATE …`
      per suite, dropped in `afterAll`; `DEEPWIKI_TEST_NO_AUTOSTART=1` opts out and fails
      fast.
- [x] 2.4 Docs — update `README.md` (Commands table) and `CLAUDE.md`: `bun run test` now
      provisions containers via the harness; document `DEEPWIKI_TEST_NO_AUTOSTART=1` as
      the escape hatch; `bun run check` and the pre-commit hook stay database-free.
- [x] 2.5 CI — `.github/workflows/ci.yml`: add a `pgvector/pgvector:pg17` Postgres service
      container and `TEST_DATABASE_URL`.

## Phase 3 (WU-3) — `feat(db): tenancy schema — plans, users, workspaces, and the nodes tree`

- [x] 3.1 RED — `packages/core/src/paths.test.ts`: build/parse/containment for the
      `/{id}/…/{id}/` encoding — leading+trailing delimiter, self-inclusive descendant
      check, 256-char bound. *(tenancy-model: Materialised Path as Text with
      `text_pattern_ops`)*
- [x] 3.2 RED — `packages/core/src/email.test.ts`: normalisation is idempotent and
      lower-cases (backs the `users` `CHECK (email = lower(email))`).
- [x] 3.3 GREEN — implement `packages/core/src/{paths,email}.ts`; export from index.
- [x] 3.4 RED — `packages/db/src/schema.test.ts`: insert rejected when `workspace_id` is
      null on `nodes`/`cells` *(tenancy-model: Workspace Isolation on Every
      Tenant-Scoped Table)*; `CHECK ((parent_id IS NULL) = (type='workspace'))` rejects
      both violating shapes; the partial unique index enforces exactly one `workspace`
      root per `workspace_id`; a page is accepted directly under a book with no chapter,
      and under a chapter *(tenancy-model: Node Tree Structure, both scenarios)*; a new
      sibling receives a `position` greater than all existing siblings *(tenancy-model:
      Sibling Ordering)*.
- [x] 3.5 GREEN — write `packages/db/src/schema.ts`: enums `node_type`
      (`workspace,shelf,book,chapter,page`), `subject_kind` (`user,cell,role,agent` —
      see 3.8), `perm_action`, `perm_effect`, `registration_mode`; tables `plans`,
      `users`, `workspaces`, `nodes`; hand-written `nodes_set_path` trigger (D3) and
      CHECKs (D2), since Drizzle's DSL cannot express them.
- [x] 3.6 GREEN — `packages/db/drizzle/0000_extensions.sql`
      (`CREATE EXTENSION IF NOT EXISTS vector` only — D1/D18; **no `ltree`**, per the
      settled reconciliation) and `0001_tenancy.sql`, each with a tested `down`.
- [x] 3.7 RED — `packages/db/drizzle/migration.test.ts`: asserts the trigger, CHECKs,
      partial index, and `text_pattern_ops` index all exist **after migrate**, so a
      silent `drizzle-kit generate` drop fails the suite, not the tenant.
- [x] 3.8 **Decision task** — add `role` to `subject_kind` now even though Phase 1 has
      no producer for it; record the reasoning as a SQL comment on the enum
      declaration and a `docs/TODO.md` entry (see 18.2): adding a Postgres enum value
      later is a cheap `ALTER TYPE … ADD VALUE`, removing one is not, so it is
      committed now rather than deferred.
- [x] 3.9 RED/GREEN — `users.is_super_root`; test that Super Root does not appear as a
      member of any single workspace by virtue of the flag *(tenancy-model: Super Root
      Global Identity)*.
- [x] 3.10 RED/GREEN — `plans` table; workspace creation within limit succeeds, at limit
      is refused naming the plan limit, using the `SELECT … FOR UPDATE` row lock (D12)
      *(tenancy-model: Plan Limits Bound Workspace Creation, both scenarios)*.

## Phase 4 (WU-4) — `feat(db): node move with locked subtree path rewrite and cycle rejection`

- [ ] 4.1 RED — `packages/db/src/nodes/move.test.ts`: a reparented chapter carries both
      its pages' rewritten paths *(tenancy-model: Subtree Move Rewrites Path, scenario
      1)*; a cross-workspace move is rejected rather than changing `workspace_id`
      *(scenario 2)*; a cycle (new parent is a descendant of the moved node) is
      rejected; an illegal parent-type is rejected; concurrent moves serialise on the
      `FOR UPDATE` lock (D12).
- [ ] 4.2 GREEN — implement `packages/db/src/nodes/move.ts` per the design's
      lock → cycle-check → capture-prefix → update → uniform-prefix-rewrite sequence.
- [ ] 4.3 RED — `packages/db/src/nodes/verify-paths.test.ts`: `verifyPaths()` returns
      empty after every move test in 4.1.
- [ ] 4.4 GREEN — implement `packages/db/src/nodes/verify-paths.ts` (recursive CTE
      recomputing `path` from `parent_id`); add `verify:paths` to
      `packages/db/package.json`.
- [ ] 4.5 GREEN — `packages/db/src/nodes/subtree.ts`, the one module allowed to write a
      `path` predicate; a populated multi-workspace query plan uses the
      `text_pattern_ops` index rather than a sequential scan *(tenancy-model:
      Materialised Path, index scenario — confirmed again under load in Phase 7)*.

## Phase 5 (WU-5) — `feat(db): cells, cell members, and the single permissions table`

- [ ] 5.1 RED — schema additions to `packages/db/src/schema.test.ts`: a cell membership
      naming a user from a different workspace is rejected *(tenancy-model: Cells as
      Group Subjects)*; a grant naming a resource outside its workspace is rejected by
      the composite FK, and a grant naming a cell outside its workspace is rejected
      *(permission-resolver: Cross-Workspace Isolation, structural half)*.
- [ ] 5.2 RED — a schema-shape assertion that `permissions` has **no** `resource_type`
      column (D10).
- [ ] 5.3 GREEN — `packages/db/drizzle/0002_cells.sql` (`cells`, `cell_members`) and
      `0003_permissions.sql` (`permissions`, generated `subject_cell_id`/
      `subject_agent_id`, composite FKs, `permissions_lookup_idx`), each with a tested
      `down`.
- [ ] 5.4 RED — `subject_type` accepts `user`|`cell`|`agent` in populated Phase 1 flows,
      resolving through the same table and path *(permission-resolver: Single
      Permissions Table, Supported Subject Types)*; the reserved `role` value from 3.8
      is present with zero producers this phase.

## Phase 6 (WU-6) — `feat(db): recursive-CTE grant lookup wired to can()` — **GATE-1**

> GATE-1 applies here. This phase must be fully green before Phase 17 (the only
> permission-aware UI) may start. See "GATE-1 — binding sequencing" above.

- [ ] 6.1 RED — `packages/db/src/permissions/truth-table.test.ts`: one seeded fixture
      tree (workspace→shelf→book→chapter→page, 2 users, 2 cells, 1 agent), one seed, no
      per-case teardown, covering the proposal's ~30 cases:
      - Inheritance down each level (6) — permission-resolver scenarios A1–A6.
      - `deny` beats `allow` at equal specificity (4) — B1–B4.
      - More specific `allow` beats an inherited `deny` (5) — C1–C5.
      - Cell/team-derived grants incl. overlap with a direct grant (5) — D1–D5.
      - `agent` scoped to exactly one book (4) — E1–E4.
      - Cross-workspace isolation (4) — F1–F4.
      - No matching grant → `deny` (2) — G1–G2.
      - Plus the differential case (D5): path-derived and CTE-derived ancestors agree
        (not counted in the 30).
- [ ] 6.2 RED — same file: exactly one SQL statement is issued per `can()` resolution,
      even for a page five levels deep *(permission-resolver: Single-Query
      Resolution)*.
- [ ] 6.3 RED — same file: a request body's `workspace_id` is ignored; the
      session-bound workspace is what the resolver uses *(permission-resolver: Tenant
      Scope Derived from the Authenticated Subject)*.
- [ ] 6.4 GREEN — implement `packages/db/src/permissions/resolver.ts` (the
      `WITH RECURSIVE ancestors … subjects …` query, walking `parent_id` per D5) and
      `packages/db/src/permissions/queries.ts`; wire to `packages/core`'s `can()`
      through the `GrantLookup` port.
- [ ] 6.5 Verify — all cases in 6.1–6.3 green. **GATE-1 complete.**

## Phase 7 (WU-7) — `test(db): EXPLAIN assertion that the resolver never sequentially scans`

- [ ] 7.1 RED — `packages/db/src/permissions/resolver.explain.test.ts`: generate ~20k
      `nodes` and ~60k `permissions` rows in-database (`generate_series`), `ANALYZE`;
      run `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` at a depth-0 (workspace root) and a
      depth-4 (page) resource; walk the JSON plan tree and fail if any node is a
      `Seq Scan` on `nodes` or `permissions`; assert `SHOW enable_seqscan` is still `on`
      (forcing the planner would make the assertion tautological, D16); assert
      `Shared Hit + Shared Read < 200` blocks. A 30-row fixture would make a sequential
      scan the *correct* plan, so the fixture size is load-bearing to the assertion.
- [ ] 7.2 RED — same file: the subtree query from 4.5 uses `nodes_ws_path_idx` under
      `EXPLAIN`, proving `text_pattern_ops` is sargable under the non-`C` collation.
- [ ] 7.3 GREEN — fix indexing or query shape only if 7.1/7.2 fail; no production change
      is expected if Phases 3–6 built the indexes as specified.

## Phase 8 (WU-8) — `feat(checks): single decision path, path sargability, and secret-field guards`

- [ ] 8.1 RED — `scripts/checks/query-boundaries.test.ts` against violating fixtures: a
      file outside `packages/db/src/permissions/` referencing `permissions`; a `path`
      `LIKE`/`like()` call outside `packages/db/src/nodes/subtree.ts`; a pattern
      literal starting with `%`; a `lower(path)`/`upper(path)` call; a zod **response**
      schema in `packages/contracts` declaring a denylisted field (`password_hash`,
      `token_hash`, raw session/reset/invitation tokens, `SMTP_PASSWORD`,
      `BLOB_STORE_S3_SECRET_ACCESS_KEY`, the `DATABASE_URL` password).
- [ ] 8.2 GREEN — implement `scripts/checks/query-boundaries.ts`; add it to root
      `package.json`'s `check` script.

## Phase 9 (WU-9) — `feat(contracts): auth, invitation and storage environment schema`

- [ ] 9.1 RED — `packages/contracts/src/env.test.ts`: `envSchema` stays a plain
      `ZodObject` (`Object.keys(envSchema.shape)` must keep working — the
      `env-example.ts` drift check reads it directly, and wrapping in `.superRefine()`
      would turn it into a `ZodEffects` with no `.shape` and silently break the check);
      `refineEnv()` rejects `BLOB_STORE_DRIVER=s3` missing any of the four S3
      variables; mail/S3 vars stay `.optional()` so a fresh clone boots without them.
- [ ] 9.2 GREEN — extend `packages/contracts/src/env.ts`: `APP_URL`,
      `SESSION_IDLE_TIMEOUT_MINUTES`, `SESSION_ABSOLUTE_TIMEOUT_DAYS`,
      `PASSWORD_RESET_TTL_MINUTES`, `INVITATION_TTL_DAYS`, `SMTP_*`, `MAIL_FROM`,
      `BLOB_STORE_*`; add `refineEnv()`, called by `parseEnv()` **after** the object
      parse — never `.superRefine()` on `envSchema` itself. Any future task adding
      conditional env validation MUST follow this same pattern.
- [ ] 9.3 GREEN — mirror every new variable into `env.example` (empty or committed
      local-MinIO values, never a real secret); `bun run scripts/checks/env-example.ts`
      green.
- [ ] 9.4 RED — missing SMTP host fails startup naming the variable
      *(mail-delivery: Configuration via Environment, Fail Fast)*; a misconfigured
      filesystem or S3 adapter fails startup naming the missing config *(blob-storage:
      Adapter Selection by Environment, both scenarios)* — asserted here against
      `refineEnv()`/adapter construction, exercised again against the real adapters in
      Phases 12 and 15.

## Phase 10 (WU-10) — `feat(api): argon2id hashing and revocable server-side sessions`

- [ ] 10.1 RED — `packages/core/src/secret.test.ts`: `Secret<T>.toString()`/`toJSON()`
      return `'[redacted]'`; `JSON.stringify` and template interpolation never leak the
      wrapped value.
- [ ] 10.2 GREEN — implement `packages/core/src/secret.ts`; export from index.
- [ ] 10.3 RED — `packages/core/src/ports/password-hasher.ts` port-contract test with a
      stub `PasswordHasher`.
- [ ] 10.4 GREEN — `apps/api/src/adapters/crypto/argon2id-password-hasher.ts`
      (`Bun.password`, m=19456 KiB, t=2, p=1 — D13) satisfying the port.
- [ ] 10.5 RED — `packages/db/src/auth/sessions.test.ts`: token stored SHA-256 hashed
      and looked up by hash; sliding `idle_expires_at` and hard `absolute_expires_at`;
      logout deletes the row; a password change or a consumed reset deletes all
      sessions for that user.
- [ ] 10.6 GREEN — `packages/db/src/auth/sessions.ts`; `sessions` table in
      `packages/db/drizzle/0004_auth.sql`, tested `down`.
- [ ] 10.7 RED — `apps/api/src/middleware/session.test.ts`: a valid session lets a
      request proceed with the subject derived from it *(authentication: Session
      Issuance and Validation, both scenarios)*; the session token appears only in the
      cookie header, never duplicated in the JSON body *(authentication: Session token
      absent from response body)*.
- [ ] 10.8 GREEN — `apps/api/src/middleware/session.ts`
      (`HttpOnly; Secure; SameSite=Lax; Path=/`).
- [ ] 10.9 RED — a logged login attempt, success or failure, contains no plaintext
      password and no password hash *(authentication: Credentials, Hashes, and Tokens
      Are Never Exposed, logging scenario)*.

## Phase 11 (WU-11) — `feat(api): password reset that does not disclose account existence`

- [ ] 11.1 RED — `packages/db/src/auth/password-resets.test.ts`: an expired token is
      rejected and the password unchanged; a replayed (already-consumed) token is
      rejected on the second attempt; issuing a new token revokes prior unconsumed ones
      *(authentication: Password Reset Tokens Are Hashed, Single-Use, Expiring, both
      scenarios)*.
- [ ] 11.2 GREEN — `packages/db/src/auth/password-resets.ts`; `password_resets` table
      in `0004_auth.sql`.
- [ ] 11.3 RED — `apps/api/src/routes/auth.test.ts` (`app.request()`):
      `POST /auth/password-reset` returns a byte-identical `202` body for an existing
      and a nonexistent account, with equivalent timing via a dummy hash on a miss
      *(authentication: Password Reset Responses Do Not Disclose Account Existence,
      both scenarios)*.
- [ ] 11.4 GREEN — implement the reset route: lookup by hash then `timingSafeEqual`;
      `Referrer-Policy: no-referrer` on the reset page response.

## Phase 12 (WU-12) — `feat(api): SMTP MailSender adapter bound to mailpit in development`

- [ ] 12.1 RED — `apps/api/src/adapters/mail/smtp-mail-sender.test.ts`: type-checks
      against the `MailSender` port with no framework type leaking into
      `packages/core` *(mail-delivery: SMTP Adapter Implements the MailSender Port)*; a
      connection failure is logged without the plaintext SMTP password *(mail-delivery:
      SMTP Credentials Never Logged)*.
- [ ] 12.2 GREEN — `apps/api/src/adapters/mail/smtp-mail-sender.ts` (`nodemailer`,
      STARTTLS/auth optional for Mailpit's no-auth 1025).
- [ ] 12.3 RED — a message sent through the adapter is retrievable from Mailpit's inbox
      *(mail-delivery: Development Binding to Mailpit)*.
- [ ] 12.4 GREEN — wire the adapter at the `apps/api` composition root.

## Phase 13 (WU-13) — `feat(api): registration mode with SMTP-verified open registration`

- [ ] 13.1 RED — a fresh instance reads `registration_mode = invitation_only`
      *(registration-policy: Registration Mode Setting)*.
- [ ] 13.2 GREEN — `instance_settings` singleton row in `0004_auth.sql`.
- [ ] 13.3 RED — `apps/api/src/routes/admin.test.ts`: self-registration rejected while
      `closed`, no account created *(registration-policy: Registration Blocked in
      `closed` Mode)*; switching to `open` without a recorded SMTP test send is
      refused, naming the requirement *(registration-policy: `open` Mode Requires
      Verified SMTP, refusal)*; switching to `open` succeeds after a successful send,
      `smtp_verified_at` stamped only on `ok` *(acceptance scenario)*; changing SMTP
      config clears `smtp_verified_at` and reverts to `invitation_only` with an
      operator notice.
- [ ] 13.4 RED — registration from an allowed domain succeeds; from a disallowed domain
      is rejected naming the restriction *(registration-policy: Optional Domain
      Allowlist, both scenarios)*.
- [ ] 13.5 GREEN — `apps/api/src/routes/admin.ts` against `MailSender` and
      `instance_settings`.

## Phase 14 (WU-14) — `feat(api): invitation lifecycle — create, send, accept, join`

- [ ] 14.1 RED — `packages/db/src/auth/invitations.test.ts`: creation stores workspace,
      target email, and starting grants *(invitations: Invitation Creation)*; an
      expired invitation is rejected without creating membership *(Invitation
      Expiry)*; a second acceptance on an accepted invitation is rejected without a
      duplicate membership *(Single-Use Invitation)*.
- [ ] 14.2 GREEN — `packages/db/src/auth/invitations.ts`; `invitations` table in
      `0004_auth.sql`.
- [ ] 14.3 RED — `apps/api/src/routes/invitations.test.ts`: the send step delivers
      through `MailSender` *(Invitation Delivery via `MailSender`)*; a valid acceptance
      attaches the user to the workspace and `can(user, read, book)` resolves `allow`
      immediately after *(Acceptance Joins the Workspace with Starting Grants)* — the
      first route-level proof that GATE-1's resolver is load-bearing end to end.
- [ ] 14.4 GREEN — `apps/api/src/routes/invitations.ts`.

## Phase 15 (WU-15) — `feat(api): BlobStore adapters for S3-compatible and filesystem storage`

- [ ] 15.1 RED (documentation-like-paths threat matrix) —
      `apps/api/src/adapters/blob/fs-blob-store.test.ts`: one test per rejected key
      class (`../`, an absolute path, a backslash, a NUL byte) plus a
      containment-escape attempt outside `BLOB_STORE_FS_ROOT`.
- [ ] 15.2 GREEN — `apps/api/src/adapters/blob/fs-blob-store.ts`.
- [ ] 15.3 RED — `apps/api/src/adapters/blob/s3-blob-store.test.ts`: type-checks
      against the same `BlobStore` port with no storage-specific type leaking into
      `packages/core` *(blob-storage: Two Adapters Behind One Port)*; a misconfigured
      adapter fails startup naming the missing config *(blob-storage: Adapter
      Selection by Environment, both scenarios)*.
- [ ] 15.4 GREEN — `apps/api/src/adapters/blob/s3-blob-store.ts` (`Bun.S3Client`,
      explicit `endpoint` — D17) and `apps/api/src/adapters/blob/index.ts`
      (`BLOB_STORE_DRIVER` selection).
- [ ] 15.5 RED/GREEN — round-trip test: the same photo bytes return through each
      adapter independently *(blob-storage: Adapter-Independent Retrieval, both
      scenarios)*.

## Phase 16 (WU-16) — `feat(api): profile photo upload with byte sniffing, resize and re-encode`

- [ ] 16.1 RED (executable-file-classification threat matrix) —
      `apps/api/src/routes/uploads.test.ts`: a `.png`-named PHP/HTML polyglot is
      rejected by magic-byte classification; a valid image with a lying
      `Content-Type` is accepted, classified by its bytes.
- [ ] 16.2 RED — an oversized upload is rejected before reaching `BlobStore`
      *(blob-storage: Profile Photo Upload Validated, size scenario)*; an unsupported
      file type is rejected before reaching `BlobStore` *(type scenario)*.
- [ ] 16.3 GREEN — `apps/api/src/routes/uploads.ts`: server-generated key
      (`workspaces/{ws}/avatars/{userId}/{uuid}.webp`), 5 MiB cap, magic-byte sniffing,
      `sharp` resize to 256×256 and re-encode to webp (strips EXIF, neutralises
      polyglots).

## Phase 17 (WU-17) — `feat(web): sign-in, invitation accept, and password reset screens`

> **Human gate (new UI) and GATE-1 dependency.** This is the only permission-aware UI
> in this change. It MUST NOT start until Phase 6 (GATE-1) and Phase 7 (cost proof)
> are both green. Per the standing owner-review gate, it stops for review before
> merge.

- [ ] 17.1 Read `docs/UI-CHECKLIST.md` and `docs/DESIGN-SYSTEM.md` in full before
      writing any markup, per `CLAUDE.md`.
- [ ] 17.2 RED — Vitest + `@nuxt/test-utils` component tests and a Playwright e2e spec
      (`e2e/auth.spec.ts`) for sign-in, invitation-accept, and password-reset screens:
      required states, accessibility floor, responsive behaviour per the checklist.
- [ ] 17.3 GREEN — implement the three screens in `apps/web`, wired to the Phase
      10/11/14 routes.
- [ ] 17.4 **Owner-review checkpoint** — stop; do not proceed to Phase 18 until the
      owner reviews these screens against `docs/UI-CHECKLIST.md` and
      `docs/DESIGN-SYSTEM.md`.

## Phase 18 (WU-18) — `docs: record the phase-1 schema and resolver in SPECS and TODO`

- [ ] 18.1 Sync `docs/TODO.md`'s Phase 1 checklist bullets to the settled schema
      (workspace-as-node, `parent_id` walk, `resource_type` not stored, no `ltree`) —
      `docs/SPECS.md` §14 and the Findings log are already reconciled; only the Phase 1
      task-list bullets still carry the pre-reconciliation phrasing.
- [ ] 18.2 Add a `docs/TODO.md` Findings entry recording the `role` subject_kind
      decision (task 3.8): added to the enum now with no Phase 1 producer, because
      adding a Postgres enum value later is cheap and removing one is not.
- [ ] 18.3 Add a `docs/TODO.md` Findings entry recording login/password-reset rate
      limiting as a **known, deliberately deferred gap**: the non-disclosure response
      (Phase 11) closes the account-enumeration oracle but not online brute force;
      mitigation is deferred to before any public deployment. Do not implement rate
      limiting as part of this change.
- [ ] 18.4 Confirm no edit is made to `openspec/specs/container-stack/spec.md` (or its
      archived equivalent) — the proposal's `ltree`-assertion amendment is withdrawn
      per the settled reconciliation; this task is a checked no-op, not a schedule
      item.
- [ ] 18.5 Run `bun run verify` (`check && lint && typecheck && test`) green on the
      full branch before requesting owner review.

---

## Traceability Matrix (40 requirements → phases)

| Capability | Requirement | Phase(s) |
|---|---|---|
| tenancy-model | Node Tree Structure | 3.4 |
| tenancy-model | Materialised Path as Text with `text_pattern_ops` | 3.1, 4.5, 7.2 |
| tenancy-model | Sibling Ordering | 3.4 |
| tenancy-model | Subtree Move Rewrites Path | 4.1 |
| tenancy-model | Workspace Isolation on Every Tenant-Scoped Table | 3.4, 5.1 |
| tenancy-model | Cells as Group Subjects | 5.1 |
| tenancy-model | Super Root Global Identity | 3.9 |
| tenancy-model | Plan Limits Bound Workspace Creation | 3.10 |
| permission-resolver | Single Permissions Table | 5.4 |
| permission-resolver | Supported Subject Types | 5.4 |
| permission-resolver | Five-Level Ancestor Chain | 6.1 |
| permission-resolver | Deny Wins Over Allow at Equal Specificity | 6.1 |
| permission-resolver | More Specific Level Overrides Less Specific | 6.1 |
| permission-resolver | Cell Membership Grants | 6.1 |
| permission-resolver | Agent Subject Scoped to One Book | 6.1 |
| permission-resolver | Cross-Workspace Isolation | 5.1, 6.1 |
| permission-resolver | Default Deny on No Matching Grant | 1.1, 6.1 |
| permission-resolver | Single-Query Resolution | 6.2 |
| permission-resolver | Tenant Scope Derived from the Authenticated Subject | 6.3 |
| registration-policy | Registration Mode Setting | 13.1 |
| registration-policy | Registration Blocked in `closed` Mode | 13.3 |
| registration-policy | `open` Mode Requires Verified SMTP | 13.3 |
| registration-policy | Optional Domain Allowlist | 13.4 |
| invitations | Invitation Creation | 14.1 |
| invitations | Invitation Delivery via `MailSender` | 14.3 |
| invitations | Invitation Expiry | 14.1 |
| invitations | Single-Use Invitation | 14.1 |
| invitations | Acceptance Joins the Workspace with Starting Grants | 14.3 |
| authentication | Session Issuance and Validation | 10.5, 10.7 |
| authentication | Password Reset Tokens Are Hashed, Single-Use, Expiring | 11.1 |
| authentication | Password Reset Responses Do Not Disclose Account Existence | 11.3 |
| authentication | Credentials, Hashes, and Tokens Are Never Exposed | 10.1, 10.9 |
| mail-delivery | SMTP Adapter Implements the `MailSender` Port | 12.1 |
| mail-delivery | Configuration via Environment, Fail Fast | 9.4, 12.3 |
| mail-delivery | SMTP Credentials Never Logged | 12.1 |
| mail-delivery | Development Binding to Mailpit | 12.3 |
| blob-storage | Two Adapters Behind One Port | 15.1, 15.3 |
| blob-storage | Adapter Selection by Environment | 9.4, 15.3 |
| blob-storage | Profile Photo Upload Validated | 16.2 |
| blob-storage | Adapter-Independent Retrieval | 15.5 |

## Open Items Resolved Into This Checklist

- `role` subject_kind: enum value added now (3.8), reasoning recorded (18.2) — not
  deferred, because removing an enum value later is expensive and adding one is not.
- Rate limiting on login/reset: explicitly **not implemented**; recorded as a known
  gap with deferred mitigation (18.3).
- `bun run test` now provisions containers: documented in `README.md`/`CLAUDE.md`
  (2.4).
- `.superRefine()` vs `env-example.ts`'s `Object.keys(envSchema.shape)`: `envSchema`
  stays a `ZodObject`; conditional validation lives in a separate `refineEnv()` (9.1,
  9.2).
- `container-stack`'s `ltree` assertion: withdrawn, not scheduled (18.4).
