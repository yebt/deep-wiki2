import { describe, expect, test } from 'bun:test';
import { Secret } from '@deep-wiki/core';
import generateFixture from './__fixtures__/openrouter-generate.json';
import error401Fixture from './__fixtures__/openrouter-error-401.json';
import error429Fixture from './__fixtures__/openrouter-error-429.json';
import upstream429Fixture from './__fixtures__/openrouter-error-429-upstream.json';
import nemoGenerate from './__fixtures__/openrouter-mistral-nemo-generate.json';
import nemoError401 from './__fixtures__/openrouter-mistral-nemo-error-401.json';
import llama8bGenerate from './__fixtures__/openrouter-llama-3.1-8b-generate.json';
import llama8bError401 from './__fixtures__/openrouter-llama-3.1-8b-error-401.json';
import qwen30bGenerate from './__fixtures__/openrouter-qwen3-30b-a3b-generate.json';
import qwen30bError401 from './__fixtures__/openrouter-qwen3-30b-a3b-error-401.json';
import { OpenRouterChatModel } from './openrouter';
import { jsonFetch } from './test-support';

function baseRequest(slug = 'meta-llama/llama-3.1-70b-instruct') {
  return {
    model: { provider: 'openrouter' as const, slug },
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

/**
 * The cheap routes (docs/TODO.md Finding 2026-09-17 — "Cheap models
 * first"). Unlike the synthetic fixtures above, these were recorded from
 * real calls on 2026-09-17 with the key redacted (the scrubber in
 * `fixtures.test.ts` holds that line): `-generate` is "Say hello in five
 * words or fewer", `-error-401` is the same call with an invalid key.
 * A 429 cannot be provoked on a paid route on demand, so the one real
 * capture — an upstream rate limit on a free route, `user_id` redacted —
 * stands in for all three: the mapping is by HTTP status, never by model.
 */
interface CheapRoute {
  readonly slug: string;
  readonly generate: typeof nemoGenerate;
  readonly error401: typeof nemoError401;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

const CHEAP_ROUTES: CheapRoute[] = [
  { slug: 'mistralai/mistral-nemo', generate: nemoGenerate, error401: nemoError401, inputTokens: 24, outputTokens: 3 },
  { slug: 'meta-llama/llama-3.1-8b-instruct', generate: llama8bGenerate, error401: llama8bError401, inputTokens: 37, outputTokens: 7 },
  { slug: 'qwen/qwen3-30b-a3b-instruct-2507', generate: qwen30bGenerate, error401: qwen30bError401, inputTokens: 34, outputTokens: 7 },
];

describe.each(CHEAP_ROUTES)('OpenRouterChatModel.generate against recorded $slug responses', ({ slug, generate, error401, inputTokens, outputTokens }) => {
  test('the recorded generation names the route it was recorded from', () => {
    expect(generate.model).toBe(slug);
  });

  test('a recorded response is parsed into a ChatResult with the usage OpenRouter reported', async () => {
    const model = new OpenRouterChatModel(jsonFetch(200, generate));

    const result = await model.generate(baseRequest(slug), new Secret('sk-fake'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe(generate.choices[0]!.message.content);
      expect(result.value.usage.inputTokens).toBe(inputTokens);
      expect(result.value.usage.outputTokens).toBe(outputTokens);
      expect(result.value.usage.cachedInputTokens).toBe(0);
      expect(result.value.finishReason).toBe('stop');
    }
  });

  test('the recorded 401 maps to a normalized auth error carrying neither the key nor the payload', async () => {
    const model = new OpenRouterChatModel(jsonFetch(401, error401));

    const result = await model.generate(baseRequest(slug), new Secret('sk-fake'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth');
      expect(result.error.message).not.toContain('sk-fake');
      expect(result.error.message).not.toContain(error401.error.message);
    }
  });

  test('the recorded upstream 429 maps to a rate-limit error that never echoes the provider\'s raw text', async () => {
    const model = new OpenRouterChatModel(jsonFetch(429, upstream429Fixture));

    const result = await model.generate(baseRequest(slug), new Secret('sk-fake'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('rate-limit');
      expect(result.error.message).not.toContain('rate-limited upstream');
      expect(result.error.message).not.toContain('user_');
    }
  });
});
