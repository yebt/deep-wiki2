import { describe, expect, test } from 'bun:test';
import { Secret } from '@deep-wiki/core';
import generateFixture from './__fixtures__/openrouter-generate.json';
import error401Fixture from './__fixtures__/openrouter-error-401.json';
import error429Fixture from './__fixtures__/openrouter-error-429.json';
import { OpenRouterChatModel } from './openrouter';
import { jsonFetch } from './test-support';

function baseRequest() {
  return {
    model: { provider: 'openrouter' as const, slug: 'meta-llama/llama-3.1-70b-instruct' },
    prefix: { text: 'be terse', hash: 'h', cacheBoundary: 8 },
    volatile: [],
    maxOutputTokens: 100,
  };
}

describe('OpenRouterChatModel.generate', () => {
  test('a recorded response is parsed into a ChatResult', async () => {
    const model = new OpenRouterChatModel(jsonFetch(200, generateFixture));

    const result = await model.generate(baseRequest(), new Secret('sk-fake'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe(generateFixture.choices[0]!.message.content);
      expect(result.value.usage.inputTokens).toBe(11);
      expect(result.value.usage.outputTokens).toBe(5);
      expect(result.value.finishReason).toBe('stop');
    }
  });

  test('an HTTP 429 fixture maps to a normalized rate-limit error', async () => {
    const model = new OpenRouterChatModel(jsonFetch(429, error429Fixture));

    const result = await model.generate(baseRequest(), new Secret('sk-fake'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('rate-limit');
      expect(result.error.message).not.toContain('sk-fake');
    }
  });

  test('an invalid-credential fixture maps to a normalized auth error with no raw payload', async () => {
    const model = new OpenRouterChatModel(jsonFetch(401, error401Fixture));

    const result = await model.generate(baseRequest(), new Secret('sk-fake'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth');
      expect(result.error.message).not.toContain('sk-fake');
    }
  });
});
