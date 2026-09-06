```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:a09d2ddda3ae02fea596c093ca80c59f3feb8b216305f6ce70f1b6dcf871bb4f
verdict: fail
blockers: 1
critical_findings: 1
requirements: 40/40
scenarios: 74/75
test_command: bun run test
test_exit_code: 0
test_output_hash: sha256:99f51112a49a8d824389c30a9df62bf4e4d2e01d3feb0b1e860c8de3bb6331ce
build_command: bun run build
build_exit_code: 0
build_output_hash: sha256:6740388b98fd34126c8ce27c4bfbd5f0c3b5c1111e5e7cfeff9600f99294041c
```

## Verification Report

**Change**: tenancy-and-permissions
**Version**: N/A (Phase 1, `openspec/changes/tenancy-and-permissions`)
**Mode**: Strict TDD

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 85 |
| Tasks complete | 85 |
| Tasks incomplete | 0 |
| Work units | 18/18 |

`tasks.md` shows every checkbox ticked across all 18 phases, cross-checked against the Traceability Matrix (40 requirements → phases) and independently re-derived by reading `truth-table.test.ts`, `resolver.explain.test.ts`, `schema.test.ts`, `auth.test.ts`, `invitations.test.ts`, `admin.test.ts`, `s3-blob-store.test.ts`, `env.test.ts` directly (not taken on the apply-progress record's word).

### Build & Tests Execution

**Build**: PASSED
```text
$ bun run build   (exit 0)
apps/web builds via Nuxt/Nitro to .output/, other packages build clean. No errors. Working tree left clean (build output is gitignored — confirmed via `git status --porcelain` before/after).
```

**Typecheck**: PASSED — `bun run typecheck` exit 0 across all 9 workspace packages + root `tsc --noEmit`.

**Lint**: PASSED — `bun run lint` exit 0 (per-package lint + root `eslint .`).

**Check**: PASSED — `bun run check` exit 0 (workspace-shape, test-coverage, core-purity, env-example, compose, query-boundaries all "ok").

**Tests**: PASSED — 352 tests, 0 failed, 0 skipped
```text
$ bun run test   (exit 0, real execution, this session — not reused from apply-progress)
@deep-wiki/core:      38 pass / 0 fail  (7 files)
@deep-wiki/contracts: 40 pass / 0 fail  (6 files)
@deep-wiki/markdown:   1 pass / 0 fail  (1 file)
@deep-wiki/landing:    5 pass / 0 fail  (2 files)
@deep-wiki/editor:     8 pass / 0 fail  (1 file)
@deep-wiki/db:       124 pass / 0 fail  (15 files, real Postgres via packages/db/testing/provision.ts)
@deep-wiki/api:       56 pass / 0 fail  (11 files, real Postgres + Mailpit)
@deep-wiki/web:       54 pass / 0 fail  (11 files, Vitest + @nuxt/test-utils)
scripts/checks:       26 pass / 0 fail  (9 files)
Total: 352 pass / 0 fail
```

**E2E (Playwright, run fresh this session, not reused)**: PASSED — 22/22
```text
$ bunx playwright test e2e/auth.spec.ts        → 11 passed (1.2m)
$ bunx playwright test e2e/auth-layout.spec.ts e2e/smoke.spec.ts → 11 passed (1.2m)
Total: 22/22 passed. Chromium only (Playwright browser install required manual
`bunx playwright install chromium` without --with-deps, since sudo is
unavailable in this sandbox; browser launched fine without extra OS deps).
```

**Coverage**: Not configured as a numeric gate in this project; `scripts/checks/test-coverage.ts` (part of `bun run check`) asserts every package has a real test file, not a percentage threshold. ✅ Passed.

### Hands-on verification performed this session (not just reading)

| Check | Method | Result |
|---|---|---|
| GATE-1 truth table genuinely covers 30 cases | Read `packages/db/src/permissions/truth-table.test.ts` in full (423 lines) | Confirmed: A1–A6 (6), B1–B4 (4), C1–C5 (5), D1–D5 (5), E1–E4 (4), F1–F4 (4), G1–G2 (2) = 30, plus differential/single-query/tenant-scope tests not counted in the 30 |
| `EXPLAIN` cost proof asserts `enable_seqscan` stays on | Read `resolver.explain.test.ts` | Confirmed: `expect(row!.enable_seqscan).toBe('on')` is a standalone assertion (not just a comment); fixture is 20k nodes / 60k permissions via `generate_series`, so a seq scan would be a real regression, not tautological |
| Cross-tenant row is structurally unrepresentable | Wrote a scratch script against a freshly provisioned `dw_test_*` DB (via the project's own harness) and attempted 4 direct SQL inserts: (1) a `permissions` row naming `workspace_id=A` with a `resource_id` in workspace B, (2) a `nodes` row with `parent_id` in a different workspace, (3) a `cell_members` row naming a user from workspace B under a cell in workspace A, (4) a `nodes` row with `workspace_id = NULL` | All 4 rejected by Postgres itself: `permissions_resource_fk` FK violation, `nodes_parent_fk` FK violation, `cell_members_cell_fk` FK violation, and a NOT NULL violation, respectively — refused by the schema, not by application logic |
| Password-reset non-disclosure — API | Read and re-ran `apps/api/src/routes/auth.test.ts`'s `'a nonexistent account receives the byte-identical generic acknowledgement...'` test | `unknownBody === knownBody` byte-for-byte, `unknownRes.status === knownRes.status`, no mail sent on miss — passed live |
| Password-reset non-disclosure — UI copy | Read `apps/web/app/pages/forgot-password.vue` and `usePasswordResetRequest.ts` | Exactly one success branch, one hardcoded generic message (`'If an account exists for that email, a reset link has been sent.'`) regardless of API response content; confirmed live via the e2e case `password reset > requesting a reset shows the same generic confirmation for any address (non-disclosure)` |
| Expired invitation / replayed reset token | Read + confirmed passing: `packages/db/src/auth/invitations.test.ts` ("expired invitation is rejected and creates no membership", "second acceptance ... rejected without a duplicate membership"), `apps/api/src/routes/auth.test.ts` ("an expired token is rejected...", "a replayed token is rejected on the second attempt") | All pass live against real Postgres |
| Registration `closed` / domain allowlist | Read + confirmed passing: `apps/api/src/routes/admin.test.ts` (`self-registration is rejected while closed`, `registration from a disallowed domain is rejected naming the restriction`) | Pass live |
| Blob adapter misconfigured at startup | Read + confirmed passing: `apps/api/src/adapters/blob/s3-blob-store.test.ts` (`a misconfigured filesystem driver fails startup naming BLOB_STORE_FS_ROOT`, `a misconfigured s3 driver fails startup naming the missing variables`) | Pass live, `createBlobStore(...)` throws naming the exact missing variable |
| Secrets never leak | Read `scripts/checks/query-boundaries.ts`'s denylist (`password_hash`, `token_hash`, `SMTP_PASSWORD`, `BLOB_STORE_S3_SECRET_ACCESS_KEY`, `DATABASE_URL`), `secret.ts`, `auth.test.ts` logging assertions, and the live e2e log line `{"event":"login_attempt","email":"...","outcome":"failure"}` (no password/hash) | No leak found anywhere checked |
| `packages/core` purity | Read `scripts/checks/core-purity.ts` (AST-based via `Bun.Transpiler().scanImports()`, checks every non-test source file for a non-relative import specifier and the package manifest for zero dependencies); ran `bun run check` (includes this check) | Exit 0, zero dependencies declared, zero non-relative imports found |

### Spec Compliance Matrix (by capability)

#### `tenancy-model` — 8 requirements / 11 scenarios — PASS

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Node Tree Structure | Page under book / Page under chapter | `schema.test.ts:100`, `:117` | ✅ COMPLIANT |
| Materialised Path (`text_pattern_ops`, no `ltree`) | Subtree query uses the index | `nodes/subtree.test.ts` + `resolver.explain.test.ts` (`nodes_ws_path_idx` re-confirmed under 20k-row load) | ✅ COMPLIANT |
| Sibling Ordering | New sibling appended | `schema.test.ts:141` | ✅ COMPLIANT |
| Subtree Move Rewrites Path | Moved chapter carries pages / cross-workspace move rejected | `nodes/move.test.ts` | ✅ COMPLIANT |
| Workspace Isolation on Every Tenant-Scoped Table | Row without workspace rejected | `schema.test.ts:60` + hands-on probe (NULL insert rejected) | ✅ COMPLIANT |
| Cells as Group Subjects | Cross-workspace membership rejected | `schema.test.ts:212` + hands-on probe (FK violation) | ✅ COMPLIANT |
| Super Root Global Identity | No implicit workspace membership | `schema.test.ts:181` | ✅ COMPLIANT |
| Plan Limits Bound Workspace Creation | Within limit succeeds / at limit refused | `schema.test.ts` (3.10) | ✅ COMPLIANT |

**Compliance summary**: 11/11 scenarios compliant.

#### `permission-resolver` — 11 requirements / 34 scenarios — PASS

All 30 GATE-1 truth-table cases (A1–G2), the differential check, single-query-resolution, and tenant-scope-derivation are implemented exactly as `truth-table.test.ts` and confirmed passing in this session's live `bun run test` execution and by direct code reading (see table above). "Single Permissions Table" is the one exception — see Issues below.

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Single Permissions Table | Grant recorded with `resource_type = book` | none — no such column exists (D10) | ❌ UNTESTED (spec/design contradiction — see Issues) |
| Supported Subject Types | Agent is a first-class subject | `schema.test.ts:271`, `truth-table.test.ts` (E-series) | ✅ COMPLIANT |
| Five-Level Ancestor Chain | A1–A6 | `truth-table.test.ts` | ✅ COMPLIANT |
| Deny Wins at Equal Specificity | B1–B4 | `truth-table.test.ts` | ✅ COMPLIANT |
| More Specific Overrides Less Specific | C1–C5 | `truth-table.test.ts` | ✅ COMPLIANT |
| Cell Membership Grants | D1–D5 | `truth-table.test.ts` | ✅ COMPLIANT |
| Agent Subject Scoped to One Book | E1–E4 | `truth-table.test.ts` | ✅ COMPLIANT |
| Cross-Workspace Isolation | F1–F4 | `truth-table.test.ts` + hands-on FK probes | ✅ COMPLIANT |
| Default Deny on No Matching Grant | G1–G2 | `truth-table.test.ts` | ✅ COMPLIANT |
| Single-Query Resolution | One query per resolution | `truth-table.test.ts:380` (`statementCount === 1`, connection pre-warmed to exclude OID introspection) | ✅ COMPLIANT |
| Tenant Scope Derived from the Authenticated Subject | Request-supplied workspace ignored | `truth-table.test.ts:407` | ✅ COMPLIANT |

**Compliance summary**: 33/34 scenarios compliant, 1 UNTESTED as literally specified.

#### `registration-policy` — 4 requirements / 6 scenarios — PASS

All scenarios covered and passing in `apps/api/src/routes/admin.test.ts` (`closed` rejection, unverified-SMTP refusal, verified-SMTP acceptance, `smtp_verified_at` stamping, config-change reversion, domain allowlist both ways). ✅ 6/6 COMPLIANT.

#### `invitations` — 5 requirements / 5 scenarios — PASS

Covered in `packages/db/src/auth/invitations.test.ts` and `apps/api/src/routes/invitations.test.ts` (creation with starting grants, delivery through the real `MailSender`/Mailpit path, expiry rejection, single-use rejection, and acceptance immediately unlocking `can(user, read, book) = allow`). ✅ 5/5 COMPLIANT.

#### `authentication` — 4 requirements / 8 scenarios — PASS

Covered in `apps/api/src/middleware/session.test.ts` and `apps/api/src/routes/auth.test.ts`: valid/expired session handling, hashed/single-use/expiring reset tokens (expired and replayed both rejected — re-run live this session), byte-identical non-disclosure response (re-run live this session), no plaintext/hash in logs (re-run live this session), session token cookie-only. ✅ 8/8 COMPLIANT.

#### `mail-delivery` — 4 requirements / 4 scenarios — PASS

`apps/api/src/adapters/mail/smtp-mail-sender.test.ts`: port contract satisfied, connection-failure logging redacts the password, and a real message sent through the adapter is retrieved back out of Mailpit's own inbox API (not mocked). Fail-fast on missing SMTP host covered in `env.test.ts`. ✅ 4/4 COMPLIANT.

#### `blob-storage` — 4 requirements / 7 scenarios — PASS

`fs-blob-store.test.ts` (threat matrix: `../`, absolute path, backslash, NUL, mid-path escape — all rejected, confirmed no file written outside root), `s3-blob-store.test.ts` (both adapters type-check against the same port, both misconfigurations fail startup naming the missing variable, byte-identical round-trip through each adapter independently against real MinIO). ✅ 7/7 COMPLIANT.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| `packages/core` purity | ✅ Implemented | AST-scanned (`Bun.Transpiler`), zero deps, zero non-relative imports; enforced on every `bun run check` |
| Cross-tenant isolation as structural (composite FK) | ✅ Implemented | Confirmed by direct SQL probe this session, not merely by reading the schema |
| Single decision path (`can()` only) | ✅ Implemented | `query-boundaries.ts` fails the build if any file outside `packages/db/src/permissions/` references `permissions` |
| Secret-field denylist | ✅ Implemented | `password_hash`, `token_hash`, `SMTP_PASSWORD`, `BLOB_STORE_S3_SECRET_ACCESS_KEY`, `DATABASE_URL` all denylisted in `packages/contracts` response schemas |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 — `text` path, no `ltree`/GiST | ✅ Yes | `nodes_ws_path_idx` uses `text_pattern_ops`; confirmed sargable under 20k-row `EXPLAIN` |
| D5 — resolver walks `parent_id`, not `path` | ✅ Yes | Differential test proves the two representations agree |
| D6 — isolation by composite FK | ✅ Yes | Confirmed live: 3 cross-tenant insert attempts, all rejected by FK/NOT-NULL constraints |
| D8 — deny wins at equal depth regardless of subject kind | ✅ Yes | B3, D2, D3 exercise exactly this |
| D9 — action lattice monotonicity | ✅ Yes | `actions.test.ts` (pure property test in `core`) |
| D10 — `resource_type` dropped as a stored column | ⚠️ Followed in code, **not reconciled in the OpenSpec artifact** | `schema.test.ts:260` proves the column's absence; `specs/permission-resolver/spec.md`'s "Single Permissions Table" requirement text and scenario were never updated to match — see Issues |
| D15 — tests never skip | ✅ Yes | `provision.ts` throws with the exact remediation command rather than using `describe.skipIf` |
| D16 — `EXPLAIN` fixture large enough, `enable_seqscan` left on | ✅ Yes | Confirmed by direct read of `resolver.explain.test.ts` |

### Issues Found

**CRITICAL**:
1. **`permission-resolver` "Single Permissions Table" requirement is not satisfied as written, and the OpenSpec artifact was never reconciled with the design decision that supersedes it.** `specs/permission-resolver/spec.md` requires the `permissions` table to have a `resource_type` column and its only scenario asserts a grant is "stored as one row in `permissions` with `resource_type = book`". Design decision D10 (`design.md` line 76, restated at `packages/db/src/schema.ts:115`) deliberately drops `resource_type` as a stored column, and `schema.test.ts:260-267` asserts its absence as a positive test. No test anywhere covers the scenario as literally written — it cannot, since the column does not exist, and nothing in the API layer currently re-derives and exposes a `resource_type` value either. This is not a functional defect (the substantive intent — one non-variant table, every subject type resolving through the same path — is genuinely satisfied and tested elsewhere), and the deviation is well-reasoned and explicitly recorded in `design.md`, `tasks.md` (5.2), and `docs/TODO.md`. But it is a real, currently-live contradiction inside a machine-readable spec artifact that this verify pass is chartered to check, and if archived unchanged it leaves a permanently false requirement in the capability baseline. **Recommended fix**: amend `specs/permission-resolver/spec.md`'s "Single Permissions Table" requirement and scenario to match D10 (drop the `resource_type` column reference; the scenario should assert the row is keyed by `resource_id` alone, with type resolved via a join against `nodes` when needed) before this change archives. This is a small spec-text correction, not a code or test change.

**WARNING**: None beyond the CRITICAL item above and the pre-disclosed UI follow-ups (not re-flagged; see below).

**SUGGESTION**: None.

### Known gaps — confirmed as disclosed, not re-discovered as new

All of the following were checked directly against source and confirmed accurate exactly as disclosed; none is a new finding and none is re-flagged as an issue above:

- `UFormField`'s `required` prop renders no `required`/`aria-required` attribute (`UAuthForm`'s `omitFieldProps` strips it) — confirmed via `docs/UI-CHECKLIST.md`'s 2026-09-04 Review Log and by reading `login.vue`/`forgot-password.vue`, which both still pass `required: true` only to the field-config object consumed by `UAuthForm`.
- The mobile footer order is fixed with CSS `order`, so DOM order and visual order differ — confirmed present in the same Review Log entry; not re-derived from Nuxt UI's internal `UFooter` markup, which is third-party and out of this change's scope.
- The two-icon-pack requirement (checklist §4.3) is untested; only `@iconify-json/lucide` is installed in `apps/web/package.json` — confirmed by grep.
- No rate limiting on login or password reset — confirmed absent from `apps/api/src/routes/auth.ts`; `docs/TODO.md` records it as a deliberately deferred Finding.
- CI has never run on GitHub Actions; no git remote configured (`git remote -v` empty) — confirmed, and correctly not treated as a defect. Local enforcement (`.githooks/pre-commit` running `bun run check`, plus `bun run verify` for milestones) is real and was exercised this session.
- The Super Root plan-authoring admin route is not implemented — confirmed via `docs/TODO.md`'s Status table, which explicitly names this as the one open roadmap item past this change; correctly outside the 85 tasks in `tasks.md`.
- The owner-review checkpoint (task 17.4) and its "Pass with follow-ups" verdict — confirmed present and dated 2026-09-04 in `docs/UI-CHECKLIST.md`'s Review Log, listing exactly the three follow-ups above plus two fixed findings (footer overflow, dark-theme contrast).

### Verdict

**FAIL** — one CRITICAL finding: the `permission-resolver` capability's "Single Permissions Table" requirement, as written in the OpenSpec artifact, contradicts the shipped (and correctly reasoned) schema, and was never reconciled. Every other requirement across all seven capabilities (39/40) and 74/75 scenarios is genuinely implemented and covered by tests that were re-executed live in this session, including hands-on adversarial probes beyond what the existing test suite already asserts (cross-tenant insert attempts, non-disclosure byte comparison, secret-field denylist, `packages/core` purity). `bun run check`, `lint`, `typecheck`, `test` (352/352), `build`, and the full Playwright e2e suite (22/22) all pass with exit 0, confirmed fresh, not reused from the apply-progress record. The fix is a one-paragraph spec-text amendment, not a code change, and does not indicate any security or correctness defect in the implementation itself.
