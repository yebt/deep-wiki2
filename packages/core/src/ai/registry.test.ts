import { describe, expect, test } from 'bun:test';
import { capabilitiesOf, MODEL_REGISTRY } from './registry';
import type { ModelRef } from './ids';

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
