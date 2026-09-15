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

  test('an unregistered model is reported as a mismatch rather than throwing', async () => {
    const chatModel = new ScriptedChatModel(['{"answer":"ok"}']);

    const result = await runConformanceCase(chatModel, new Secret('sk-fake'), 'anthropic:no-such-model');

    expect(result.matched).toBe(false);
  });
});
