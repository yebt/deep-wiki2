/**
 * Embedding-model registration guard (embedding-configuration spec —
 * "Embedding Dimension Fixed at 1536"; "Local Fallback Constrained, Not
 * Invented"). `EMBEDDING_DIMENSION` is the schema's fixed vector width
 * (`chunks.embedding vector(1536)`, `0011_embedding_indexes_and_chunks.sql`):
 * only a candidate that can emit exactly this many dimensions — natively
 * or through a provider-supported reduction parameter — may register.
 *
 * `resolveLocalFallback` deliberately ships no model: bge-m3 and e5-large
 * both emit 1024 dimensions, and no identified local model meets 1536
 * (design.md — Open Questions). Reporting `{ available: false }` here is
 * the honest seam; inventing a placeholder model would be the failure
 * this function exists to prevent.
 */
import { err, ok, type Result } from '../result';
import type { ModelRef } from './ids';

export const EMBEDDING_DIMENSION = 1536;

export interface EmbeddingModelCandidate {
  readonly ref: ModelRef;
  /** Mirrors `ModelCapabilities.embeddings` (`registry.ts`) without requiring a registry entry to exist yet. */
  readonly embeddings: false | { readonly dimensions: readonly number[] };
}

export type EmbeddingRegistrationRefusalReason = 'no-embeddings-support' | 'unsupported-dimension';

export interface EmbeddingRegistrationRefusal {
  readonly reason: EmbeddingRegistrationRefusalReason;
  readonly ref: ModelRef;
}

export interface RegisteredEmbeddingModel {
  readonly ref: ModelRef;
  readonly dimensions: typeof EMBEDDING_DIMENSION;
}

export function registerEmbeddingModel(candidate: EmbeddingModelCandidate): Result<RegisteredEmbeddingModel, EmbeddingRegistrationRefusal> {
  if (candidate.embeddings === false) {
    return err({ reason: 'no-embeddings-support', ref: candidate.ref });
  }

  if (!candidate.embeddings.dimensions.includes(EMBEDDING_DIMENSION)) {
    return err({ reason: 'unsupported-dimension', ref: candidate.ref });
  }

  return ok({ ref: candidate.ref, dimensions: EMBEDDING_DIMENSION });
}

export type LocalFallbackResult =
  | { readonly available: true; readonly model: RegisteredEmbeddingModel }
  | { readonly available: false };

/**
 * Always `{ available: false }` today (open item, not solved here). The
 * seam exists so a future identified local model is additive — wiring it
 * in is a one-function change, never a silent substitution of an
 * incompatible model in the meantime.
 */
export function resolveLocalFallback(): LocalFallbackResult {
  return { available: false };
}
