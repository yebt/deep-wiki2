# Proposal: AI Provider Foundation (Phase 5 — provider slice)

## Intent

Phase 5 is the whole AI layer, but its provider half depends on nothing from `packages/markdown`. This change takes **only that half**, so it can be built in parallel with Phase 2 (`content-and-editor`).

Two things force it now rather than later. **Providers are not interchangeable** (SPECS §8.2), so the capability registry and its degradation path must exist before any caller assumes tool calling or structured output. And **embeddings are immutable after indexing** (SPECS §8.4, TODO Finding 2026-09-03): `embedding_model` and `dimensions` must be recorded per chunk and unmixable within an index. Specifying that constraint after chunks exist is a migration over live vectors.

## Scope

### In Scope

| Deliverable | Constraint |
|---|---|
| Vercel AI SDK as the single inference abstraction; Anthropic, OpenAI, Gemini, DeepSeek, OpenRouter | Native for the first three, OpenAI-compatible adapter for DeepSeek, OpenRouter as catch-all |
| Per-model capability registry: tools, structured output, prompt caching, vision, context window, **embedding support** | Degradation is deliberate: native schema → tool call → prompted JSON with a repair pass |
| BYOK per workspace: envelope encryption at rest, validation probe on save, decryption server-side only | Never serialised to a client, never logged, never in a `*Response*` schema |
| `chat_provider` / `embedding_provider` as independent settings with independent credentials | Hard requirement (SPECS §14). Choosing a chat model never chooses an embedding model |
| Embedding-index integrity contract: `embedding_model` + `dimensions` per chunk, mixed writes rejected, reindex an explicit tracked resumable job | Specified now; no chunks exist yet |
| Per-workspace token and cost accounting feeding Phase 1 plan limits | Enforced, not advisory — see Risks |
| Prompt assembly ordered stable-prefix first (tools → system → volatile document/question) | Deterministic tool ordering; nondeterminism in the prefix is a defect |

### Out of Scope

Chunking and the RAG retrieval path (need `packages/markdown` from Phase 2); the idea → interrogation → design-document flow; the AI panel and any provider-settings UI; team rule packs (Phase 6); MCP and `packages/ai-tools` (Phase 7). **No UI ships here**, so the standing UI human gate is not triggered.

## Capabilities

### New Capabilities

- `ai-provider-registry`: SDK integration, the five providers, per-model capability registry, structured-output degradation
- `workspace-ai-credentials`: BYOK, envelope encryption, validation on save, non-exposure guarantees
- `embedding-configuration`: `embedding_provider` independent of `chat_provider`, local fallback adapter
- `embedding-index-integrity`: model/dimension recorded per chunk, mixed writes rejected, reindex as a tracked job
- `ai-usage-accounting`: the usage ledger and plan-limit enforcement
- `prompt-assembly`: stable-prefix ordering for cache reuse

### Modified Capabilities

- `environment-config`: adds a requirement that the envelope master key (or the configured key-provider) is validated at startup and fails fast when absent or malformed

> **Not deltaed here:** `tenancy-model`'s `plans` table gains quota columns, but its baseline is still in flight in `openspec/changes/tenancy-and-permissions/`. Tracked as a dependency, not a delta, so the two changes do not collide.

## Approach

Split at the hexagonal boundary. **`packages/core` stays framework-free** and owns the domain shape: provider/model identity, the capability registry and its degradation policy, the cost calculation, the index-integrity rule, and the ports (`ChatModel`, `EmbeddingModel`, `CredentialCipher`, `UsageLedger`). **The Vercel AI SDK adapters live outside `core`**, in `apps/api`, exactly as Phase 1 placed `MailSender` and `BlobStore` adapters.

Envelope encryption uses a `KeyProvider` port. The default adapter reads an operator-supplied master key from the environment — a scheme a self-hoster can actually operate. A cloud KMS is an optional second adapter, never the assumption; a KMS-only design breaks the self-hosting promise in SPECS §1. Each credential row stores its wrapping key id so rotation is possible without a re-entry campaign.

Provider capability data is a checked-in registry with tests, not runtime discovery: a model whose capabilities are unknown is refused, not optimistically called.

## Cross-cutting gates

| Gate | Assessment |
|---|---|
| **GATE-1 — permissions** | **Must not regress.** Every credential read, settings write and usage query resolves authorisation through the existing `can()` / `canOperateInstance()` path. No new module may reference the `permissions` table — `scripts/checks/query-boundaries.ts` rule 1 stays green. |
| **GATE-2 — markdown round-trip** | Untouched. No markdown parsing or serialisation in scope. |
| **GATE-3 — vector tenant isolation** | **Not implemented here** (no similarity search exists yet), but this change fixes where the gate's inputs live. For GATE-3 to be enforceable later: every table added here (`workspace_ai_settings`, credentials, usage ledger) and the future `chunks` table MUST carry a non-nullable `workspace_id` tied by the composite `(id, workspace_id)` foreign key pattern; `workspace_id` MUST be resolved from the authenticated subject, never read from a request body or a tool argument; and the active `(embedding_model, dimensions)` pair MUST be a property of the workspace, so a retrieval query has a workspace-scoped filter available inside the `WHERE` clause. Model mismatch is **not** a substitute for the tenant filter. |

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `packages/core/src/ai/` | New | Ports, capability registry types, degradation policy, cost model, index-integrity rule — zero framework imports |
| `apps/api/src/adapters/ai/` | New | Vercel AI SDK provider adapters, cipher and key-provider adapters, local embedding adapter |
| `packages/db/src/schema.ts`, `packages/db/migrations/` | Modified | `workspace_ai_settings`, `workspace_ai_credentials`, `ai_usage_events`; plan quota columns |
| `packages/contracts/src/` | Modified | Provider settings and usage schemas; **no response schema may carry a credential field** |
| `packages/contracts/src/env.ts`, `env.example` | Modified | Key-provider driver and master-key variables; drift is CI-enforced |
| `scripts/checks/query-boundaries.ts` | Modified | Extend `DENYLISTED_FIELDS` with the new credential field names, so the guard actually covers them |
| `docs/TODO.md` | Modified | Append the per-provider embedding-support Finding (append-only; other agents are active in this file) |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Per-provider embedding support is unverified.** Coverage for embeddings differs from coverage for chat, and the gap is not uniform across the five (TODO Finding 2026-09-03). No external documentation source was reachable from this session, so this proposal asserts nothing about which providers expose a first-party embeddings endpoint | High | **Verification is a blocking task**, not an assumption: probe each provider's embeddings surface through the SDK before wiring it, and record the outcome as a Finding in `docs/TODO.md`. A provider whose support is unconfirmed is not offered as an `embedding_provider` |
| **OpenRouter overlaps the other four.** It buys: one integration reaching everything else, useful when a workspace's model is not natively wired. It costs: a second path to the same model with different caching behaviour, a capability matrix for proxied models that the registry cannot statically own, provider markup, and a data path a compliance-bound self-hoster cannot accept | Med | Keep both, and say why in the design: native providers exist for prompt caching, latency, no markup, and compliance (SPECS §8.1). OpenRouter models enter the registry as explicitly-declared entries, never inferred |
| **Key management that assumes a cloud KMS** breaks the self-hosted promise | High | `KeyProvider` port; env-supplied master key is the default adapter and the one the docs teach. KMS is additive |
| **Advisory accounting will not enforce a plan limit.** A ledger written after the fact reports overspend, it does not prevent it | High | Enforcement is a pre-call admission check in the same server path that constructs the provider call — no provider call is reachable without passing it. Streaming settles cost post-completion, so admission reserves an estimate and reconciles on finish; a workspace over budget is refused with a user-facing reason, not a generic error |
| **Structured-output degradation is untested per provider** — the fallback chain is where "works on Anthropic, fails on DeepSeek" hides | Med | One conformance suite runs the same schema through every wired model at its declared level, per `strict_tdd` |
| **A credential leaks through a response, a log line, or an error object** | High | Denylist extension in `query-boundaries.ts`; credentials never enter a `*Response*` schema; probe/validation errors are mapped to a safe shape before they reach a logger |

## Escalated Open Question — the embedding default

`docs/TODO.md` still owes **"embedding provider and model to standardise on"**. It is not decided here.

| Specifiable without the answer | Genuinely blocked on it |
|---|---|
| That `embedding_model` and `dimensions` are recorded per chunk and immutable within an index; that mixed writes are rejected; that reindexing is an explicit tracked job; that `embedding_provider` is configured independently of `chat_provider` | The concrete default provider and model; the declared dimension of the `embedding` column; ANN index sizing; what the local fallback must match dimensionally |

Note that SPECS §8.4 writes the column as an undimensioned `vector`. Whether pgvector will build an ANN index over an undimensioned column must be **verified against the running container**, not assumed — the answer decides whether the dimension is a schema constant or a per-deployment migration input. Both belong to the retrieval slice; this change must not pick the default on the owner's behalf.

## Rollback Plan

Reverting code does not undo encryption, so rollback has to address key material.

1. **Code**: revert the PR. No consumer references the provider layer; no AI call path remains reachable.
2. **Schema**: each migration ships a tested `down`, applied in reverse (`ai_usage_events` → `workspace_ai_credentials` → `workspace_ai_settings` → plan quota columns). The credentials `down` **drops the ciphertext rows** rather than orphaning blobs whose wrapping key is about to disappear.
3. **Key material**: the master key stays in the operator's environment and is **not** deleted by rollback — a rotated-away key makes any surviving ciphertext permanently unreadable. Document explicitly: after rollback, workspace owners must re-enter provider keys, and **should revoke the previously-stored keys at the provider**, because a system that stored them and was then rolled back cannot prove they were never exposed.
4. **Rotation**: because each row records its wrapping key id, a compromised master key is a re-wrap job, not a schema change.
5. No production deployment exists, so no live tenant credentials are at risk today; the practical path is roll-forward with a corrective migration.

## Dependencies

- Phase 1 (`tenancy-and-permissions`) for `workspaces`, `plans`, and `can()`. Quota columns extend its `plans` table — sequence after it archives, or the two changes conflict.
- Postgres with `pgvector` (present since Phase 0). No vector query is written here.
- Provider API keys for the verification tasks; at least one working key per provider being wired.
- **Not blocking this change; blocking the retrieval slice:** the embedding-default Open Question.

## Success Criteria

- [ ] Per-provider embedding support is verified by probe and recorded as a Finding in `docs/TODO.md` — no provider is offered as an `embedding_provider` on an assumption
- [ ] A model with no registry entry is refused rather than called optimistically
- [ ] The structured-output conformance suite passes at each model's declared degradation level
- [ ] A stored credential cannot be produced by any HTTP response, log line, or error path; `query-boundaries.ts` covers the new field names and `bun run check` is green
- [ ] `chat_provider` and `embedding_provider` are separately configurable, and a chat-only credential still yields a usable embedding configuration via the local fallback
- [ ] A write carrying a different `embedding_model` or `dimensions` than the index's active pair is rejected by the database, not only by application code
- [ ] A workspace over its plan budget is refused **before** the provider call, with a user-facing reason
- [ ] `workspace_id` is non-nullable and composite-FK-tied on every table added here, and is never read from a request body
- [ ] `packages/core` purity check still passes with the provider domain inside it
- [ ] `bun run check`, `bun run test`, `bun run typecheck`, `bun run lint` all green
