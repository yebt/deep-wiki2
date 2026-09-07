import { describe, expect, test } from 'bun:test';
import { offeredEmbeddingProviderIds, resolveEffectiveEmbeddingProvider } from './embedding-configuration';

describe('resolveEffectiveEmbeddingProvider', () => {
  test('independent selection: chat and embedding providers persist independently', () => {
    const result = resolveEffectiveEmbeddingProvider({
      chatProvider: 'anthropic',
      embeddingProvider: 'openai',
      hasEmbeddingCredential: true,
    });

    expect(result).toEqual({ kind: 'configured', provider: 'openai' });
  });

  test('a DeepSeek chat workspace with no embedding credential resolves to the local fallback path', () => {
    const result = resolveEffectiveEmbeddingProvider({
      chatProvider: 'deepseek',
      embeddingProvider: null,
      hasEmbeddingCredential: false,
    });

    // No local model has been identified yet (embedding-registration.ts),
    // so the honest resolution is "none available" rather than an error
    // and rather than a silently invented provider.
    expect(result).toEqual({ kind: 'none-available' });
  });

  test('a configured embedding provider with no saved credential still falls back rather than using an unusable provider', () => {
    const result = resolveEffectiveEmbeddingProvider({
      chatProvider: 'anthropic',
      embeddingProvider: 'openai',
      hasEmbeddingCredential: false,
    });

    expect(result).toEqual({ kind: 'none-available' });
  });
});

describe('offeredEmbeddingProviderIds', () => {
  test('Anthropic and DeepSeek are absent from the set of providers offered for embedding_provider selection', () => {
    const offered = offeredEmbeddingProviderIds();

    expect(offered.has('anthropic')).toBe(false);
    expect(offered.has('deepseek')).toBe(false);
  });
});
