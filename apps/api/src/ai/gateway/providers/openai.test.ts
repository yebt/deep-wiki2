import { describe, expect, test } from 'bun:test';
import { Secret } from '@deep-wiki/core';
import generateFixture from './__fixtures__/openai-generate.json';
import error401Fixture from './__fixtures__/openai-error-401.json';
import error429Fixture from './__fixtures__/openai-error-429.json';
import embedFixture from './__fixtures__/openai-embed.json';
import { OpenAiChatModel } from './openai';
import { jsonFetch } from './test-support';

function baseRequest() {
  return {
    model: { provider: 'openai' as const, slug: 'gpt-4o' },
    prefix: { text: 'be terse', hash: 'h', cacheBoundary: 8 },
    volatile: [],
    maxOutputTokens: 100,
  };
}

describe('OpenAiChatModel.generate', () => {
  test('a recorded response is parsed into a ChatResult', async () => {
    const model = new OpenAiChatModel(jsonFetch(200, generateFixture));

    const result = await model.generate(baseRequest(), new Secret('sk-fake'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe(generateFixture.choices[0]!.message.content);
      expect(result.value.usage.inputTokens).toBe(22);
      expect(result.value.usage.outputTokens).toBe(8);
      expect(result.value.finishReason).toBe('stop');
    }
  });

  test('an HTTP 429 fixture maps to a normalized rate-limit error', async () => {
    const model = new OpenAiChatModel(jsonFetch(429, error429Fixture));

    const result = await model.generate(baseRequest(), new Secret('sk-fake'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('rate-limit');
      expect(result.error.message).not.toContain('sk-fake');
    }
  });

  test('an invalid-credential fixture maps to a normalized auth error with no raw payload', async () => {
    const model = new OpenAiChatModel(jsonFetch(401, error401Fixture));

    const result = await model.generate(baseRequest(), new Secret('sk-fake'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth');
      expect(result.error.message).not.toContain('sk-fake');
    }
  });
});

describe('OpenAiChatModel.embed', () => {
  test('a recorded embeddings response is parsed into an EmbedResult', async () => {
    const model = new OpenAiChatModel(jsonFetch(200, embedFixture));

    const result = await model.embed({ model: { provider: 'openai', slug: 'text-embedding-3-small' }, input: ['hello'] }, new Secret('sk-fake'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.embeddings).toEqual([embedFixture.data[0]!.embedding]);
      expect(result.value.usage.inputTokens).toBe(4);
    }
  });
});
