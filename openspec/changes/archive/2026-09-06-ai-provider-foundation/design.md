# Design: AI Provider Foundation (Phase 5 — provider slice)

## Technical Approach

Six structural moves carry this change.

1. **The gateway is a chokepoint, enforced by a specifier rule.** Exactly one directory — `apps/api/src/ai/gateway/` — may import `ai`, `@ai-sdk/*` or `@openrouter/*`. `scripts/checks/query-boundaries.ts` gains that rule in the same idiom as its `permissions` rule. Admission then is not a convention a caller might skip: **no provider client can be constructed anywhere else in the repository.**
2. **Budget is enforced by one conditional `UPDATE`, not by a counter that is read and then written.** Admission reserves an upper bound; the statement returns zero rows when the workspace is over budget. Reservations carry a computed expiry, so a crashed stream self-heals without a sweeper — the same idiom Phase 2 used for the page lock.
3. **Tenant isolation reaches into the ciphertext.** Rows are pinned by composite foreign keys, and the credential's AES-GCM *additional authenticated data* is `workspace_id ‖ credential_id ‖ provider`. A ciphertext moved to another workspace's row does not decrypt to the wrong plaintext — it fails to decrypt at all.
4. **Index generations are rows, and chunks are foreign-keyed to one.** `chunks (workspace_id, embedding_model, dimensions)` references `workspace_embedding_indexes`. A chunk carrying a model the workspace never declared is **unrepresentable**, and a reindex is a second generation row rather than a destructive setting change.
5. **The capability registry is checked-in data that never edits itself.** A model with no entry is refused. A provider contradicting its entry at runtime degrades one rung and writes an observation row; the file stays under human authorship, because a self-healing registry hides exactly the drift it exists to expose.
6. **`packages/core` owns the domain in primitives only.** No `ai`/`@ai-sdk` type crosses the boundary — not even as a type — and `core-purity.ts` is hardened so that claim is checked rather than assumed.

---

## Core purity, made real rather than nominal

`core-purity.ts` is built on `Bun.Transpiler().scanImports()`, which was **measured to elide type-only imports**. `import type { LanguageModelV1 } from 'ai'` therefore passes today. The manifest rule (zero `dependencies` in `packages/core/package.json`) catches the *installed dependency*, but not a type imported from a package a sibling workspace already hoists.

**Decision: do not depend on the hole, and do not depend only on the manifest.** `core-purity.ts` gains a third rule — a source-text scan for any `from '<non-relative>'` or `require('<non-relative>')` specifier, evaluated on the raw file rather than the transpiled import list. It runs alongside `scanImports()`, not instead of it: the AST pass keeps its precision on dynamic forms, the text pass closes the type-only elision. Fixtures cover `import type … from 'ai'`, `import { type X } from 'ai'`, and a relative `import type` that must still pass.

Core's AI surface is then composed of `string`, `number`, `readonly` records, `Uint8Array`, `AsyncIterable<T>` and the existing `Result`/`Secret` primitives. Nothing else is representable there.

---

## The provider abstraction

`packages/core/src/ai/` — ports and pure policy, zero imports.

```ts
export type ProviderId = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'openrouter' | 'local';
export type StructuredOutputLevel = 'schema' | 'tool-call' | 'prompted' | 'none';

export interface ModelCapabilities {
  readonly tools: boolean;
  readonly structuredOutput: StructuredOutputLevel;
  readonly promptCaching: boolean;
  readonly vision: boolean;
  readonly contextWindow: number;
  readonly embeddings: false | { readonly dimensions: readonly number[] };
  readonly pricing: { readonly inputMicroUsdPerMTok: number; readonly outputMicroUsdPerMTok: number; readonly cachedInputMicroUsdPerMTok: number };
  readonly verifiedAt: string;                    // ISO date — provenance, not decoration
  readonly source: 'probe' | 'vendor-docs';
  readonly proxiedModel?: string;                 // openrouter entries only
}

export interface ChatRequest {
  readonly model: ModelRef;                       // parsed, never a raw user string
  readonly prefix: StablePrefix;                  // { text, hash, cacheBoundary }
  readonly volatile: readonly PromptPart[];
  readonly maxOutputTokens: number;               // REQUIRED — an unbounded call cannot be admitted
  readonly structuredOutput?: { readonly schemaJson: string; readonly level: StructuredOutputLevel };
}

export interface ChatModelPort  { generate(r: ChatRequest, key: Secret<string>): Promise<Result<ChatResult, ProviderError>>;
                                  stream  (r: ChatRequest, key: Secret<string>): Promise<Result<ChatStream, ProviderError>>; }
export interface EmbeddingModelPort { embed(r: EmbedRequest, key: Secret<string>): Promise<Result<EmbedResult, ProviderError>>; }
export interface KeyProvider    { activeKeyId(): string;
                                  wrap  (dek: Uint8Array, keyId: string): Promise<Result<Uint8Array, KeyError>>;
                                  unwrap(wrapped: Uint8Array, keyId: string): Promise<Result<Uint8Array, KeyError>>; }
export interface CredentialCipher { seal(p: Secret<string>, aad: CredentialAad): Promise<Result<SealedCredential, CipherError>>;
                                    open(s: SealedCredential, aad: CredentialAad): Promise<Result<Secret<string>, CipherError>>; }
export interface UsageLedger    { admit (i: AdmissionInput): Promise<Result<Reservation, BudgetRefusal>>;
                                  settle(id: string, u: ChatUsage): Promise<Result<void, LedgerError>>;
                                  void  (id: string, reason: VoidReason): Promise<Result<void, LedgerError>>; }
```

`ModelRef` is produced only by `parseModelId(raw)`, which requires `<providerId>:<slug>` with `providerId` in the closed union and `slug` matching `/^[a-z0-9][a-z0-9._\/-]{0,96}$/`. A raw request string never reaches a client factory; a slug embedding a URL, a scheme, or whitespace is refused before anything is constructed.

Adapters live in `apps/api/src/adapters/ai/` (cipher, key providers, local embeddings) and `apps/api/src/ai/gateway/` (the five SDK providers), exactly where Phase 1 put `MailSender` and `BlobStore`.

---

## Capability registry and structured-output degradation

`packages/core/src/ai/registry.ts` is a frozen record keyed by `<provider>:<model>`. `capabilitiesOf(ref)` returns `Result<ModelCapabilities, UnknownModel>`; **there is no default branch.** An unknown model is a typed refusal at admission, before a client, a credential decryption, or a reservation.

**The ladder is a pure function**, `degrade(level): StructuredOutputLevel | null`:

| Rung | Mechanism | On failure |
|---|---|---|
| `schema` | provider-native JSON-schema response format | one rung down, observation recorded |
| `tool-call` | a single required tool whose parameters are the schema | one rung down, observation recorded |
| `prompted` | schema in the prompt + **one** repair pass carrying the validation error verbatim | typed `structured_output_failed` — never a silent `{}` |
| `none` | not attempted | refused at admission |

Two rules make this honest. The runtime **never skips a rung**, and **never silently runs below the declared level**: dropping below `capabilities.structuredOutput` writes an `ai_capability_observations` row. And **every rung is a ledger event** — a repair pass costs money and appears in accounting rather than hiding inside one "call".

### Drift detection

A registry is a cache of someone else's product decisions and will go stale. Three mechanisms, ordered by how quickly they fire:

| Mechanism | Fires | Cost |
|---|---|---|
| **Runtime contradiction** | on the first request where declared ≠ observed | free; writes `ai_capability_observations` and degrades that call one rung |
| **Provenance assertion** | in `bun run test` — every entry must carry `verifiedAt` and `source`; an entry without them fails | free |
| **Live conformance** (`bun run -F @deep-wiki/api ai:conformance`) | on demand and as a manual CI job; runs the same schema against every wired model at its declared level and exits non-zero on mismatch | needs real keys, spends money, **never part of `bun run test`** |

The registry file is **never written by the runtime.** An operator sees contradictions through the observations table and a maintainer edits the file. Automatic self-repair would convert a visible, reviewable drift into an invisible one.

### OpenRouter overlap — what keeping both buys and costs

| | Native (Anthropic, OpenAI, Google, DeepSeek) | OpenRouter |
|---|---|---|
| **Buys** | provider-specific prompt caching (the main cost lever), lowest latency, no markup, "our data does not transit a third party" for compliance-bound self-hosters | one integration reaching models we never wired; a working path when a workspace's model is not natively supported |
| **Costs** | five client factories, five error-shape mappings, five caching idioms | a second route to the same model with **different caching and tool behaviour**, provider markup, and a data path a compliance-bound operator cannot accept |

Rules that make the overlap safe rather than merely tolerated: an OpenRouter model is an **explicitly declared registry entry** carrying `proxiedModel`, and its capabilities describe the *proxied route*, never inherited from the native entry — caching in particular does not survive the proxy. `AI_ALLOW_PROXY_PROVIDERS=false` removes the provider from selection entirely, which is the compliance answer.

---

## Credentials: envelope encryption a self-hoster can operate

```
plaintext API key (Secret<string>)
   │  AES-256-GCM, random 96-bit iv
   │  AAD = workspace_id ‖ credential_id ‖ provider     ← ciphertext is bound to its row
   ▼
ciphertext + auth_tag              stored
   ▲
   │ DEK (32 random bytes, one per credential)
   │  wrapped by KeyProvider.wrap(dek, activeKeyId)
   ▼
wrapped_dek + key_id               stored
```

| Concern | Mechanism |
|---|---|
| **Default adapter** | `AI_KEK_DRIVER=env`. `AI_KEK_KEYRING` is `id:base64key[,id:base64key…]`, `AI_KEK_ACTIVE_ID` names the writer. **Two static variable names**, so `scripts/checks/env-example.ts` (which reads `Object.keys(envSchema.shape)`) still works — a per-key variable name would have defeated the drift check |
| **Startup validation** | `refineEnv()` requires the keyring to parse, every key to be exactly 32 bytes after base64 decode, and `AI_KEK_ACTIVE_ID` to be present in it. Malformed or absent ⇒ the process does not boot |
| **Keyring completeness** | one boot query, `SELECT DISTINCT key_id FROM workspace_ai_credentials`; a key id absent from the keyring aborts startup. Discovering unreadable ciphertext at request time, per tenant, is the failure this prevents |
| **KMS is additive** | `AI_KEK_DRIVER=kms` swaps only `wrap`/`unwrap`. Because the DEK is what travels, switching drivers is a re-wrap job — **no ciphertext is ever re-encrypted** and no plaintext key is re-read |
| **Rotation** | `bun run -F @deep-wiki/db ai:rekey --to <id>`: per row, unwrap with `key_id`, rewrap with the new KEK, `UPDATE wrapped_dek, key_id`. Idempotent (rows already at the target are skipped), resumable, and it never touches `ciphertext`. Retiring the old key is legal only once the job reports zero rows referencing it |
| **Never displayed** | no plaintext column exists. The UI gets `last_four` — the four characters the provider's own console shows. **Not a hash**: a fingerprint of the full key is an offline verifier for a guessed key |
| **Never serialised** | plaintext lives as `Secret<string>` end to end; `toString()`/`toJSON()` return `[redacted]`, so an accidental `console.log` or `JSON.stringify` is inert by construction |
| **Validation probe** | the cheapest listing/echo call per provider on save. Its error is mapped to a closed code set (`invalid_key｜insufficient_quota｜network｜unknown`) **before** it reaches a logger — a provider SDK error object routinely carries the request headers |

**Rotation is not revocation.** A compromised KEK compromises every wrapped DEK, therefore every stored API key. The rekey job in `--compromised` mode additionally stamps `compromised_at` on each row and marks the workspace's credentials invalid, so the product asks for re-entry instead of quietly continuing with keys that must be revoked at the provider.

---

## Cost enforcement, in the same path that builds the call

```
route ──► gateway.call()
            │ 1. parseModelId          → unknown/invalid  ⇒ refuse (no client built)
            │ 2. capabilitiesOf        → unknown model     ⇒ refuse
            │ 3. buildPrefix           → prefix.hash, token count of the whole prompt
            │ 4. ledger.admit(reserve) → over budget       ⇒ 402 ai_budget_exceeded (reason, period, limit)
            │ 5. cipher.open(credential)                     ← first decryption happens HERE, after admission
            │ 6. construct provider client  ← only reachable inside this directory
            │ 7. stream / generate
            └─ 8. onFinish → settle(actual)   ·   onAbort/onError → void   ·   neither ⇒ expiry
```

**The reserve is an upper bound, because it can be.** Input tokens are counted from the assembled prompt, which we hold. Output is bounded by `maxOutputTokens`, which `ChatRequest` makes **required** — a call that will not name its ceiling cannot be admitted.

Admission is one statement against `workspace_ai_budget_periods`:

```sql
UPDATE workspace_ai_budget_periods
   SET reserved_micro_usd = reserved_micro_usd + $reserve
 WHERE workspace_id = $ws AND period_start = $period
   AND settled_micro_usd + $reserve
     + (SELECT coalesce(sum(reserved_micro_usd), 0) FROM ai_usage_events
         WHERE workspace_id = $ws AND period_start = $period
           AND state = 'reserved' AND expires_at > now())          <= limit_micro_usd
RETURNING reserved_micro_usd;
```

Zero rows returned means over budget. There is no read-then-write race to lose, and concurrent admissions serialise on the row.

| Failure | What happens |
|---|---|
| Stream completes | `settle(id, usage)`: event → `settled`, aggregate `reserved -= reserve`, `settled += actual`, guarded by `WHERE state = 'reserved'` so a double-settle is a no-op |
| Client disconnects / abort signal | `void(id, 'aborted')` — the SDK's abort handler; same idempotence guard |
| **Process crashes before either** | the reservation is simply excluded from the sum once `expires_at` passes (`AI_RESERVATION_TTL_SECONDS`, default 900 — longer than any admitted stream). **Expiry is computed at admission, not swept**, so there is no job to fail |
| Actual exceeds reserve | recorded truthfully; the *next* admission is refused. Overspend is bounded by one call, never unbounded. Stated plainly rather than claimed away |

`plans` gains `max_ai_cost_micro_usd_monthly` alongside its existing `max_ai_tokens_monthly`; both are enforced by the same statement. A workspace with no period row gets one seeded from its plan on first admission.

---

## Prompt assembly — what must hold for the prefix to stay stable

`buildPrefix(input): { text, hash, cacheBoundary }` is pure, in `packages/core`.

| Requirement | Mechanism |
|---|---|
| Deterministic tool ordering | tools sorted by name; serialised by a canonical JSON writer with sorted object keys and no incidental whitespace. Shuffling the input array must produce identical bytes — that is a test |
| **No volatile value can enter** | `StablePrefixInput` is structurally incapable of carrying one: its fields are `string` and `readonly string[]` sourced from the registry, the checked-in system text, and rule-pack **content** plus a content hash. There is no `Date`, no uuid, no `updated_at`. The type is the enforcement |
| Ordering | tools → system → team rule packs → (boundary) → document → question, per SPECS §8.8 |
| Cache breakpoint | `cacheBoundary` is an index computed in core; the Anthropic adapter places `cache_control` there, and every other adapter reads the same number. Two adapters computing their own boundary is how the prefix silently splits |
| Drift is observable, not assumed | `prefix_hash` is recorded on every `ai_usage_events` row. Two calls with identical input and different hashes is a defect with evidence, and a falling cached-token ratio is attributable to a model or a prefix |
| Proof | determinism (twice ⇒ deep-equal), shuffle-invariance, and a **golden file per rule-pack fixture** so a prefix change is a visible review diff rather than a quiet cache miss |

The prefix is only as stable as the rule packs feeding it; Phase 6 authors those, and this design fixes the contract they must satisfy (content and content-hash, never metadata).

---

## Extending `query-boundaries.ts` so the guard is not vacuous

`DENYLISTED_FIELDS` currently holds no AI-credential name, so rule 5 is true and empty for this change. Three additions:

**Rule 5 widened.** The scan covers `packages/contracts/src` **and** `apps/api/src/routes` (where a hand-built JSON body can leak without a schema). The denylist covers these field-name shapes:

| Shape | Examples |
|---|---|
| Exact snake_case columns | `ciphertext`, `auth_tag`, `wrapped_dek`, `key_id`, `dek`, `kek`, `key_material` |
| camelCase equivalents | `wrappedDek`, `authTag`, `keyMaterial`, `apiKey`, `apiKeyCiphertext` |
| Suffix-anchored generics | `/(_api_key\|ApiKey)$/`, `/(_secret\|Secret)$/`, `/(_token\|Token)$/`, `/(_credential\|Credential)$/` |
| Env variable names | `AI_KEK_KEYRING`, `AI_KEK_ACTIVE_ID`, `AI_KEK_KMS_KEY_ID` |

**The trap, named.** A `Token` suffix rule flags `inputTokens`, `outputTokens`, `cachedInputTokens`, `reasoningTokens` — the usage schema's legitimate counters. A guard that fires on those gets suppressed, and a suppressed guard is worse than no guard. The rule therefore carries an explicit `TOKEN_COUNT_ALLOWLIST`, and a fixture asserts both directions: the counters pass, `refreshToken` fails.

**Rule 6 — the SDK import boundary.** No file outside `apps/api/src/ai/gateway/` may import `ai`, `@ai-sdk/*` or `@openrouter/*`. This is what makes "admission is unbypassable" a machine-checked property.

**Rule 7 — the decryption boundary.** Only `apps/api/src/adapters/ai/credentials/` may import the cipher's `open`. Every other caller receives a `Secret<string>` from that module or nothing.

Rules 6 and 7 are path + specifier rules in the exact idiom of rules 1 and 2, tested against violating fixtures.

---

## Schema

Hand-written SQL in the established idiom (`drizzle-kit generate` is never run; `migration.test.ts` asserts each object exists after `migrate()`). **Numbers are assigned at apply time from `meta/_journal.json`** — `content-and-editor` is claiming `0008`–`0010` concurrently, so this design fixes migration *names*, not indices.

| Table | Key columns | Constraints |
|---|---|---|
| `workspace_ai_settings` | `workspace_id` PK, `chat_provider`, `chat_model`, `structured_output_floor`, `updated_by`, timestamps | `FK workspace_id → workspaces(id) ON DELETE CASCADE`. Chat config only — the embedding pair lives in its own table because it is FK-referenced |
| `workspace_ai_credentials` | `id`, `workspace_id`, `provider`, `ciphertext bytea`, `iv bytea`, `auth_tag bytea`, `wrapped_dek bytea`, `key_id`, `alg`, `last_four char(4)`, `validated_at`, `validation_error_code`, `compromised_at`, timestamps | `FK workspace_id → workspaces(id) ON DELETE CASCADE`; `UNIQUE (workspace_id, provider)`; `UNIQUE (id, workspace_id)` so the pair travels; index `(key_id)` for rekey. **No plaintext column exists** |
| `workspace_embedding_indexes` | `workspace_id`, `embedding_provider`, `embedding_model`, `dimensions`, `state`, `created_at`, `activated_at` | `UNIQUE (workspace_id, embedding_model, dimensions)` ← the chunk FK target; partial `UNIQUE (workspace_id) WHERE state = 'active'`; `CHECK (dimensions = 1536)` |
| `chunks` | `id`, `workspace_id`, `page_id`, `block_ids text[]`, `content`, `embedding vector(1536)`, `embedding_model`, `dimensions`, `created_at` | `FK (page_id, workspace_id) → nodes (id, workspace_id) ON DELETE CASCADE` (Phase 1's `nodes_id_workspace_id_unique`); `FK (workspace_id, embedding_model, dimensions) → workspace_embedding_indexes`; `CHECK (vector_dims(embedding) = dimensions)`. **Created here, written by nobody here** |
| `embedding_reindex_jobs` | `id`, `workspace_id`, `from_model`, `to_model`, `state`, `total_chunks`, `completed_chunks`, `started_at`, `finished_at`, `error_code` | `FK workspace_id → workspaces(id)`; partial `UNIQUE (workspace_id) WHERE state IN ('queued','running')` |
| `ai_usage_events` | `id`, `workspace_id`, `period_start date`, `subject_type`, `subject_id`, `provider`, `model`, `operation`, `state`, `input_tokens`, `output_tokens`, `cached_input_tokens`, `reserved_micro_usd`, `actual_micro_usd`, `prefix_hash`, `degradation_level`, `expires_at`, `created_at`, `settled_at` | `FK workspace_id → workspaces(id) ON DELETE CASCADE`; `CHECK (state <> 'settled' OR actual_micro_usd IS NOT NULL)`; partial index `(workspace_id, period_start) WHERE state = 'reserved'` |
| `workspace_ai_budget_periods` | `workspace_id`, `period_start`, `reserved_micro_usd`, `settled_micro_usd`, `settled_tokens`, `limit_micro_usd`, `token_limit` | PK `(workspace_id, period_start)`; `FK workspace_id → workspaces(id) ON DELETE CASCADE`; `CHECK (reserved_micro_usd >= 0 AND settled_micro_usd >= 0)` |
| `ai_capability_observations` | `id`, `provider`, `model`, `declared_level`, `observed_level`, `error_code`, `observed_at` | Instance-scoped by design: it records **our registry's** correctness, carries no tenant content, and therefore has no `workspace_id` to isolate |
| `plans` | `+ max_ai_cost_micro_usd_monthly` | `ALTER TABLE`, sequenced after `tenancy-and-permissions` archives |

**Why the embedding pair is a table and not two columns on settings.** A three-column foreign key needs a unique target. Putting the pair in `workspace_ai_settings` would force `ON UPDATE RESTRICT` on a settings row, making a model switch impossible while any chunk exists. Generations as rows give the reindex a `building` generation to fill and a one-transaction flip (`retire old → activate new`), with **no dark window** for retrieval.

**The residual obligation, stated.** Two generations can coexist during a reindex, so the retrieval slice's read filter is **three columns** — `workspace_id`, `embedding_model`, `dimensions`, taken from the active generation row. Per GATE-3 and SPECS §8.5, the model filter is **not** a substitute for the tenant filter; `workspace_id` is resolved from the authenticated subject and never from a request body or a tool argument.

---

## Data flow

```
  credential save                              inference call
   │                                            │
   ▼                                            ▼
 Secret<string> ─ probe(provider) ─ mapped     parseModelId ─→ capabilitiesOf ─→ (unknown ⇒ refuse)
   │                error code only              │
   ▼                                             ▼
 seal(AAD = ws‖cred‖provider)                  buildPrefix ─→ {text, hash, cacheBoundary}
   │  DEK ── wrap(activeKeyId) ──┐                │
   ▼                             ▼                ▼
 ciphertext, iv, auth_tag    wrapped_dek       ledger.admit(reserve)  ── over budget ⇒ 402
   └──────── one row, last_four only ─────┘        │ ok
                                                   ▼
                                        cipher.open ─→ Secret<string> ─→ gateway client
                                                   │
                                        stream ────┼── finish ⇒ settle(actual)
                                                   ├── abort  ⇒ void
                                                   └── crash  ⇒ expires_at, excluded at next admission
```

---

## Testing strategy (Strict TDD, `bun run test`)

Every unit is RED first. **No test in `bun run test` touches a network or spends money** — that is a rule, and the recorded-fixture mechanism is how it is kept.

| Layer | What | Needs |
|---|---|---|
| Pure unit — `packages/core` | `parseModelId` (including the URL-in-slug and whitespace refusals), registry lookup and refusal, `degrade()` ladder, cost arithmetic from token counts and the price table, the budget state machine (reserve→settle / →void / →expire) as a pure transition function, `buildPrefix` determinism + shuffle-invariance + goldens, AAD construction | Nothing |
| Pure unit — cipher adapter | seal/open round trip; open with a **wrong AAD** fails; open with a wrong `key_id` fails; rekey preserves plaintext and leaves `ciphertext` byte-identical; the sealed blob contains no plaintext substring | `node:crypto` only |
| Provider adapters | Each provider's wire response **recorded once** and replayed through an injected `fetch`. The SDK factories accept a custom `fetch`, so adapters take it by injection. A scrubber test asserts no fixture contains an API-key-shaped string | Checked-in fixtures |
| DB integration | Composite-FK rejections (credential under another workspace; chunk pinned to a foreign index; chunk whose model ≠ its generation); the admission `UPDATE` under two concurrent transactions; an expired reservation excluded from the sum; settle and void idempotence; `vector_dims` CHECK; partial-unique on the active generation; every migration `up` **and** `down` | Real Postgres, auto-provisioned |
| Route — `apps/api` | Credential save returns `last_four` and nothing else — `expectNoCredential(response)` scans the serialised body for the plaintext; over-budget refusal asserts **the fake provider was never called**; an aborted stream leaves no live reservation after TTL; a probe failure logs a mapped code and no key substring | Real Postgres |
| Structural — `scripts/checks` | Rule 6 and 7 fixtures; the widened denylist including the `inputTokens`-must-pass / `refreshToken`-must-fail pair; `core-purity` type-only-import fixtures; `env-example` drift | Nothing |
| **Opt-in, outside `bun run test`** | `ai:probe` (per-provider embedding support → a `docs/TODO.md` Finding), `ai:conformance` (structured output at each declared level), fixture re-recording | Real keys, network, money |

---

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| **Routing — model selection** | **Applicable** — a user-supplied string selects a provider client and a base URL | `parseModelId` over a closed `ProviderId` union and a restricted slug charset; the model must exist in the checked-in registry; base URLs come from the registry/env and never from a request | An unregistered `openrouter:evil/model` is refused; a slug containing `https://`, `..`, or whitespace is refused by `parseModelId`; refusal happens before any client is constructed |
| **Process integration — outbound calls carrying tenant credentials** | **Applicable** — third-party HTTP with a decrypted key | One gateway directory, machine-enforced by rule 6; decryption after admission only, enforced by rule 7; `AI_ALLOW_PROXY_PROVIDERS=false` removes the proxy path entirely | Import-boundary fixtures for both rules; a call cannot reach the fake provider without a reservation |
| **Secret disclosure — response, log, or error object** | **Applicable** | `Secret<T>` end to end; provider errors mapped to a closed code set before any logger sees them; widened denylist; no plaintext column | `expectNoCredential` on every credential route; a probe with a bad key produces `invalid_key` and no key substring in body or log |
| **Cross-tenant credential use** | **Applicable** | Composite FK `(id, workspace_id)` plus AAD-bound ciphertext — a relocated row does not decrypt at all | Move a ciphertext to another workspace's row and assert `open()` fails rather than returning wrong plaintext |
| **Cross-tenant vector read (GATE-3)** | **Deferred, with its inputs fixed here** | No similarity query ships. Every table carries a non-nullable, composite-FK-tied `workspace_id`; the active `(model, dimensions)` pair is a workspace-scoped row so the retrieval `WHERE` has one available | FK rejection tests now; the query-level test belongs to the retrieval slice and is recorded as inherited |
| **Prompt injection from document content** | N/A **with reason** — the volatile prompt segment has no producer in this change: no chunking, no retrieval, no tools, no agent writes. Inherited by Phase 5 retrieval and Phase 7 `packages/ai-tools` | — | — |
| Executable-file / active-content classification | N/A — no content is rendered or executed here | — | — |
| Shell / subprocess | N/A — this change spawns nothing | — | — |
| VCS / PR automation | N/A — no VCS automation | — | — |
| Path traversal | N/A — no filesystem writes; the blob store is untouched | — | — |

---

## Architecture Decisions

| # | Decision | Rationale | What would reverse it |
|---|---|---|---|
| D1 | One gateway directory is the only place allowed to import `ai`/`@ai-sdk/*`, enforced by a `query-boundaries` specifier rule | Turns "no provider call bypasses admission" from a convention into a machine-checked property. Review discipline does not survive the fourth contributor | Nothing foreseeable |
| D2 | Cost admission is a **single conditional `UPDATE`** returning zero rows when over budget | An advisory counter reports overspend; it does not prevent it. One statement removes the read-then-write race, exactly as Phase 2's lock acquisition did | Nothing foreseeable |
| D3 | `maxOutputTokens` is required on `ChatRequest`, so the reservation is a genuine upper bound | A call that will not name its ceiling cannot be bounded, and an unbounded reservation is not enforcement | A provider that ignores the ceiling, which is a bounded per-call overspend, recorded honestly |
| D4 | Reservation expiry is **computed at admission**, never swept | A crashed process skips both `onFinish` and `onAbort`; a sweeper that must run is one more thing that can fail silently. Same idiom as Phase 2's D15 | Reservation TTLs shorter than a legitimate long stream, which is a constant change |
| D5 | Envelope encryption with a per-credential DEK and a `KeyProvider` port; env keyring is the default adapter, KMS is additive | A KMS-only scheme breaks the self-hosting promise in SPECS §1. Because only the DEK travels, switching drivers is a re-wrap, not a re-encryption | Nothing — KMS remains available for those who want it |
| D6 | The keyring is **two static env variables** (`AI_KEK_KEYRING`, `AI_KEK_ACTIVE_ID`), not one variable per key | `env-example.ts` reads `Object.keys(envSchema.shape)`; dynamic variable names would silently defeat the drift check | Nothing foreseeable |
| D7 | GCM **AAD binds ciphertext to `workspace_id ‖ credential_id ‖ provider`** | Extends Phase 1's composite-FK philosophy into the ciphertext: a relocated row fails to decrypt rather than decrypting into the wrong tenant | Nothing foreseeable |
| D8 | Startup fails when a stored `key_id` is missing from the keyring | Discovering unreadable ciphertext one tenant at a time, mid-request, is the worst possible moment to learn a key was retired early | Nothing foreseeable |
| D9 | `last_four` is stored; no fingerprint or hash of the key | A hash of a full API key is an offline verifier for a guessed key. Four characters is what the provider's own console shows | Nothing foreseeable |
| D10 | A model with no registry entry is **refused**, and the registry is never written by the runtime | Optimistic calling is how "works on Anthropic, fails on DeepSeek" ships. A self-healing registry hides the drift it exists to expose | Nothing foreseeable |
| D11 | Drift is detected three ways: runtime contradiction rows, provenance assertions in `bun run test`, and an opt-in live conformance command | A registry is a cache of someone else's product decisions. Assuming it stays true is the failure; the observations table makes staleness visible without spending money in CI | Nothing foreseeable |
| D12 | Structured output degrades one rung at a time, each rung a separate ledger event, with exactly one repair pass | Skipping rungs hides which level a provider actually honours; a free repair pass hides its cost; an unbounded repair loop hides a broken model behind a bill | Nothing foreseeable |
| D13 | Both OpenRouter and the four native providers are kept; OpenRouter entries are explicit and declare the **proxied route's** capabilities | Native buys caching, latency, no markup and compliance; the proxy buys reach. Inheriting native capabilities across the proxy would be the silent lie | A compliance mandate, which `AI_ALLOW_PROXY_PROVIDERS=false` already answers |
| D14 | `chunks` is foreign-keyed to a `workspace_embedding_indexes` **generation row**, not to columns on settings | Makes a mixed-model chunk unrepresentable rather than merely rejected in application code, and gives a reindex a second generation to fill instead of a destructive setting change with a dark window | A deployment needing more than one dimension, which is a per-deployment migration per SPECS §14 |
| D15 | `chunks` ships here with no writer and no query | The integrity contract has to exist before rows do; specifying it after chunks exist is a migration over live vectors (SPECS §8.4) | Nothing foreseeable |
| D16 | `core-purity.ts` gains a raw-source specifier scan alongside `scanImports()` | `scanImports()` was measured to elide type-only imports, so a type-only SDK import passes today. Depending on a hole nobody should depend on is not enforcement | Nothing foreseeable |
| D17 | The denylist carries an explicit token-count allowlist | `inputTokens`/`outputTokens` would otherwise trip a `Token` suffix rule, and a guard that fires on legitimate fields gets suppressed — worse than no guard | Nothing foreseeable |
| D18 | `StablePrefixInput` is structurally incapable of carrying a timestamp, uuid, or random value | Cache destruction by an accidental `updated_at` is invisible until the bill arrives. The type is cheaper and more reliable than a review rule | Nothing foreseeable |
| D19 | `prefix_hash` is recorded on every ledger event | Converts "the cache should be working" into an attributable claim with evidence | Nothing foreseeable |
| D20 | `ai_capability_observations` has no `workspace_id` | It records our registry's correctness, not tenant content. Adding a tenant column would imply an isolation obligation over data that has no tenant | An observation that must carry a prompt excerpt, which it must never do |

---

## Work Units

Delivery is `single-pr` with `size:exception` accepted. **400-line budget risk: High**, accepted. Tests ship with the behaviour they verify; each unit leaves `bun run check && bun run test && bun run typecheck && bun run lint` green.

| # | Commit | Gate | Rollback boundary |
|---|---|---|---|
| 1 | `feat(checks): core purity rejects type-only non-relative imports` | Must precede unit 2 | `core-purity.ts` rule 3 + fixtures |
| 2 | `feat(core): provider identity, capability registry and the degradation ladder` | — | `packages/core/src/ai/{ids,registry,degrade}.ts` |
| 3 | `feat(core): token cost model and the budget reserve/settle state machine` | — | `packages/core/src/ai/{pricing,budget}.ts` |
| 4 | `feat(core): stable prompt prefix with deterministic tool ordering and goldens` | — | `packages/core/src/ai/prefix.ts` + goldens |
| 5 | `feat(core): chat, embedding, cipher, key-provider and ledger ports` | — | `packages/core/src/ai/ports.ts` |
| 6 | `feat(contracts): key provider driver and a keyring validated at startup` | — | `env.ts` additions, `env.example`, `refineEnv` branch |
| 7 | `feat(api): envelope cipher with aad-bound ciphertext and a keyring key provider` | — | `apps/api/src/adapters/ai/cipher/`, `key-provider/` |
| 8 | `feat(db): workspace ai settings and credential rows with no plaintext column` | — | the settings + credentials migration |
| 9 | `feat(checks): credential field denylist, sdk import and decryption boundaries` | **Must precede unit 12** so the boundary is enforced from the first SDK import | `query-boundaries.ts` rules 5–7 + fixtures |
| 10 | `feat(api): credential save with a validation probe that never returns the key` | — | `routes/ai-credentials.ts`, `expectNoCredential` |
| 11 | `feat(db): usage ledger with reservation, computed expiry and idempotent settlement` | — | the ledger + budget-periods migration, `plans` quota column |
| 12 | `feat(api): the single ai gateway — admission before any provider is constructed` | Depends on 9 | `apps/api/src/ai/gateway/index.ts` |
| 13 | `feat(api): vercel ai sdk adapters replayed from recorded fixtures` | — | the five adapters + `fixtures/providers/` |
| 14 | `feat(api): structured output degradation recording provider contradictions` | — | `gateway/structured.ts`, observations migration |
| 15 | `feat(db): embedding index generations and a chunk table pinned to one` | — | the generations + `chunks` migration |
| 16 | `feat(db,api): reindexing as an explicit tracked resumable job` | — | jobs migration + `ai:reindex` |
| 17 | `feat(api): key rotation as a re-wrap job with a boot-time keyring check` | — | `ai:rekey`, the startup check |
| 18 | `docs: embedding-support findings, the key runbook and the revocation rule` | — | doc diffs only |

The sequencing that matters is enforced by the dependency graph, not only by intent: **no `@ai-sdk/*` package is installed before unit 13**, and unit 9's boundary rule is already green when it arrives.

---

## Migration / Rollout

| Migration (name, not number) | Up | Down |
|---|---|---|
| `ai_settings_and_credentials` | `workspace_ai_settings`, `workspace_ai_credentials` | Drop both — **including the ciphertext rows** |
| `ai_usage_ledger` | `ai_usage_events`, `workspace_ai_budget_periods`, `plans.max_ai_cost_micro_usd_monthly` | Drop tables, drop the column |
| `ai_capability_observations` | the observations table | Drop |
| `embedding_indexes_and_chunks` | `workspace_embedding_indexes`, `chunks`, `embedding_reindex_jobs` | Drop in reverse |

Numbers come from `meta/_journal.json` at apply time; `content-and-editor` is concurrently claiming `0008`–`0010`. This change **must be sequenced after `tenancy-and-permissions` archives**, because it alters that change's `plans` table.

### Rollback — key material, not just tables

1. **Code.** Revert the PR. No consumer references the provider layer and no AI call path remains reachable.
2. **Schema.** Downs applied in reverse. The credentials `down` **drops the ciphertext rows** rather than orphaning blobs whose wrapping key is about to disappear.
3. **Key material stays.** The KEK is not deleted by rollback. A rotated-away key makes any surviving ciphertext permanently unreadable, and roll-forward is the practical path.
4. **Revocation is the default instruction, not a suggestion.** After rollback, workspace owners must re-enter provider keys **and should revoke the previous ones at the provider.** A system that stored a credential and was then rolled back **cannot prove non-exposure** — the logs that would prove it are part of what was reverted. The runbook says revoke; it does not say "if you are worried".
5. **Rotation is not rollback.** A compromised KEK is a `ai:rekey --compromised` run, which re-wraps every DEK *and* stamps `compromised_at` so the product asks for re-entry. Re-wrapping alone would leave keys that must be revoked quietly in service.
6. No production deployment exists, so no live tenant credentials are at risk today.

---

## Open Questions

- [ ] **The concrete embedding default is still owned by the retrieval slice.** The dimension is settled at 1536 (SPECS §14) and the schema declares it; which model fills the first generation row is a settings value, not a schema constant.
- [ ] **A 1536-dimension local fallback is unsolved.** bge-m3 and e5-large emit 1024. This design ships the `EmbeddingModelPort` seam and a `local` `ProviderId` so a fallback is additive, and deliberately invents no model. Until one is identified, a fully air-gapped instance has no RAG — recorded, not solved.
- [ ] **Per-provider embedding support is verified by `ai:probe` as a blocking task**, not asserted here. A provider whose support is unconfirmed is not offered as an `embedding_provider`.
- [ ] Reservation TTL (900 s) is a judgement bounding the maximum admitted stream. It is a one-constant change once real streaming latencies exist.
- [ ] Migration indices collide with `content-and-editor`; whichever change applies second renumbers. The journal is the arbiter.
- [ ] This document exceeds the 800-word design budget, as Phase 1's and Phase 2's did. The brief required the schema, the key-management story, the admission mechanics, the guard extension, work units, decisions and a rollback plan covering key material; those cannot be stated at that length without becoming unverifiable.
