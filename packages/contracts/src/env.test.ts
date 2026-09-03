import { describe, expect, test } from 'bun:test';
import { parseEnv } from './env';

describe('parseEnv', () => {
  test('parses a valid environment into a typed object', () => {
    const result = parseEnv({
      NODE_ENV: 'development',
      PORT: '4000',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/deep_wiki',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.NODE_ENV).toBe('development');
      expect(result.value.PORT).toBe(4000);
      expect(result.value.DATABASE_URL).toBe('postgres://user:pass@localhost:5432/deep_wiki');
    }
  });

  test('rejects and names a missing required variable', () => {
    const result = parseEnv({
      NODE_ENV: 'development',
      PORT: '4000',
      // DATABASE_URL intentionally missing
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.variable === 'DATABASE_URL')).toBe(true);
    }
  });

  test('rejects and names a malformed variable (non-numeric port)', () => {
    const result = parseEnv({
      NODE_ENV: 'development',
      PORT: 'not-a-number',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/deep_wiki',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.variable === 'PORT')).toBe(true);
    }
  });

  test('defaults NODE_ENV to development when omitted', () => {
    const result = parseEnv({
      PORT: '4000',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/deep_wiki',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.NODE_ENV).toBe('development');
    }
  });
});
