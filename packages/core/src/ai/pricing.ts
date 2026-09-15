/**
 * Cost arithmetic from token counts and a model's price table
 * (design.md — "Cost enforcement, in the same path that builds the
 * call"). Pure: no I/O, no clock, no randomness. `cachedInputTokens` is
 * the portion of `inputTokens` that hit the provider's prompt cache and
 * bills at the cheaper rate; the remainder bills at the full input rate.
 */
import type { ModelPricing } from './registry';

export interface ChatUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
}

/** Micro-USD (1e-6 USD), matching `ai_usage_events`'s stored unit. */
export function computeCostMicroUsd(usage: ChatUsage, pricing: ModelPricing): number {
  const nonCachedInputTokens = usage.inputTokens - usage.cachedInputTokens;

  const nonCachedCost = (nonCachedInputTokens * pricing.inputMicroUsdPerMTok) / 1_000_000;
  const cachedCost = (usage.cachedInputTokens * pricing.cachedInputMicroUsdPerMTok) / 1_000_000;
  const outputCost = (usage.outputTokens * pricing.outputMicroUsdPerMTok) / 1_000_000;

  return Math.round(nonCachedCost + cachedCost + outputCost);
}
