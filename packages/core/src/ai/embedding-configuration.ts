/**
 * Effective `embedding_provider` resolution (embedding-configuration spec
 * — "Independent Chat and Embedding Providers"; "Chat-Only Workspace
 * Still Gets a Usable Embedding Path"; "No Embedding-Incapable Provider
 * Offered as Embedding Provider"). `chat_provider` never selects or
 * implies `embedding_provider` — a workspace with no separately
 * configured embedding credential falls back to the local path (or an
 * explicit "none available" result) rather than losing RAG capability
 * or erroring.
 */
import type { ProviderId } from './ids';
import { MODEL_REGISTRY } from './registry';
import { resolveLocalFallback, type RegisteredEmbeddingModel } from './embedding-registration';

export interface EmbeddingConfigurationInput {
  readonly chatProvider: ProviderId;
  /** `null` when the workspace has not separately configured an embedding provider. */
  readonly embeddingProvider: ProviderId | null;
  readonly hasEmbeddingCredential: boolean;
}

export type EffectiveEmbeddingProvider =
  | { readonly kind: 'configured'; readonly provider: ProviderId }
  | { readonly kind: 'local-fallback'; readonly model: RegisteredEmbeddingModel }
  | { readonly kind: 'none-available' };

/**
 * A workspace whose `chat_provider` cannot embed (or has not configured
 * a separate embedding credential) is offered the local fallback rather
 * than an error — `resolveLocalFallback()`'s explicit "none available"
 * result surfaces honestly when no local model has been identified,
 * rather than the caller inventing a substitute.
 */
export function resolveEffectiveEmbeddingProvider(input: EmbeddingConfigurationInput): EffectiveEmbeddingProvider {
  if (input.embeddingProvider !== null && input.hasEmbeddingCredential) {
    return { kind: 'configured', provider: input.embeddingProvider };
  }

  const fallback = resolveLocalFallback();
  if (fallback.available) {
    return { kind: 'local-fallback', model: fallback.model };
  }

  return { kind: 'none-available' };
}

/**
 * The set of providers with at least one registry entry that supports
 * embeddings — Anthropic and DeepSeek never appear here because every
 * one of their registry entries carries `embeddings: false` (vendor
 * documentation confirms neither offers a first-party embeddings
 * endpoint). OpenAI, Google and OpenRouter are excluded for the same
 * reason today, for a different one: their support is unverified until
 * Phase 18's `ai:probe` records a Finding — this function draws no
 * distinction between "confirmed absent" and "not yet confirmed
 * present", because the registry itself carries none.
 */
export function offeredEmbeddingProviderIds(): ReadonlySet<ProviderId> {
  const offered = new Set<ProviderId>();

  for (const [key, capabilities] of Object.entries(MODEL_REGISTRY)) {
    if (capabilities.embeddings === false) continue;
    const provider = key.split(':')[0] as ProviderId;
    offered.add(provider);
  }

  return offered;
}
