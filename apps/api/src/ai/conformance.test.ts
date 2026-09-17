/**
 * `runConformanceCase` — the policy `ai:conformance` runs against a live
 * provider (design.md — "Drift detection" — "Live conformance";
 * proposal — "The structured-output conformance suite passes at each
 * model's declared degradation level"). Exercised here against a
 * scripted `ChatModelPort`, never a network call — `ai:conformance`
 * itself is opt-in, spends money, and stays out of `bun run test`
 * exactly like `ai:probe`; what belongs in this suite is the pure
 * "declared vs. achieved" comparison this module makes.
 */
import { describe, expect, test } from 'bun:test';
import { ok, Secret, type ChatModelPort, type ChatResult, type ProviderError, type Result } from '@deep-wiki/core';
import { runConformanceCase } from './conformance';
import { OpenRouterChatModel } from './gateway/providers/openrouter';
import { jsonFetch } from './gateway/providers/test-support';
import nemoStructured from './gateway/providers/__fixtures__/openrouter-mistral-nemo-structured.json';
import llama8bStructured from './gateway/providers/__fixtures__/openrouter-llama-3.1-8b-structured.json';
import qwen30bStructured from './gateway/providers/__fixtures__/openrouter-qwen3-30b-a3b-structured.json';

class ScriptedChatModel implements ChatModelPort {
  constructor(private readonly responses: readonly string[]) {}
  private calls = 0;

  async generate(): Promise<Result<ChatResult, ProviderError>> {
    const text = this.responses[this.calls] ?? this.responses[this.responses.length - 1]!;
    this.calls += 1;
    return ok({ text, usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 }, finishReason: 'stop' });
  }

  async stream(): Promise<Result<never, ProviderError>> {
    throw new Error('not used in this suite');
  }
}

describe('runConformanceCase', () => {
  test('a model that honors its declared "tool-call" level matches', async () => {
    const chatModel = new ScriptedChatModel(['{"answer":"ok"}']);

    const result = await runConformanceCase(chatModel, new Secret('sk-fake'), 'anthropic:claude-3-5-sonnet-20241022');

    expect(result.matched).toBe(true);
    expect(result.declaredLevel).toBe('tool-call');
  });

  test('a model that never validates at its declared level, and degrades all the way down, is reported as a mismatch', async () => {
    // Anthropic declares "tool-call" (no rung below it but "prompted"→"none");
    // an always-invalid response degrades to "prompted", then fails its one
    // repair pass too — the declared level was never honored.
    const chatModel = new ScriptedChatModel(['not json', 'still not json']);

    const result = await runConformanceCase(chatModel, new Secret('sk-fake'), 'anthropic:claude-3-5-sonnet-20241022');

    expect(result.matched).toBe(false);
    expect(result.detail.includes('sk-fake')).toBe(false);
  });

  test('reports the tokens every rung spent, their cost at the registry price, the rung count and the elapsed time', async () => {
    // Fails at "tool-call", validates at "prompted": two rungs, each 10 in / 5 out
    // at claude-3-5-sonnet's 3_000_000 / 15_000_000 µ$ per MTok = 105 µ$ a rung.
    const chatModel = new ScriptedChatModel(['not json', '{"answer":"ok"}']);

    const result = await runConformanceCase(chatModel, new Secret('sk-fake'), 'anthropic:claude-3-5-sonnet-20241022');

    expect(result.matched).toBe(false);
    expect(result.rungs).toBe(2);
    expect(result.usage).toEqual({ inputTokens: 20, cachedInputTokens: 0, outputTokens: 10 });
    expect(result.costMicroUsd).toBe(210);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test('a case that never reached the provider reports zero rungs and zero cost', async () => {
    const chatModel = new ScriptedChatModel(['{"answer":"ok"}']);

    const result = await runConformanceCase(chatModel, new Secret('sk-fake'), 'anthropic:no-such-model');

    expect(result.rungs).toBe(0);
    expect(result.costMicroUsd).toBe(0);
  });

  test('an unregistered model is reported as a mismatch rather than throwing', async () => {
    const chatModel = new ScriptedChatModel(['{"answer":"ok"}']);

    const result = await runConformanceCase(chatModel, new Secret('sk-fake'), 'anthropic:no-such-model');

    expect(result.matched).toBe(false);
  });
});

/**
 * The structured-output samples recorded from the real routes on
 * 2026-09-17 (docs/TODO.md Finding — "Cheap models first"), replayed
 * through the real adapter and the real ladder at the level the registry
 * declares. This is the offline half of `ai:conformance`: a registry entry
 * that claims `prompted` is backed by a recorded response that validates
 * at `prompted`, and a future edit to either side fails here first.
 */
const RECORDED_SAMPLES: { readonly modelId: string; readonly fixture: typeof nemoStructured }[] = [
  { modelId: 'openrouter:mistralai/mistral-nemo', fixture: nemoStructured },
  { modelId: 'openrouter:meta-llama/llama-3.1-8b-instruct', fixture: llama8bStructured },
  { modelId: 'openrouter:qwen/qwen3-30b-a3b-instruct-2507', fixture: qwen30bStructured },
];

describe.each(RECORDED_SAMPLES)('runConformanceCase over the recorded $modelId sample', ({ modelId, fixture }) => {
  test('the recorded sample honours the declared "prompted" level through the real adapter, offline', async () => {
    const chatModel = new OpenRouterChatModel(jsonFetch(200, fixture));

    const result = await runConformanceCase(chatModel, new Secret('sk-fake'), modelId);

    expect(result.declaredLevel).toBe('prompted');
    expect(result.matched).toBe(true);
  });
});
