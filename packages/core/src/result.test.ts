import { describe, expect, test } from 'bun:test';
import { err, ok } from './result';

describe('Result', () => {
  test('ok() produces a success result carrying its value', () => {
    const result = ok(42);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  test('err() produces a failure result carrying its error', () => {
    const result = err('boom');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('boom');
    }
  });

  test('ok and err are mutually exclusive discriminants', () => {
    const results = [ok(1), err(new Error('bad'))];

    for (const result of results) {
      expect(typeof result.ok).toBe('boolean');
      if (result.ok) {
        expect('error' in result).toBe(false);
      } else {
        expect('value' in result).toBe(false);
      }
    }
  });
});
