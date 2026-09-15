import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSION, registerEmbeddingModel, resolveLocalFallback } from './embedding-registration';

const REF = { provider: 'openai' as const, slug: 'text-embedding-3-small' };

describe('registerEmbeddingModel', () => {
  test('a candidate emitting exactly 1536 dimensions natively registers', () => {
    const result = registerEmbeddingModel({ ref: REF, embeddings: { dimensions: [1536] } });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dimensions).toBe(EMBEDDING_DIMENSION);
    }
  });

  test('a candidate native at 3072 with a supported 1536 reduction registers at 1536', () => {
    const large = { provider: 'openai' as const, slug: 'text-embedding-3-large' };
    const result = registerEmbeddingModel({ ref: large, embeddings: { dimensions: [3072, 1536] } });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dimensions).toBe(1536);
    }
  });

  test('a candidate emitting 1024 dimensions with no supported reduction is rejected', () => {
    const local = { provider: 'local' as const, slug: 'bge-m3' };
    const result = registerEmbeddingModel({ ref: local, embeddings: { dimensions: [1024] } });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('unsupported-dimension');
    }
  });

  test('a candidate with no embeddings support at all is rejected', () => {
    const result = registerEmbeddingModel({ ref: REF, embeddings: false });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('no-embeddings-support');
    }
  });
});

describe('resolveLocalFallback — the local fallback gap, made explicit', () => {
  test('known 1024-dimension local models (bge-m3, e5-large) are rejected as the local fallback', () => {
    const bgeM3 = registerEmbeddingModel({ ref: { provider: 'local', slug: 'bge-m3' }, embeddings: { dimensions: [1024] } });
    const e5Large = registerEmbeddingModel({ ref: { provider: 'local', slug: 'e5-large' }, embeddings: { dimensions: [1024] } });

    expect(bgeM3.ok).toBe(false);
    expect(e5Large.ok).toBe(false);
  });

  test('querying the available local fallback reports none available, rather than silently substituting an incompatible model', () => {
    const result = resolveLocalFallback();

    expect(result.available).toBe(false);
  });
});
