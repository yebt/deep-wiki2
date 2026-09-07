/**
 * Anthropic adapter — replayed from a recorded fixture, no network
 * (design.md — "Testing strategy"). `readFileSync` reads the raw SSE
 * fixture as text; the JSON fixtures import directly (`resolveJsonModule`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { Secret } from '@deep-wiki/core';
import generateFixture from './__fixtures__/anthropic-generate.json';
import error401Fixture from './__fixtures__/anthropic-error-401.json';
import error429Fixture from './__fixtures__/anthropic-error-429.json';
import { AnthropicChatModel } from './anthropic';
import { jsonFetch, textEventStreamFetch } from './test-support';

const streamFixture = readFileSync(join(import.meta.dir, '__fixtures__', 'anthropic-stream.sse.txt'), 'utf8');

function baseRequest() {
  return {
    model: { provider: 'anthropic' as const, slug: 'claude-3-5-sonnet-20241022' },
    prefix: { text: 'be terse', hash: 'h', cacheBoundary: 8 },
    volatile: [],
    maxOutputTokens: 100,
  };
}

describe('AnthropicChatModel.generate', () => {
  test('a recorded response is parsed into a ChatResult', async () => {
    const model = new AnthropicChatModel(jsonFetch(200, generateFixture));

    const result = await model.generate(baseRequest(), new Secret('sk-fake'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe(generateFixture.content[0]!.text);
      expect(result.value.usage.inputTokens).toBe(24);
      expect(result.value.usage.outputTokens).toBe(9);
      expect(result.value.finishReason).toBe('stop');
    }
  });

  test('an HTTP 429 fixture maps to a normalized rate-limit error', async () => {
    const model = new AnthropicChatModel(jsonFetch(429, error429Fixture));

    const result = await model.generate(baseRequest(), new Secret('sk-fake'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('rate-limit');
      expect(result.error.message).not.toContain('sk-fake');
    }
  });

  test('an invalid-credential fixture maps to a normalized auth error with no raw payload', async () => {
    const model = new AnthropicChatModel(jsonFetch(401, error401Fixture));

    const result = await model.generate(baseRequest(), new Secret('sk-fake'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth');
      expect(result.error.message).not.toContain('x-api-key');
      expect(result.error.message).not.toContain('sk-fake');
    }
  });
});

describe('AnthropicChatModel.stream', () => {
  test('a recorded SSE fixture streams the assembled text and settles usage', async () => {
    const model = new AnthropicChatModel(textEventStreamFetch(200, streamFixture));

    const result = await model.stream(baseRequest(), new Secret('sk-fake'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    let text = '';
    for await (const chunk of result.value.chunks) {
      text += chunk;
    }
    expect(text).toBe('Hello fixture');
    const usage = await result.value.usage;
    expect(usage.inputTokens).toBe(18);
    expect(usage.outputTokens).toBe(6);
  });
});
