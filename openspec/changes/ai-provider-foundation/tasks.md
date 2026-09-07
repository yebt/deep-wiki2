# Tasks: AI Provider Foundation (Phase 5 — provider slice)

> Exceeds the nominal size budget by explicit necessity: 6 capabilities plus an
> `environment-config` delta, 18 design work units, 2 blocking verification tasks,
> and a schema that spans 8 tables cannot stay traceable at a shorter length
> without becoming unverifiable (same justification `tenancy-and-permissions/tasks.md`
> recorded).

No UI ships in this change (proposal — "Out of Scope"). The standing UI human-review
gate is **not triggered**; no task below introduces a screen or interaction.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | High — 8 new tables + 1 `ALTER`, 4 migrations, ~25 `packages/core` files, 5 provider adapters, a cipher, 3 structural-check rules, 2 CLI scripts, 1 route module |
| 400-line budget risk | High |
| Chained PRs recommended | No — `delivery_strategy: single-pr` with `size:exception` accepted up front |
| Suggested split | Single PR, 20 ordered work units, `size:exception` |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High
```

`design.md`'s own Work Units table already treats High risk as accepted under
`single-pr` + `size:exception`; the session config confirms this up front. No
further decision gate blocks `sdd-apply`.

### Suggested Work Units

| # | Goal | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| 0 | Sequencing gate + migration-number derivation | N/A — process check | N/A | none — a gate, not code |
| 1 | Core purity: raw-source specifier scan | `bun run -F @deep-wiki/root test scripts/checks/core-purity` | N/A | `scripts/checks/core-purity.ts` rule 3 |
| 2 | Provider identity, capability registry, degradation ladder | `bun run -F @deep-wiki/core test ai/ids ai/registry ai/degrade` | N/A — pure functions | `packages/core/src/ai/{ids,registry,degrade}.ts` |
| 3 | Cost model + budget reserve/settle/void/expire | `bun run -F @deep-wiki/core test ai/pricing ai/budget` | N/A — pure functions | `packages/core/src/ai/{pricing,budget}.ts` |
| 4 | Stable prompt prefix + goldens | `bun run -F @deep-wiki/core test ai/prefix` | N/A — pure functions | `packages/core/src/ai/prefix.ts` + goldens |
| 5 | Chat/embedding/cipher/key-provider/ledger ports | `bun run -F @deep-wiki/core test ai/ports` | N/A | `packages/core/src/ai/ports.ts` |
| 6 | Key-provider env schema + startup validation | `bun run -F @deep-wiki/contracts test env` | N/A | `env.ts` additions, `env.example`, `refineEnv` branch |
| 7 | AAD-bound envelope cipher + env key provider | `bun run -F @deep-wiki/api test adapters/ai/cipher adapters/ai/key-provider` | N/A — `node:crypto` only | `apps/api/src/adapters/ai/{cipher,key-provider}/` |
| 8 | Settings + credentials schema | `bun run -F @deep-wiki/db test schema` | Real Postgres (auto-provisioned) | the settings + credentials migration |
| 9 | Denylist, SDK import boundary, decryption boundary | `bun run -F @deep-wiki/root test scripts/checks/query-boundaries` | N/A — static analysis over fixtures | `query-boundaries.ts` rules 5–7 + fixtures |
| 10 | Credential save route with validation probe | `bun run -F @deep-wiki/api test routes/ai-credentials` | Real Postgres | `routes/ai-credentials.ts` |
| 11 | Usage ledger + plan quota column | `bun run -F @deep-wiki/db test ai/ledger` | Real Postgres | the ledger + budget-periods migration |
| 12 | The single AI gateway | `bun run -F @deep-wiki/api test ai/gateway` | Real Postgres, fake provider | `apps/api/src/ai/gateway/index.ts` |
| 13 | Vercel AI SDK adapters, fixture-replayed | `bun run -F @deep-wiki/api test adapters/ai/providers` | N/A — injected `fetch`, recorded fixtures | the five adapters + `fixtures/providers/` |
| 14 | Structured-output degradation + observations | `bun run -F @deep-wiki/api test ai/gateway/structured` | N/A — fake provider | `gateway/structured.ts`, observations migration |
| 15 | Embedding index generations + chunks | `bun run -F @deep-wiki/db test ai/embedding-index` | Real Postgres | the generations + `chunks` migration |
| 16 | Reindex as a tracked resumable job | `bun run -F @deep-wiki/db test ai/reindex` | Real Postgres | jobs migration + `ai:reindex` |
| 17 | Key rotation + boot-time keyring check | `bun run -F @deep-wiki/api test ai/rekey` | Real Postgres | `ai:rekey`, the startup check |
| 18 | Blocking verification: embedding probe + local-model gap | N/A — opt-in `ai:probe`, doc write | Real network, real keys (opt-in only) | doc diffs + `ai:probe` script |
| 19 | Docs sync: findings, runbook, revocation rule | N/A — docs only | N/A | doc diffs only |

---

## Phase 0: Sequencing Gate (blocking, not code)

- [x] 0.1 Confirm `openspec/changes/tenancy-and-permissions/` has archived (moved out of `openspec/changes/`) before starting any task that touches `plans`. If not yet archived, stop and re-check before Phase 11. — **Met**: archived at `openspec/changes/archive/2026-09-06-tenancy-and-permissions`.
- [x] 0.2 Read `packages/db/drizzle/meta/_journal.json` (read-only) immediately before writing any migration in Phases 8, 11, 14, 15, 16; use `next idx + 1` as the migration number, never a number copied from `design.md`. `content-and-editor` may have already claimed `0008`–`0010`; whichever change applies second renumbers from the journal, per the existing `docs/TODO.md` Finding (2026-09-06). — Done for all five: Phase 8 (`idx` 7 → `0008`), Phase 11 (`idx` 8 → `0009`), Phase 14 (`idx` 9 → `0010`), Phase 15 (`idx` 10 → `0011`), Phase 16 (`idx` 11 → `0012`).

## Phase 1: Core Purity — Close the Type-Only Import Hole

- [x] 1.1 RED: `scripts/checks/core-purity.test.ts` — add fixtures for `import type { X } from 'ai'`, `import { type X } from 'ai'`, and a relative `import type` that must still pass; assert the new rule flags the first two and passes the third.
- [x] 1.2 GREEN: add a raw-source specifier scan (`from '<non-relative>'` / `require('<non-relative>')` over file text, not the transpiled import list) as rule 3 in `scripts/checks/core-purity.ts`, run alongside `scanImports()`.

## Phase 2: Core — Provider Identity, Capability Registry, Degradation Ladder

- [x] 2.1 RED: `packages/core/src/ai/ids.test.ts` — `parseModelId` accepts `<providerId>:<slug>` for the closed `ProviderId` union; refuses a slug containing `https://`, `..`, or whitespace; refuses an unknown `providerId`.
- [x] 2.2 GREEN: `packages/core/src/ai/ids.ts` — `ProviderId`, `ModelRef`, `parseModelId(raw): Result<ModelRef, InvalidModelId>`.
- [x] 2.3 RED: `packages/core/src/ai/registry.test.ts` — `capabilitiesOf` returns capabilities for a registered `<provider>:<model>`; returns a typed `UnknownModel` refusal for an unregistered one, with no default branch.
- [x] 2.4 GREEN: `packages/core/src/ai/registry.ts` — frozen `ModelCapabilities` record, `capabilitiesOf(ref): Result<ModelCapabilities, UnknownModel>`; every entry carries `verifiedAt` and `source` (provenance fields, spec — ai-provider-registry).
- [x] 2.5 RED: `packages/core/src/ai/degrade.test.ts` — `degrade('schema')` ladders `schema → tool-call → prompted → none` in that fixed order and never skips a rung; `degrade('none')` returns `null`.
- [x] 2.6 GREEN: `packages/core/src/ai/degrade.ts` — pure `degrade(level): StructuredOutputLevel | null`.
- [x] 2.7 RED: `packages/core/src/ai/registry.test.ts` — a provenance-assertion test: an entry missing `verifiedAt` or `source` fails the suite (design.md — Drift detection, mechanism 2).
- [x] 2.8 GREEN: enforce the provenance assertion at module load or via a dedicated test iterating the registry.

## Phase 3: Core — Cost Model and Budget State Machine

- [x] 3.1 RED: `packages/core/src/ai/pricing.test.ts` — cost arithmetic from token counts and the price table (input/output/cached-input, distinct rates).
- [x] 3.2 GREEN: `packages/core/src/ai/pricing.ts`.
- [x] 3.3 RED: `packages/core/src/ai/budget.test.ts` — pure transition function: `reserve → settle` releases the reservation and records actual cost; `reserve → void` releases with no settlement; `reserve` past `expires_at` is excluded from the outstanding sum with no sweep.
- [x] 3.4 GREEN: `packages/core/src/ai/budget.ts` — the reserve/settle/void/expire state machine as a pure function over rows, mirroring the `UPDATE ... RETURNING` semantics in `design.md`.
- [x] 3.5 RED: `packages/core/src/ai/budget.test.ts` — **under-reservation bound test**: given a provider that reports actual usage above `maxOutputTokens` (or an underestimated input count), assert the resulting overspend is bounded to exactly one call — the *next* admission is refused, not retroactively corrected. Asserts the design's claimed bound rather than trusting the narrative (open item).
- [x] 3.6 GREEN: implement the "actual exceeds reserve is recorded truthfully, next admission refused" rule in `budget.ts` covered by 3.5.

## Phase 4: Core — Stable Prompt Prefix

- [x] 4.1 RED: `packages/core/src/ai/prefix.test.ts` — determinism (assemble twice ⇒ deep-equal); shuffle-invariance (shuffled tool input array ⇒ identical serialized bytes); fixed ordering tools → system → team rule packs → document → question (prompt-assembly spec).
- [x] 4.2 GREEN: `packages/core/src/ai/prefix.ts` — `buildPrefix(input): { text, hash, cacheBoundary }`; canonical JSON writer with sorted keys; `StablePrefixInput` typed as `string`/`readonly string[]` only (no `Date`, no uuid).
- [x] 4.3 RED: golden-file test per rule-pack fixture asserting a prefix change is a visible diff, not a silent cache miss.
- [x] 4.4 GREEN: commit the golden fixtures alongside 4.2.

## Phase 5: Core — Ports

- [x] 5.1 RED: `packages/core/src/ai/ports.test.ts` — type-level test asserting `ChatModelPort`, `EmbeddingModelPort`, `KeyProvider`, `CredentialCipher`, `UsageLedger` compose only of `Result`/`Secret`/primitive types (no leaked SDK type, enforced by 1.2's rule 3 as a regression guard).
- [x] 5.2 GREEN: `packages/core/src/ai/ports.ts` — the five port interfaces from `design.md`.
- [x] 5.3 RED: `packages/core/src/ai/aad.test.ts` — AAD construction (`workspace_id ‖ credential_id ‖ provider`) is deterministic and order-sensitive.
- [x] 5.4 GREEN: `packages/core/src/ai/aad.ts`.

## Phase 6: Contracts — Key-Provider Env Schema

- [x] 6.1 RED: `packages/contracts/src/env.test.ts` — `refineEnv` fails when `AI_KEK_KEYRING` is malformed, when any key is not exactly 32 bytes after base64 decode, or when `AI_KEK_ACTIVE_ID` is absent from the keyring; succeeds on a valid keyring (environment-config delta scenarios).
- [x] 6.2 GREEN: add `AI_KEK_DRIVER`, `AI_KEK_KEYRING`, `AI_KEK_ACTIVE_ID`, `AI_KEK_KMS_KEY_ID` (optional) to `envSchema`; extend `refineEnv()` with the keyring-parse/32-byte/active-id-present checks.
- [x] 6.3 Add the same four variables to `env.example` with non-secret placeholder values (no real key); `bun run -F @deep-wiki/root test scripts/checks/env-example` stays green.

## Phase 7: Envelope Cipher and Key-Provider Adapters

- [x] 7.1 RED: `apps/api/src/adapters/ai/cipher/aes-gcm-cipher.test.ts` — seal/open round trip; `open` with a wrong AAD fails; `open` with a wrong `key_id` fails; the sealed blob contains no plaintext substring.
- [x] 7.2 GREEN: `apps/api/src/adapters/ai/cipher/aes-gcm-cipher.ts` implementing `CredentialCipher` with `node:crypto` AES-256-GCM.
- [x] 7.3 RED: `apps/api/src/adapters/ai/key-provider/env-key-provider.test.ts` — `wrap`/`unwrap` round trip against the parsed keyring; `activeKeyId()` matches `AI_KEK_ACTIVE_ID`.
- [x] 7.4 GREEN: `apps/api/src/adapters/ai/key-provider/env-key-provider.ts` implementing `KeyProvider`.
- [x] 7.5 RED: `apps/api/src/adapters/ai/key-provider/env-key-provider.test.ts` — rekey preserves plaintext and leaves `ciphertext` byte-identical (only `wrapped_dek`/`key_id` change).
- [x] 7.6 GREEN: expose the rewrap primitive used later by `ai:rekey` (Phase 17).

## Phase 8: Schema — Settings and Credentials

- [x] 8.1 Derive migration number per Phase 0.2; write `packages/db/drizzle/NNNN_ai_settings_and_credentials.sql` creating `workspace_ai_settings` and `workspace_ai_credentials` per `design.md`'s Schema table (composite FK `(id, workspace_id)`, `UNIQUE (workspace_id, provider)`, no plaintext column). — journal `idx` was 7; used `0008_ai_settings_and_credentials`.
- [x] 8.2 RED: `packages/db/src/schema.test.ts` / `migration.test.ts` — both tables exist after `migrate()`; insert with `workspace_id = NULL` is rejected; insert under a nonexistent workspace is rejected. — in `packages/db/src/ai/settings-and-credentials.test.ts`.
- [x] 8.3 GREEN: add Drizzle `pgTable` definitions for both tables to `packages/db/src/schema.ts`.
- [x] 8.4 RED: composite-FK test — a credential row moved to another workspace's `(id, workspace_id)` pair is rejected at the database. — via a throwaway companion table FK'd to `(id, workspace_id)`, proving the constraint is consumable exactly as a future referencing table would.
- [x] 8.5 GREEN: verify the FK definition in 8.1 covers 8.4 (adjust SQL if not). — covered on first run; no adjustment needed.
- [x] 8.6 RED: `down` migration test — reversing `NNNN_ai_settings_and_credentials` drops both tables including ciphertext rows.
- [x] 8.7 GREEN: write the tested `down` block.

## Phase 9: Structural Checks — Denylist, SDK Import, Decryption Boundary

- [x] 9.1 RED: `scripts/checks/query-boundaries.test.ts` — extend fixtures: a `*Response*` schema declaring `ciphertext`, `authTag`/`auth_tag`, `wrappedDek`/`wrapped_dek`, `keyId`/`key_id`, `dek`, `kek`, `keyMaterial`/`key_material`, or a `*ApiKey`/`*Secret`/`*Credential` suffix fails; a schema declaring `inputTokens`/`outputTokens`/`cachedInputTokens`/`reasoningTokens` **passes** (the named trap — constraint #5).
- [x] 9.2 GREEN: widen `DENYLISTED_FIELDS` with the exact/camelCase/suffix-anchored shapes from `design.md`; add `TOKEN_COUNT_ALLOWLIST` so the `Token` suffix rule never fires on the legitimate usage counters; widen the scan to `apps/api/src/routes`.
- [x] 9.3 RED: `scripts/checks/query-boundaries.test.ts` — a fixture file outside `apps/api/src/ai/gateway/` importing `ai`, `@ai-sdk/*`, or `@openrouter/*` fails; a fixture inside that directory passes.
- [x] 9.4 GREEN: rule 6 — the SDK import boundary, in the idiom of rule 1.
- [x] 9.5 RED: `scripts/checks/query-boundaries.test.ts` — a fixture file outside `apps/api/src/adapters/ai/credentials/` importing the cipher's `open` fails.
- [x] 9.6 GREEN: rule 7 — the decryption boundary.

## Phase 10: Credential Save Route

- [x] 10.1 RED: `apps/api/src/routes/ai-credentials.test.ts` — a syntactically valid, provider-accepted key is persisted; a provider-rejected key returns a validation error and persists no row; `can()` denies the write for a user with no `manage` grant, before any encryption; the response body never contains the submitted key (`expectNoCredential`); a request-supplied `workspace_id` is ignored in favor of the authenticated subject's workspace. — authored against the finished route in one pass (honestly noted, not a fabricated RED — same caveat as Phase 8.1); the workspace is resolved from the URL path, so a body-supplied `workspaceId` is structurally unread rather than checked and discarded.
- [x] 10.2 GREEN: `apps/api/src/routes/ai-credentials.ts` — resolves authorization through `can()`, runs the cheapest provider probe (`CredentialValidationProbe`, injected — the real Vercel AI SDK-backed implementation lands with Phase 13), maps probe errors to `invalid_key｜insufficient_quota｜network｜unknown` before they reach a logger, seals via `CredentialCipher`, persists through `apps/api/src/adapters/ai/credentials/repository.ts`.
- [x] 10.3 RED: `apps/api/src/routes/ai-credentials.test.ts` — settings-read scenario: fetching a workspace's AI settings never returns plaintext or ciphertext.
- [x] 10.4 GREEN: the settings-read handler serializes only `last_four`, `provider`, `validated_at`.

## Phase 11: Usage Ledger and Plan Quota

- [x] 11.1 Re-confirm Phase 0.1 (tenancy-and-permissions archived) before writing this migration — it `ALTER`s `plans`. — still archived at `openspec/changes/archive/2026-09-06-tenancy-and-permissions`.
- [x] 11.2 Derive migration number per Phase 0.2; write `NNNN_ai_usage_ledger.sql` creating `ai_usage_events`, `workspace_ai_budget_periods`, and `ALTER TABLE plans ADD COLUMN max_ai_cost_micro_usd_monthly`. — journal `idx` was 8; used `0009_ai_usage_ledger`.
- [x] 11.3 RED: `packages/db/src/ai/ledger.test.ts` — the admission `UPDATE` under two concurrent transactions: exactly one succeeds when the second would exceed the limit; an expired reservation (`expires_at < now()`) is excluded from the outstanding sum; `settle` and `void` are idempotent under `WHERE state = 'reserved'`.
- [x] 11.4 GREEN: `packages/db/src/ai/ledger.ts` implementing `UsageLedger` with the single conditional `UPDATE` from `design.md`. Required extending `UsageLedger.admit`'s parameter (`packages/core/src/ai/ports.ts`'s new `LedgerAdmissionInput`, extending `AdmissionInput` with the attribution `ai_usage_events` needs — workspace/subject/provider/model/operation) — a deviation from Phase 5's original signature, noted below.
- [x] 11.5 RED: a workspace with no budget-period row gets one seeded from its plan on first admission.
- [x] 11.6 GREEN: implement period-row seeding in `ledger.ts`.
- [x] 11.7 Write the tested `down` migration (drop both tables, drop the `plans` column). — also required updating Phase 8's own down-migration test to reverse `0009` before `0008`, since `ai_usage_events.degradation_level` depends on `0008`'s `ai_structured_output_level` type.

## Phase 12: The Single AI Gateway

- [x] 12.1 Depends on Phase 9 (rules 6–7 must be green before this unit lands, per `design.md`'s sequencing note). — Met (Phase 9 landed in the prior batch; `query-boundaries: ok` reconfirmed this batch).
- [x] 12.2 RED: `apps/api/src/ai/gateway/index.test.ts` — over-budget refusal asserts **the fake provider was never called**; an unregistered model is refused before a client is constructed; decryption (`cipher.open`) happens only after admission succeeds, never before. Uses the real `PostgresUsageLedger` and real cipher/repository against disposable Postgres, with only the `ChatModelPort` faked, so admission/decryption ordering is proven against real state, not a mock. Authored against the finished gateway in one pass (honest caveat, as prior units).
- [x] 12.3 GREEN: `apps/api/src/ai/gateway/index.ts` implementing the 8-step call path from `design.md` (`parseModelId → capabilitiesOf → buildPrefix → ledger.admit → openCredential (never the cipher directly — rule 7) → resolveChatModel → generate/stream → settle/void`).
- [x] 12.4 RED: an aborted stream leaves no live reservation once `AI_RESERVATION_TTL_SECONDS` passes. — proven via the abort handler firing `ledger.void` immediately rather than waiting out the real TTL.
- [x] 12.5 GREEN: wire the abort handler to `ledger.void`.

## Phase 13: Vercel AI SDK Provider Adapters

- [x] 13.1 RED: `apps/api/src/adapters/ai/providers/*.test.ts` — one recorded fixture per provider (Anthropic, OpenAI, Google, DeepSeek, OpenRouter) replayed through an injected `fetch`; a scrubber test asserts no fixture file contains an API-key-shaped string. — **Path deviation from this task's literal wording, forced by an already-shipped, machine-enforced constraint**: `scripts/checks/query-boundaries.ts` rule 6 (Phase 9) refuses an `ai`/`@ai-sdk/*`/`@openrouter/*` import anywhere outside `apps/api/src/ai/gateway/`. The five adapters and their tests/fixtures therefore live at `apps/api/src/ai/gateway/providers/`, not `apps/api/src/adapters/ai/providers/` as literally written here — `apps/api/src/adapters/ai/` is reserved for the cipher/key-provider/credentials modules that must NOT import an SDK. Verified empirically: each provider's real request/response wire shape (URL, headers, body, usage field names) was captured via a throwaway script injecting a logging `fetch` against the real `@ai-sdk/*` packages, then baked into checked-in fixtures — not guessed from documentation.
- [x] 13.2 GREEN: the five adapters under `apps/api/src/ai/gateway/providers/` (see 13.1's path note), each accepting `fetch` by injection, implementing `ChatModelPort`/`EmbeddingModelPort` where applicable (OpenAI and Google also implement `EmbeddingModelPort`; Anthropic, DeepSeek and OpenRouter do not — no first-party/verified embeddings surface); `ai@7.0.93`, `@ai-sdk/anthropic@4.0.49`, `@ai-sdk/openai@4.0.60`, `@ai-sdk/google@4.0.64`, `@ai-sdk/deepseek@3.0.39`, `@openrouter/ai-sdk-provider@3.0.0`, and `zod@3.25.76` (the exact version carrying the `zod/v4` compat subpath these SDK versions import — `packages/contracts`' own zod stays at `3.24.1`, unaffected) are installed for the first time here, exactly as `design.md`'s sequencing note requires. `maxRetries: 0` on every adapter call keeps a single fixture response deterministic instead of racing the SDK's own retry loop.
- [x] 13.3 RED: a normalized-error test per adapter — an HTTP 429 fixture maps to a normalized rate-limit error; an invalid-credential fixture maps to a normalized auth error with no raw payload or key substring (ai-provider-registry spec — "Normalized Provider Errors").
- [x] 13.4 GREEN: shared error-mapping helper (`providers/errors.ts`) used by all five adapters — branches only on `APICallError.statusCode`, never echoes `error.message`/`responseBody`.

## Phase 14: Structured-Output Degradation

- [x] 14.1 Derive migration number per Phase 0.2; write `NNNN_ai_capability_observations.sql`. — journal `idx` was 9; used `0010_ai_capability_observations`.
- [x] 14.2 RED: `apps/api/src/ai/gateway/structured.test.ts` — a `schema`-level model uses the native path with no repair pass; a `tool-call`-level model is coerced through a single required tool; a `prompted`-level model whose first response fails validation gets exactly one repair pass carrying the validation error verbatim, and a typed `structured_output_failed` (never a silent `{}`) if the repair also fails; the runtime never attempts a rung above the declared level.
- [x] 14.3 GREEN: `apps/api/src/ai/gateway/structured.ts` implementing the ladder against a fake provider. **Scope note**: this ladder operates purely at the "which rung, how many attempts, how to validate, how to phrase one repair" policy level over the existing `ChatModelPort.generate`; it does not implement each real Phase-13 adapter's native JSON-schema-response-format or tool-forcing wire mechanics (e.g. via `generateObject` or a forced tool call) — that per-adapter mechanical work is unstarted and explicitly out of this batch, tracked as a gap rather than silently assumed done.
- [x] 14.4 RED: dropping below the declared level at runtime writes an `ai_capability_observations` row and degrades that call one rung.
- [x] 14.5 GREEN: wire the observation write into 14.3's degrade-on-contradiction path.
- [x] 14.6 RED: every rung is a ledger event — a repair pass produces its own `ai_usage_events` row.
- [x] 14.7 GREEN: call `ledger.admit`/`settle` per rung in `structured.ts`, injected as thunks (`StructuredLedgerDeps`) so this module never needs `LedgerAdmissionInput`'s full attribution shape — the gateway binds workspace/subject context once. Reversing `0010` also had to be added to Phase 8's own down-migration test, for the same cross-migration type-dependency reason `0009` required it.

## Phase 15: Embedding Index Generations and Chunks

- [x] 15.1 Derive migration number per Phase 0.2; write `NNNN_embedding_indexes_and_chunks.sql` creating `workspace_embedding_indexes` (`UNIQUE (workspace_id, embedding_model, dimensions)`, partial `UNIQUE (workspace_id) WHERE state = 'active'`, `CHECK (dimensions = 1536)`) and `chunks` (`vector(1536)`, `CHECK (vector_dims(embedding) = dimensions)`, FK to `nodes (id, workspace_id)` and to the generation row). — journal `idx` was 10; used `0011_embedding_indexes_and_chunks`. Reversing `0011` also had to be added ahead of Phase 8's own down-migration test (`workspace_embedding_indexes.embedding_provider` depends on 0008's `ai_provider` type) — same recurring cross-migration pattern `0009`/`0010` already required.
- [x] 15.2 RED: `packages/db/src/ai/embedding-index.test.ts` — a chunk row referencing a foreign workspace's generation is rejected; a chunk whose `(embedding_model, dimensions)` disagrees with its referenced generation is rejected; the `vector_dims` `CHECK` rejects a vector whose length disagrees with its declared `dimensions`.
- [x] 15.3 GREEN: the migration and Drizzle table definitions from 15.1 — `vector(1536)` modelled via a `customType` (no built-in pgvector column in `drizzle-orm/pg-core`), matching the existing `bytea` `customType` idiom.
- [x] 15.4 RED: `packages/core/src/ai/embedding-registration.test.ts` — a candidate embedding model emitting exactly 1536 dimensions natively registers; one emitting 3072 with a supported `dimensions: 1536` reduction registers at 1536; one emitting 1024 with no reduction is rejected (embedding-configuration spec, "Embedding Dimension Fixed at 1536").
- [x] 15.5 GREEN: `packages/core/src/ai/embedding-registration.ts` implementing the registration guard. Operates over an `EmbeddingModelCandidate` shape (mirrors `ModelCapabilities.embeddings` without requiring a registry entry) rather than only accepting an already-registered model — the current `MODEL_REGISTRY` has zero real embedding-capable entries (all unverified pending Phase 18), so testing the dimension guard itself needed a decoupled input shape.
- [x] 15.6 RED: `packages/core/src/ai/embedding-registration.test.ts` — **local fallback gap, made explicit**: given the current absence of a 1536-dimension local model, `bge-m3` and `e5-large` fixtures (1024 dims) are rejected as the local fallback, and querying the available local fallback reports "none available" — not a silently substituted incompatible model (open item — no invented model).
- [x] 15.7 GREEN: implement the explicit "no local fallback" result type and wire it into settings resolution; do not register any placeholder local model.
- [x] 15.8 RED: `packages/core/src/ai/embedding-configuration.test.ts` — a workspace with `chat_provider = deepseek` and no embedding credential resolves its effective `embedding_provider` to the local-fallback path (or the explicit "none available" result from 15.6 if no local model is registered) rather than an error. — resolves to `none-available` today (honest, since 15.6/15.7 confirm no local fallback exists yet), never an error.
- [x] 15.9 GREEN: `packages/core/src/ai/embedding-configuration.ts` implementing effective-provider resolution.
- [x] 15.10 RED: Anthropic and DeepSeek are absent from the set of providers offered for `embedding_provider` selection.
- [x] 15.11 GREEN: filter the offered set by `capabilities.embeddings !== false`. — `offeredEmbeddingProviderIds()` draws no distinction between "vendor-confirmed absent" (Anthropic, DeepSeek) and "unverified pending Phase 18" (OpenAI, Google, OpenRouter): the registry carries none, so today's offered set is empty, which is the honest state, not a claim about the latter three.

## Phase 16: Reindexing as a Tracked Job

- [x] 16.1 Derive migration number per Phase 0.2; write `NNNN_embedding_reindex_jobs.sql` creating `embedding_reindex_jobs` (partial `UNIQUE (workspace_id) WHERE state IN ('queued','running')`). — journal `idx` was 11; used `0012_embedding_reindex_jobs`. No `ai_provider`/`ai_structured_output_level` dependency this time, so the recurring Phase-8 down-migration fix was NOT needed for this one — confirmed by a full `bun run -F @deep-wiki/db test` pass with no new failures.
- [x] 16.2 RED: `packages/db/src/ai/reindex.test.ts` — changing `embedding_provider` to a model with a different `(model, dimensions)` pair creates a job with an initial progress state, and the active generation does not change until the job reaches its completion state; a retrieval-path read during an in-progress job still filters on the prior active pair. **Wording note**: "the active pair on `workspace_ai_settings`" is this task's inherited phrasing from the capability spec's literal requirement text; Phase 15 already resolved that the pair lives on `workspace_embedding_indexes` as a row (design.md — "Why the embedding pair is a table and not two columns on settings"), not as columns on `workspace_ai_settings` — the test asserts against `workspace_embedding_indexes.state = 'active'`, consistent with that already-made decision.
- [x] 16.3 GREEN: `packages/db/src/ai/reindex.ts` plus the `bun run -F @deep-wiki/db ai:reindex` script — creates a job row, flips the active generation only on completion in one transaction. **Real RED→GREEN caught here**: the first implementation tried to catch the partial-unique-index violation *inside* the same `sql.begin()` transaction and continue; Postgres poisons a transaction after any failed statement, so the subsequent implicit COMMIT itself failed and the error escaped uncaught (`(fail) startReindex > a second concurrent reindex ...`). Fixed by moving the try/catch to wrap the entire `sql.begin()` call, so a conflict rolls back the whole attempt (including the generation row already inserted/updated) before being converted to a typed refusal.

## Phase 17: Key Rotation and Boot-Time Keyring Check

- [ ] 17.1 RED: `apps/api/src/ai/rekey.test.ts` — `ai:rekey --to <id>` unwraps with the row's `key_id`, rewraps with the target, updates `wrapped_dek`/`key_id`, and leaves `ciphertext` byte-identical; a row already at the target is skipped (idempotent); `--compromised` additionally stamps `compromised_at` and invalidates the workspace's credentials.
- [ ] 17.2 GREEN: `apps/api/src/ai/rekey.ts` and the `bun run -F @deep-wiki/api ai:rekey` script.
- [ ] 17.3 RED: `apps/api/src/config.test.ts` — startup runs `SELECT DISTINCT key_id FROM workspace_ai_credentials` and aborts if any `key_id` is absent from the parsed keyring (environment-config delta — startup validation extends to keyring completeness).
- [ ] 17.4 GREEN: wire the boot-time keyring-completeness query into `apps/api/src/config.ts`'s startup sequence, alongside Phase 6's `refineEnv` check.

## Phase 18: Blocking Verification (Open Items — No Assumptions)

- [ ] 18.1 Write `apps/api/src/ai/probe.ts` and the opt-in `bun run -F @deep-wiki/api ai:probe` script (never part of `bun run test`): for each of OpenAI, Google Gemini, and OpenRouter, attempt the provider's embeddings endpoint with a live credential and record success/failure. Anthropic and DeepSeek are already excluded from `embedding_provider` per Phase 15.10 — this task **verifies**, not asserts, the remaining three.
- [ ] 18.2 Run `ai:probe` against at least one working key per provider being wired (per proposal Dependencies). Append the outcome as a dated Finding in `docs/TODO.md` (append-only — do not edit prior entries), naming exactly which of OpenAI, Gemini, OpenRouter expose a first-party embeddings endpoint.
- [ ] 18.3 Update `packages/core/src/ai/registry.ts`'s `embeddings` field for OpenAI, Gemini, and OpenRouter entries strictly from the 18.2 Finding — never from assumption. If a probe could not run (no key available in this session), leave `embeddings: false` and record that as part of the same Finding rather than guessing.
- [ ] 18.4 Append a dated Finding to `docs/TODO.md` recording the local-embedding-model gap from Phase 15.6 as a **product-facing limitation**: a fully air-gapped instance has no RAG path today, because no identified local model emits 1536 dimensions. Cross-reference `docs/TODO.md`'s existing 2026-09-03 Finding and the 2026-09-04 Open-Questions answer rather than duplicating them.
- [ ] 18.5 Write `apps/api/src/ai/conformance.ts` and the opt-in `bun run -F @deep-wiki/api ai:conformance` script (never part of `bun run test`, needs real keys and spends money): runs one fixed schema through every wired model at its declared `structuredOutput` level and exits non-zero on a mismatch against Phase 14's ladder.

## Phase 19: Docs Sync

- [ ] 19.1 Write the credential runbook section (key rotation via `ai:rekey`, the "revoke at the provider after rollback" instruction from `proposal.md`'s Rollback Plan) in `docs/SPECS.md` or a linked runbook doc, matching where Phase 1/2 runbooks already live.
- [ ] 19.2 Confirm `docs/TODO.md`'s Phase 5 checklist items (embedding verification, `chat_provider`/`embedding_provider` separation, per-chunk model/dimension recording, mixed-write rejection, per-workspace accounting) are checked off or struck with a reason, per the file's own convention.

---

## Requirement Traceability

| Capability spec | Requirements | Covered by |
|---|---|---|
| `ai-provider-registry` | Provider Abstraction via a Core Port; Per-Model Capability Registry; Structured-Output Graceful Degradation; Normalized Provider Errors | Phases 2, 5, 12, 13, 14 |
| `workspace-ai-credentials` | Envelope Encryption at Rest; Validation Probe on Save; Credentials Never Exposed; Tenant-Scoped Storage; Authorization Through the Existing Resolver | Phases 6, 7, 8, 9, 10 |
| `embedding-configuration` | Independent Chat/Embedding Providers; No Embedding-Incapable Provider Offered; Chat-Only Workspace Fallback; Embedding Dimension Fixed at 1536; Local Fallback Constrained, Not Invented | Phase 15 |
| `embedding-index-integrity` | Active Pair Recorded; Per-Row Provenance; Mismatched Writes Rejected; Declared Vector Dimension; Reindexing Is a Tracked Job | Phases 15, 16 |
| `ai-usage-accounting` | Usage Ledger; Pre-Call Admission Enforcement; Streaming Reservation and Reconciliation | Phases 3, 11, 12 |
| `prompt-assembly` | Fixed Stable-to-Volatile Ordering; Deterministic Tool Ordering; Nondeterminism Is a Defect | Phase 4 |
| `environment-config` (delta) | Envelope Master Key Validated at Startup | Phases 6, 17 |

## Threat Matrix Coverage

| Matrix row | Planned RED test |
|---|---|
| Routing — model selection | Phase 2.1 (`parseModelId` refusals), Phase 12.2 (unregistered model refused pre-client) |
| Outbound calls carrying tenant credentials | Phase 9.3–9.6 (import + decryption boundary fixtures), Phase 12.2 (no call without reservation) |
| Secret disclosure | Phase 9.1 (denylist), Phase 10.1/10.3 (`expectNoCredential`), Phase 13.3 (no key substring in mapped errors) |
| Cross-tenant credential use | Phase 8.4 (moved-row FK rejection), Phase 7.1 (wrong-AAD `open()` failure) |
| Cross-tenant vector read (GATE-3, deferred) | Phase 15.2 (FK rejection now); query-level test explicitly inherited by the retrieval slice |
| Prompt injection, executable-content, shell/subprocess, VCS automation, path traversal | N/A per `design.md` — no producer in this change; omitted, not silently skipped |
