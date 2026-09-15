import { describe, expect, test } from 'bun:test';
import { computeCostMicroUsd } from './pricing';
import type { ModelPricing } from './registry';

const PRICING: ModelPricing = {
  inputMicroUsdPerMTok: 1_000_000,
  outputMicroUsdPerMTok: 2_000_000,
  cachedInputMicroUsdPerMTok: 500_000,
};

describe('computeCostMicroUsd', () => {
  test('sums non-cached input, cached input, and output at their distinct rates', () => {
    const cost = computeCostMicroUsd(
      { inputTokens: 1_000, cachedInputTokens: 200, outputTokens: 500 },
      PRICING,
    );

    // (1000 - 200) non-cached @ 1_000_000/MTok = 800
    // 200 cached @ 500_000/MTok = 100
    // 500 output @ 2_000_000/MTok = 1000
    expect(cost).toBe(1_900);
  });

  test('zero usage costs nothing', () => {
    const cost = computeCostMicroUsd({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, PRICING);

    expect(cost).toBe(0);
  });

  test('a call with no cached tokens bills every input token at the full rate', () => {
    const cost = computeCostMicroUsd({ inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 0 }, PRICING);

    expect(cost).toBe(1_000);
  });
});
