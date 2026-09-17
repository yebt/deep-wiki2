/**
 * Blocking verification: per-provider embeddings support (proposal —
 * "Escalated Open Question — the embedding default"; design.md — "Drift
 * detection" — "Live conformance"). Anthropic and DeepSeek are already
 * excluded from `embedding_provider` selection (Phase 15.10) — both
 * vendors' own documentation confirms neither exposes a first-party
 * embeddings endpoint. This module **verifies**, never asserts, the
 * three that remain unconfirmed: OpenAI, Google Gemini, OpenRouter.
 *
 * OpenAI and Google already implement `EmbeddingModelPort`
 * (`./gateway/providers/{openai,google}.ts`) — this module reuses those
 * adapters rather than constructing a second client. OpenRouter has no
 * such adapter (design.md — "no embeddings" — the registry does not
 * offer it as an `embedding_provider` until a probe confirms one), so
 * it is probed directly against its documented REST endpoint with no
 * SDK involved.
 *
 * The detail string returned is always a normalized description, never
 * the raw provider payload — a 4xx body routinely echoes request
 * content or carries diagnostic text that must not be repeated verbatim
 * into a Finding (workspace-ai-credentials spec — "Validation failure
 * does not leak the key" applies here by the same logic).
 */
import type { Secret } from '@deep-wiki/core';
import { GoogleChatModel } from './gateway/providers/google';
import { OpenAiChatModel } from './gateway/providers/openai';

export interface EmbeddingProbeOutcome {
  readonly provider: 'openai' | 'google' | 'openrouter';
  readonly supported: boolean;
  readonly detail: string;
}

const PROBE_INPUT = ['ai-provider-foundation probe'];

export async function probeOpenAiEmbeddings(apiKey: Secret<string>, fetchImpl?: typeof fetch): Promise<EmbeddingProbeOutcome> {
  const model = new OpenAiChatModel(fetchImpl);
  const result = await model.embed({ model: { provider: 'openai', slug: 'text-embedding-3-small' }, input: PROBE_INPUT }, apiKey);

  if (!result.ok) {
    return { provider: 'openai', supported: false, detail: `probe call failed: ${result.error.code}` };
  }
  return { provider: 'openai', supported: true, detail: `embedding dimensions observed: ${result.value.embeddings[0]?.length ?? 'unknown'}` };
}

export async function probeGoogleEmbeddings(apiKey: Secret<string>, fetchImpl?: typeof fetch): Promise<EmbeddingProbeOutcome> {
  const model = new GoogleChatModel(fetchImpl);
  const result = await model.embed({ model: { provider: 'google', slug: 'text-embedding-004' }, input: PROBE_INPUT }, apiKey);

  if (!result.ok) {
    return { provider: 'google', supported: false, detail: `probe call failed: ${result.error.code}` };
  }
  return { provider: 'google', supported: true, detail: `embedding dimensions observed: ${result.value.embeddings[0]?.length ?? 'unknown'}` };
}

/** The OpenAI-compatible shape: `data[0].embedding` is the vector. Anything else reads as `unknown`, never as a claim. */
async function observedDimensions(response: Response): Promise<number | 'unknown'> {
  try {
    const body = (await response.json()) as { data?: { embedding?: unknown }[] };
    const embedding = body.data?.[0]?.embedding;
    return Array.isArray(embedding) ? embedding.length : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** No `EmbeddingModelPort` adapter exists for OpenRouter — probed directly against its documented REST endpoint (OpenAI-compatible shape). */
export async function probeOpenRouterEmbeddings(apiKey: Secret<string>, fetchImpl: typeof fetch = fetch): Promise<EmbeddingProbeOutcome> {
  try {
    const response = await fetchImpl('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey.reveal()}` },
      body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: PROBE_INPUT[0] }),
    });

    if (response.status === 404) {
      return { provider: 'openrouter', supported: false, detail: 'HTTP 404 — no embeddings endpoint' };
    }
    if (!response.ok) {
      return { provider: 'openrouter', supported: false, detail: `HTTP ${response.status}` };
    }
    return { provider: 'openrouter', supported: true, detail: `HTTP ${response.status} — embedding dimensions observed: ${await observedDimensions(response)}` };
  } catch {
    return { provider: 'openrouter', supported: false, detail: 'network error' };
  }
}
