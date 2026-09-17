import { describe, expect, test } from 'bun:test';
import { capabilitiesOf, DEFAULT_MODEL_BY_PROVIDER, defaultModelFor, MODEL_REGISTRY } from './registry';
import { computeCostMicroUsd } from './pricing';
import type { ModelRef, ProviderId } from './ids';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

describe('capabilitiesOf', () => {
  test('returns capabilities for a registered <provider>:<model>', () => {
    const ref: ModelRef = { provider: 'anthropic', slug: 'claude-3-5-sonnet-20241022' };

    const result = capabilitiesOf(ref);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.value.structuredOutput).toBe('string');
      expect(typeof result.value.contextWindow).toBe('number');
      expect(typeof result.value.tools).toBe('boolean');
    }
  });

  test('returns a typed refusal for an unregistered model, with no default branch', () => {
    const ref: ModelRef = { provider: 'anthropic', slug: 'model-nobody-registered' };

    const result = capabilitiesOf(ref);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('unknown-model');
      expect(result.error.ref).toEqual(ref);
    }
  });

  test('an OpenRouter entry declares the proxied model and does not inherit native caching', () => {
    const ref: ModelRef = { provider: 'openrouter', slug: 'meta-llama/llama-3.1-70b-instruct' };

    const result = capabilitiesOf(ref);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.proxiedModel).toBe('meta-llama/llama-3.1-70b-instruct');
      expect(result.value.promptCaching).toBe(false);
    }
  });

  test('Anthropic and DeepSeek entries declare no embeddings support (verified against vendor docs)', () => {
    const anthropic = capabilitiesOf({ provider: 'anthropic', slug: 'claude-3-5-sonnet-20241022' });
    const deepseek = capabilitiesOf({ provider: 'deepseek', slug: 'deepseek-chat' });

    expect(anthropic.ok && anthropic.value.embeddings).toBe(false);
    expect(deepseek.ok && deepseek.value.embeddings).toBe(false);
  });
});

// design.md — "Drift detection": every registry entry must carry
// `verifiedAt` and `source` so a stale claim is attributable, not silent.
// This is a runtime assertion, not only a compile-time requirement, so a
// future entry built by spreading/casting cannot silently drop them.
describe('registry provenance assertion', () => {
  test('every entry carries a verifiedAt date and a source', () => {
    for (const [key, capabilities] of Object.entries(MODEL_REGISTRY)) {
      expect(ISO_DATE_PATTERN.test(capabilities.verifiedAt)).toBe(true);
      expect(['probe', 'vendor-docs']).toContain(capabilities.source);
      void key;
    }
  });

  test('the registry is non-empty (a provenance check over nothing proves nothing)', () => {
    expect(Object.keys(MODEL_REGISTRY).length).toBeGreaterThan(0);
  });
});

// docs/TODO.md Finding 2026-09-17 — "Cheap models first". The owner's rule
// is that every AI feature defaults to the cheapest model that passes
// conformance. A rule needs a mechanism: the default is a registry entry,
// and this suite holds it to the rule.
describe('defaultModelFor', () => {
  test('OpenRouter has a default, and it is a registered entry', () => {
    const result = defaultModelFor('openrouter');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provider).toBe('openrouter');
      expect(capabilitiesOf(result.value).ok).toBe(true);
    }
  });

  test('a provider with no declared default is a typed refusal, never a guess', () => {
    const result = defaultModelFor('local');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('no-default-model');
      expect(result.error.provider).toBe('local');
    }
  });

  test('every declared default is probe-verified and the cheapest probe-verified entry for its provider', () => {
    // A representative call: one thousand tokens in, one thousand out, nothing cached.
    const usage = { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 1_000 };

    for (const [provider, slug] of Object.entries(DEFAULT_MODEL_BY_PROVIDER) as [ProviderId, string][]) {
      const chosen = capabilitiesOf({ provider, slug });
      expect(chosen.ok).toBe(true);
      if (!chosen.ok) continue;
      // Only a measured entry may be a default — vendor documentation is a claim, a probe is evidence.
      expect(chosen.value.source).toBe('probe');

      const chosenCost = computeCostMicroUsd(usage, chosen.value.pricing);
      for (const [key, capabilities] of Object.entries(MODEL_REGISTRY)) {
        if (!key.startsWith(`${provider}:`) || capabilities.source !== 'probe') continue;
        expect(computeCostMicroUsd(usage, capabilities.pricing)).toBeGreaterThanOrEqual(chosenCost);
      }
    }
  });

  test('the three cheap OpenRouter routes are registered at the level the ladder measured, and the 70b entry remains as the upgrade', () => {
    for (const slug of ['mistralai/mistral-nemo', 'meta-llama/llama-3.1-8b-instruct', 'qwen/qwen3-30b-a3b-instruct-2507']) {
      const result = capabilitiesOf({ provider: 'openrouter', slug });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.structuredOutput).toBe('prompted');
        expect(result.value.source).toBe('probe');
        expect(result.value.promptCaching).toBe(false);
        expect(result.value.proxiedModel).toBe(slug);
      }
    }
    expect(capabilitiesOf({ provider: 'openrouter', slug: 'meta-llama/llama-3.1-70b-instruct' }).ok).toBe(true);
  });
});
