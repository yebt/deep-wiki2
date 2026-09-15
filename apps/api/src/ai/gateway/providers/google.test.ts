import { describe, expect, test } from 'bun:test';
import { Secret } from '@deep-wiki/core';
import generateFixture from './__fixtures__/google-generate.json';
import error401Fixture from './__fixtures__/google-error-401.json';
import error429Fixture from './__fixtures__/google-error-429.json';
import embedFixture from './__fixtures__/google-embed.json';
import { GoogleChatModel } from './google';
import { jsonFetch } from './test-support';

function baseRequest() {
  return {
    model: { provider: 'google' as const, slug: 'gemini-1.5-pro' },
    prefix: { text: 'be terse', hash: 'h', cacheBoundary: 8 },
    volatile: [],
    maxOutputTokens: 100,
  };
}

describe('GoogleChatModel.generate', () => {
  test('a recorded response is parsed into a ChatResult', async () => {
    const model = new GoogleChatModel(jsonFetch(200, generateFixture));

    const result = await model.generate(baseRequest(), new Secret('sk-fake'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe(generateFixture.candidates[0]!.content.parts[0]!.text);
      expect(result.value.usage.inputTokens).toBe(16);
      expect(result.value.usage.outputTokens).toBe(7);
      expect(result.value.finishReason).toBe('stop');
    }
  });

  test('an HTTP 429 fixture maps to a normalized rate-limit error', async () => {
    const model = new GoogleChatModel(jsonFetch(429, error429Fixture));

    const result = await model.generate(baseRequest(), new Secret('sk-fake'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('rate-limit');
      expect(result.error.message).not.toContain('sk-fake');
    }
  });

  test('an invalid-credential fixture maps to a normalized auth error with no raw payload', async () => {
    const model = new GoogleChatModel(jsonFetch(401, error401Fixture));

    const result = await model.generate(baseRequest(), new Secret('sk-fake'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth');
      expect(result.error.message).not.toContain('sk-fake');
    }
  });
});

describe('GoogleChatModel.embed', () => {
  test('a recorded embeddings response is parsed into an EmbedResult', async () => {
    const model = new GoogleChatModel(jsonFetch(200, embedFixture));

    const result = await model.embed({ model: { provider: 'google', slug: 'text-embedding-004' }, input: ['hello'] }, new Secret('sk-fake'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.embeddings).toEqual([embedFixture.embedding.values]);
    }
  });
});
