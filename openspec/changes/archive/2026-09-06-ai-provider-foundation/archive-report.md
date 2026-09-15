# Archive Report: AI Provider Foundation

**Change**: `ai-provider-foundation`
**Archived**: 2026-09-06
**Status**: Complete and Verified
**Verification**: PASS (47/47 scenarios, 26/26 requirements, 0 CRITICAL, 0 WARNING, 1 non-blocking SUGGESTION)
**Tasks**: 102/102 complete (100 planned + 2 remediation tasks for embedding-index-integrity dimension scenarios)

---

## Final State Summary

The AI Provider Foundation change (Phase 5 provider slice) is fully implemented, verified, and archived. All 102 tasks are complete, `sdd-verify` returned PASS on re-verification, and the structural gates (`bun run typecheck`, `lint`, `check`) all exit 0.

**Baseline state before this change**: 13 baseline capabilities in `openspec/specs/`, no AI provider layer, no embedding index integrity guarantees, no usage accounting.

**Final state after this change**: 19 baseline capabilities (13 + 6 new), environment-config extended with envelope-key validation, full AI provider foundation in place with capability registry, envelope encryption, usage accounting, embedding-index integrity, and prompt assembly.

---

## Capabilities Delivered

### New Capabilities Added to Baseline

| Capability | Spec File | Key Requirements | Status |
|---|---|---|---|
| **AI Provider Registry** | `openspec/specs/ai-provider-registry/spec.md` | Vercel AI SDK as single abstraction; per-model capability registry (tools, structured output, prompt caching, vision, context window, embedding support); degradation ladder (schema → tool call → prompted) | ✅ Delivered |
| **Workspace AI Credentials** | `openspec/specs/workspace-ai-credentials/spec.md` | BYOK per workspace; envelope encryption at rest; validation probe on save; credentials never serialized to client or logged | ✅ Delivered |
| **Embedding Configuration** | `openspec/specs/embedding-configuration/spec.md` | `embedding_provider` independent of `chat_provider`; independent credentials per provider; local fallback adapter available | ✅ Delivered |
| **Embedding-Index Integrity** | `openspec/specs/embedding-index-integrity/spec.md` | `embedding_model` + `dimensions` recorded per chunk; mixed writes rejected; reindex as explicit tracked resumable job | ✅ Delivered |
| **AI Usage Accounting** | `openspec/specs/ai-usage-accounting/spec.md` | Usage ledger with per-workspace token and cost tracking; plan-limit enforcement (not advisory); budget reserve/settle/void/expire state machine | ✅ Delivered |
| **Prompt Assembly** | `openspec/specs/prompt-assembly/spec.md` | Stable-prefix ordering (tools → system → team rules → document → question); deterministic tool ordering; nondeterminism flagged as defect | ✅ Delivered |

### Modified Capabilities

| Capability | Change | Details |
|---|---|---|
| **Environment Config** | Extended | Added requirement: Envelope Master Key Validated at Startup (3 scenarios: valid key present, key absent, key malformed). All existing requirements preserved. |

---

## Specifications Synced into Baseline

### New Specs Created (6)

```
openspec/specs/ai-provider-registry/spec.md          [Copied from change, 226 lines]
openspec/specs/ai-usage-accounting/spec.md           [Copied from change, 314 lines]
openspec/specs/embedding-configuration/spec.md       [Copied from change, 295 lines]
openspec/specs/embedding-index-integrity/spec.md     [Copied from change, 319 lines]
openspec/specs/prompt-assembly/spec.md               [Copied from change, 254 lines]
openspec/specs/workspace-ai-credentials/spec.md      [Copied from change, 298 lines]
```

### Existing Spec Modified (1)

```
openspec/specs/environment-config/spec.md
  - Preserved: 3 existing requirements (Documented Environment Template, Typed Configuration Loading, Fail Fast on Missing or Malformed Configuration)
  - Added: 1 new requirement (Envelope Master Key Validated at Startup) with 3 scenarios
  - Merge method: Appended ADDED requirement section, preserving all existing content
```

**Verification**: All spec files copied mechanically with `cp -R`, verified byte-identical with `diff -r`. Environment-config merge performed with Edit to append new requirement while preserving existing requirements.

---

## Archive Contents

| Artifact | Status | Location |
|---|---|---|
| Proposal | ✅ | `openspec/changes/archive/2026-09-06-ai-provider-foundation/proposal.md` |
| Design | ✅ | `openspec/changes/archive/2026-09-06-ai-provider-foundation/design.md` |
| Specs (7 domains) | ✅ | `openspec/changes/archive/2026-09-06-ai-provider-foundation/specs/` |
| Tasks | ✅ | `openspec/changes/archive/2026-09-06-ai-provider-foundation/tasks.md` (102/102 complete) |
| Verify Report | ✅ | `openspec/changes/archive/2026-09-06-ai-provider-foundation/verify-report.md` |

---

## Verification Summary

**Command suite**: `bun run test` (root + checks) + `bun run typecheck && bun run lint && bun run check`
**Test results**: All 9 workspace members passing; 47/47 scenarios verified; 26/26 requirements verified
**Blocker status**: 0 CRITICAL, 0 WARNING (1 non-blocking SUGGESTION recorded in verify-report)
**Structural gates**: All 8 checks pass (core-purity, env-example drift, workspace shape, test-coverage, workspace members, test assertions, query-boundaries, structured-output ladder)

**Re-verification context** (from verify-report): The initial full pass raised 2 findings:
1. **CRITICAL — `embedding-index-integrity` dimension scenarios untested**: Remediated in commits `8ef8762` and `eb5753c` with two independent dimension-assertion tests reading the PostgreSQL catalog (`pg_class`, `pg_attribute`, `pg_index`) to verify HNSW index presence and type-cast enforcement. Both tests independently reproduced the RED claim before remediation, confirming the assertions are not vacuous. 
2. **WARNING — test rename in embedding-index-integrity**: Assessed as honest documentation of genuinely unreachable defence-in-depth code (the `chunks_vector_dims_check` constraint is mathematically guaranteed to hold given the fixed-length `vector(1536)` type cast and the FK to `workspace_embedding_indexes` with its own `CHECK dimensions = 1536`). The rename correctly redirects the scenario to the mechanism that actually enforces rejection (the type cast, proven by the adjacent pgvector-specific error message test).

**Final verdict**: PASS, no blockers.

---

## Accepted Gaps and Limitations

These gaps are intentional and documented (not defects):

1. **Embedding support for OpenAI, Google Gemini, and OpenRouter is unverified**: The optional `ai:probe` script ran with no API keys available and correctly reported `unknown` status (never `supported`), so embedding capability cannot be confirmed for those three providers. A future session must run `ai:probe` with real keys before offering them as `embedding_provider` selections. DeepSeek and Anthropic are verified to offer no embedding support.

2. **No 1536-dimension local embedding model identified**: Baseline vector storage uses `vector(1536)` fixed dimension. Surveyed models (bge-m3, e5-large) emit 1024 dimensions. A fully air-gapped instance has no in-process RAG embedding path today. Recorded as a product limitation; the gap is acceptable given the cloud-first positioning.

3. **Structured-output degradation is policy-level**: Phase 14's structured-output ladder implements the degradation *policy* (schema → tool call → prompted JSON) without implementing each adapter's native schema-mode or tool-forcing wire mechanics. The policy is enforced and tested; provider-native mechanics remain out of scope.

4. **`ai:rekey --compromised` scope interpretation**: Task 17.3 specified "rekey the rows a run actually rewraps," which was implemented to rewrap only the rows affected by the target key id in a single scheduled job. A future operator may interpret "rekey" as "rekey all credentials," but this narrower reading is documented and valid.

5. **First embedding configuration scenario is proxy-tested**: The scenario "Workspace selects embedding provider on first config" is tested via direct `EmbeddingConfigService` calls, not via HTTP route. No route writes `embedding_provider` in this slice (it's routed to Phase 2 UI), so the HTTP integration is left to that phase.

6. **`chunks_vector_dims_check` is genuinely unreachable dead code**: Given the all-1536 schema, the named CHECK constraint can never fail independently. Documented as defence-in-depth rather than hidden; the spec and test both explain why it is provably unreachable in this configuration.

---

## CRITICAL MERGE CONFLICT: Migration Numbering

**This MUST be resolved before merging either branch to `main`.**

This change's migrations: **`0008`–`0012`** (5 migrations for settings, credentials, observations, ledger, chunks, generations, reindex jobs, rekey audit)

Concurrent `content-and-editor` branch independently claims: **`0008`–`0010`** (for different tables: `page_content`, `knowledge_graph`, `page_locks`)

**Current state**: `main` branch currently ends at migration `0007` (per `packages/db/drizzle/meta/_journal.json`).

**Resolution rule**: Whichever branch merges to `main` second must renumber its migrations, deriving new numbers from `_journal.json` **at the moment of merge**. Do NOT hard-code renumbering now.

**For the person doing the merge**:
1. After the first branch merges, read `packages/db/drizzle/meta/_journal.json` to find the next available `idx`.
2. Rename the second branch's migration files to start at `idx + 1`.
3. Update all migration imports and references in that branch's code.
4. Re-run `bun run -F @deep-wiki/db test schema` to verify the new numbering works against the merged-first state.

**This conflict is the single thing most likely to break a merge.** The person performing the merge will not have this conversation in front of them; include this section prominently in release notes or the merge commit message.

---

## Implementation Details

### Architecture Decisions

- **Hexagonal split**: `packages/core` is framework-free and owns domain entities (provider identity, capability registry, ports). Vercel AI SDK adapters live in `apps/api`, replicating the Phase 1 pattern for `MailSender` and `BlobStore`.
- **Envelope encryption over KMS**: Default adapter reads operator-supplied master key from environment (self-hosting compatible). KMS is optional second adapter, never assumed. Each credential stores wrapping key id for future rotation without re-entry.
- **Provider registry is checked-in**: Capability data is static, versioned, and tested. Runtime discovery is deliberately rejected (an unknown model is refused, not optimistically called).
- **Independent chat/embedding settings**: Hard requirement per SPECS §14. Choosing a chat model never constrains the embedding model.

### Database Migrations

Five ordered migrations in `packages/db/drizzle/migrations/`:
- **0008**: Workspace AI settings table + envelope cipher + key provider setup
- **0009**: Usage ledger + plan quota column
- **0010**: Structured-output observations tracking
- **0011**: Embedding index generations + chunks table (pinned to one generation per workspace/model pair)
- **0012**: Reindex and rekey audit tables

All migrations auto-provisioned in test suite; real Postgres instance provided by `packages/db/testing/provision.ts`.

### Core Modules

| Module | Purpose | Status |
|---|---|---|
| `packages/core/src/ai/ids.ts` | Provider + model identity, parse/validate | ✅ Delivered |
| `packages/core/src/ai/registry.ts` | Frozen capability registry with provenance | ✅ Delivered |
| `packages/core/src/ai/degrade.ts` | Structured-output degradation ladder | ✅ Delivered |
| `packages/core/src/ai/pricing.ts` | Token cost model | ✅ Delivered |
| `packages/core/src/ai/budget.ts` | Reserve/settle/void/expire state machine | ✅ Delivered |
| `packages/core/src/ai/prefix.ts` | Stable-prefix deterministic serialization | ✅ Delivered |
| `packages/core/src/ai/ports.ts` | ChatModel, EmbeddingModel, Cipher, KeyProvider, Ledger ports | ✅ Delivered |

### Adapter Implementations

| Adapter | File | Status |
|---|---|---|
| Envelope Cipher (AAD-bound) | `apps/api/src/adapters/ai/cipher/` | ✅ Delivered |
| Key Provider (env-based) | `apps/api/src/adapters/ai/key-provider/` | ✅ Delivered |
| Vercel AI (Anthropic native) | `apps/api/src/adapters/ai/providers/anthropic.ts` | ✅ Delivered |
| Vercel AI (OpenAI native) | `apps/api/src/adapters/ai/providers/openai.ts` | ✅ Delivered |
| Vercel AI (Google Gemini native) | `apps/api/src/adapters/ai/providers/gemini.ts` | ✅ Delivered |
| Vercel AI (DeepSeek, OpenRouter OpenAI-compat) | `apps/api/src/adapters/ai/providers/openai-compat.ts` | ✅ Delivered |
| Vercel AI (Local embedding fallback) | `apps/api/src/adapters/ai/providers/local-embedding.ts` | ✅ Delivered |

### CLI Commands Added

- `ai:probe` — opt-in embedding capability probe (requires real API keys); reports `unknown | supported | unsupported` per provider
- `ai:reindex` — tracked resumable reindexing job triggered by admin; creates index generation and queues chunk re-embedding
- `ai:rekey [--compromised <key-id>]` — rotate envelope master key or re-wrap specific key's credentials

---

## Task Completion Summary

| Phase | Goal | Tasks | Status |
|---|---|---|---|
| 0 | Sequencing gate + migration numbering | 2 | ✅ Complete |
| 1 | Core purity: type-only import scan | 2 | ✅ Complete |
| 2 | Provider identity, capability registry, degradation | 8 | ✅ Complete |
| 3 | Cost model + budget state machine | 6 | ✅ Complete |
| 4 | Stable prompt prefix + goldens | 4 | ✅ Complete |
| 5 | Ports (chat, embedding, cipher, key-provider, ledger) | 1 | ✅ Complete |
| 6 | Key-provider env schema + startup validation | 1 | ✅ Complete |
| 7 | Cipher + key-provider adapters | 1 | ✅ Complete |
| 8 | Settings + credentials schema | 1 | ✅ Complete |
| 9 | Denylist, SDK boundary, decryption boundary | 1 | ✅ Complete |
| 10 | Credential save route with probe | 1 | ✅ Complete |
| 11 | Usage ledger + plan quota | 1 | ✅ Complete |
| 12 | AI gateway | 1 | ✅ Complete |
| 13 | Vercel AI adapters (5 providers) | 1 | ✅ Complete |
| 14 | Structured-output degradation + observations | 1 | ✅ Complete |
| 15 | Embedding index generations + chunks | 1 | ✅ Complete |
| 16 | Reindex as tracked job | 1 | ✅ Complete |
| 17 | Key rotation + boot-time keyring check | 1 | ✅ Complete |
| 18 | Blocking verification (embedding probe, local-model gap) | 1 | ✅ Complete |
| 19 | Docs sync (findings, runbook, revocation rule) | 1 | ✅ Complete |
| Remediation | Embedding-index-integrity dimension scenarios | 2 | ✅ Complete |

**Total: 102/102 tasks checked as complete (100 planned + 2 remediation)**

---

## Traceability

**Proposal observation ID** (if persisted in Engram): Check `sdd/ai-provider-foundation/proposal`
**Spec observation ID** (if persisted in Engram): Check `sdd/ai-provider-foundation/spec`
**Design observation ID** (if persisted in Engram): Check `sdd/ai-provider-foundation/design`
**Tasks observation ID** (if persisted in Engram): Check `sdd/ai-provider-foundation/tasks`
**Verify Report observation ID** (if persisted in Engram): Check `sdd/ai-provider-foundation/verify-report`

**Archive location**: `openspec/changes/archive/2026-09-06-ai-provider-foundation/`
**Baseline specs updated**: 7 (6 new, 1 modified)

---

## Sign-Off

**Archived by**: SDD Archive Executor (sdd-archive phase)
**Date**: 2026-09-06
**Change Status**: CLOSED — Ready for project owner to merge locally and tag milestones

The SDD cycle for AI Provider Foundation is complete. All phases (propose → spec → design → tasks → apply → verify → archive) have closed successfully. The change is stable, verified, and ready for integration into `main`.
