/**
 * The cheapest listing/echo call per provider, run on save (design.md —
 * "Credentials: envelope encryption a self-hoster can operate" —
 * "Validation probe"; workspace-ai-credentials spec — "Validation Probe
 * on Save"). A real implementation lives with the Vercel AI SDK adapters
 * (Phase 13) and constructs its provider client only inside
 * `apps/api/src/ai/gateway/` (rule 6) — this interface is what lets the
 * credential route depend on "some cheap probe" without importing an SDK
 * itself, exactly as `ChatModelPort` decouples the gateway from a route.
 *
 * The error code set is closed and carries no raw provider payload — a
 * provider SDK error object routinely carries the request headers, which
 * must never reach a logger (workspace-ai-credentials spec — "Validation
 * failure does not leak the key").
 */
import type { ProviderId, Secret } from '@deep-wiki/core';

export type ProbeErrorCode = 'invalid_key' | 'insufficient_quota' | 'network' | 'unknown';

export type ProbeResult = { readonly ok: true } | { readonly ok: false; readonly errorCode: ProbeErrorCode };

export interface CredentialValidationProbe {
  probe(provider: ProviderId, apiKey: Secret<string>): Promise<ProbeResult>;
}
