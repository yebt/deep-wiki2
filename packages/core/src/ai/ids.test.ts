import { describe, expect, test } from 'bun:test';
import { parseModelId } from './ids';

describe('parseModelId', () => {
  test('accepts <providerId>:<slug> for a provider in the closed union', () => {
    const result = parseModelId('anthropic:claude-3-5-sonnet-20241022');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provider).toBe('anthropic');
      expect(result.value.slug).toBe('claude-3-5-sonnet-20241022');
    }
  });

  test('accepts a slug with path-like segments (openrouter catch-all shape)', () => {
    const result = parseModelId('openrouter:meta-llama/llama-3.1-70b-instruct');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slug).toBe('meta-llama/llama-3.1-70b-instruct');
    }
  });

  test('refuses a slug embedding a URL scheme', () => {
    const result = parseModelId('openrouter:https://evil.example/model');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('invalid-slug');
    }
  });

  test('refuses a slug containing a parent-directory traversal segment', () => {
    const result = parseModelId('openai:../../etc/passwd');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('invalid-slug');
    }
  });

  test('refuses a slug containing whitespace', () => {
    const result = parseModelId('openai:gpt 4o');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('invalid-slug');
    }
  });

  test('refuses an unknown providerId', () => {
    const result = parseModelId('evilcorp:some-model');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('unknown-provider');
    }
  });

  test('refuses a raw string with no colon separator', () => {
    const result = parseModelId('anthropic-claude-3');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('malformed');
    }
  });
});
