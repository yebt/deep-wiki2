/**
 * `resolveChatModel` — the switch that turns a registered `ProviderId`
 * into the concrete `ChatModelPort` adapter from `./providers/`
 * (design.md's step 6, "resolveChatModel"). Exercised against every
 * fixture already recorded for the five adapters, so wiring this switch
 * incorrectly (e.g. Google resolving to the OpenAI adapter) fails loudly
 * against real recorded wire shapes rather than a hand-rolled fake.
 */
import { describe, expect, test } from 'bun:test';
import { Secret } from '@deep-wiki/core';
import anthropicFixture from './providers/__fixtures__/anthropic-generate.json';
import openaiFixture from './providers/__fixtures__/openai-generate.json';
import googleFixture from './providers/__fixtures__/google-generate.json';
import deepseekFixture from './providers/__fixtures__/deepseek-generate.json';
import openrouterFixture from './providers/__fixtures__/openrouter-generate.json';
import { jsonFetch } from './providers/test-support';
import { resolveChatModel } from './resolve-chat-model';

function baseRequest(provider: 'anthropic' | 'openai' | 'google' | 'deepseek' | 'openrouter', slug: string) {
  return {
    model: { provider, slug },
    prefix: { text: 'be terse', hash: 'h', cacheBoundary: 8 },
    volatile: [],
    maxOutputTokens: 16,
  };
}

describe('resolveChatModel', () => {
  test('anthropic resolves to a model that speaks the Anthropic wire shape', async () => {
    const model = resolveChatModel('anthropic', jsonFetch(200, anthropicFixture));
    const result = await model.generate(baseRequest('anthropic', 'claude-3-5-sonnet-20241022'), new Secret('sk-fake'));
    expect(result.ok).toBe(true);
  });

  test('openai resolves to a model that speaks the OpenAI wire shape', async () => {
    const model = resolveChatModel('openai', jsonFetch(200, openaiFixture));
    const result = await model.generate(baseRequest('openai', 'gpt-4o'), new Secret('sk-fake'));
    expect(result.ok).toBe(true);
  });

  test('google resolves to a model that speaks the Google wire shape', async () => {
    const model = resolveChatModel('google', jsonFetch(200, googleFixture));
    const result = await model.generate(baseRequest('google', 'gemini-1.5-pro'), new Secret('sk-fake'));
    expect(result.ok).toBe(true);
  });

  test('deepseek resolves to a model that speaks the DeepSeek wire shape', async () => {
    const model = resolveChatModel('deepseek', jsonFetch(200, deepseekFixture));
    const result = await model.generate(baseRequest('deepseek', 'deepseek-chat'), new Secret('sk-fake'));
    expect(result.ok).toBe(true);
  });

  test('openrouter resolves to a model that speaks the OpenRouter wire shape', async () => {
    const model = resolveChatModel('openrouter', jsonFetch(200, openrouterFixture));
    const result = await model.generate(baseRequest('openrouter', 'meta-llama/llama-3.1-70b-instruct'), new Secret('sk-fake'));
    expect(result.ok).toBe(true);
  });

  test('the local provider has no SDK adapter and throws rather than silently returning a wrong client', () => {
    expect(() => resolveChatModel('local')).toThrow(/local/);
  });
});
