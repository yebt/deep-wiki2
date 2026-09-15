/**
 * The real `CredentialValidationProbe` (workspace-ai-credentials spec —
 * "Validation Probe on Save"). Deferred from Phase 10 to here on
 * purpose: this is the one place the interface's doc comment already
 * named — "a real implementation lives with the Vercel AI SDK adapters
 * (Phase 13) and constructs its provider client only inside
 * apps/api/src/ai/gateway/ (rule 6)".
 *
 * The probe is the cheapest call this module can make: a one-token
 * `generate()` against the registry's own default model for the
 * provider. A provider error is mapped through the shared
 * `mapProviderError` (`./providers/errors.ts`) and then narrowed to the
 * closed `ProbeErrorCode` set — the mapped message is discarded
 * entirely, never surfaced to the caller or a logger, because a provider
 * SDK error object routinely carries the request headers.
 */
import type { ProviderError, ProviderId, Secret } from '@deep-wiki/core';
import type { CredentialValidationProbe, ProbeErrorCode, ProbeResult } from '../../adapters/ai/credentials/validation-probe';
import { mapProviderError } from './providers/errors';
import { resolveChatModel } from './resolve-chat-model';

/** The same default model per provider the capability registry ships (`packages/core/src/ai/registry.ts`). */
const PROBE_MODEL: Readonly<Record<Exclude<ProviderId, 'local'>, string>> = {
  anthropic: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-4o',
  google: 'gemini-1.5-pro',
  deepseek: 'deepseek-chat',
  openrouter: 'meta-llama/llama-3.1-70b-instruct',
};

/** `chatModel.generate` already normalizes a thrown SDK error into `ProviderError` via `mapProviderError` — this only narrows that closed set further, onto the closed `ProbeErrorCode` set. */
function probeErrorCodeFrom(error: ProviderError): ProbeErrorCode {
  switch (error.code) {
    case 'auth':
      return 'invalid_key';
    case 'rate-limit':
      // A 429 does not distinguish "too many requests" from "quota
      // exhausted" at this layer; `insufficient_quota` is the closer of
      // the two closed codes and the one an operator should act on.
      return 'insufficient_quota';
    case 'network':
      return 'network';
    case 'unknown':
      return 'unknown';
  }
}

/** A raw thrown value that never reached `generate`'s own try/catch (e.g. a synchronous construction failure) — mapped through the same normalizer before narrowing. */
function probeErrorCodeFromThrown(caught: unknown): ProbeErrorCode {
  return probeErrorCodeFrom(mapProviderError(caught));
}

export function createVercelAiValidationProbe(fetchImpl?: typeof fetch): CredentialValidationProbe {
  return {
    async probe(provider: ProviderId, apiKey: Secret<string>): Promise<ProbeResult> {
      if (provider === 'local') {
        // No SDK-backed probe exists for a local model — refusing is the
        // honest answer, never an optimistic "ok" for a provider this
        // module cannot actually validate.
        return { ok: false, errorCode: 'unknown' };
      }

      const chatModel = resolveChatModel(provider, fetchImpl);
      const request = {
        model: { provider, slug: PROBE_MODEL[provider] },
        prefix: { text: 'ping', hash: 'probe', cacheBoundary: 0 },
        volatile: [],
        maxOutputTokens: 1,
      };

      try {
        const result = await chatModel.generate(request, apiKey);
        if (!result.ok) {
          return { ok: false, errorCode: probeErrorCodeFrom(result.error) };
        }
        return { ok: true };
      } catch (caught) {
        return { ok: false, errorCode: probeErrorCodeFromThrown(caught) };
      }
    },
  };
}
