import { describe, expect, test } from 'bun:test';
import { ErrorResponseSchema } from './errors';

describe('ErrorResponseSchema', () => {
  test('accepts a plain error message', () => {
    const result = ErrorResponseSchema.safeParse({ error: 'forbidden' });

    expect(result.success).toBe(true);
  });

  test('rejects a body with no error field', () => {
    const result = ErrorResponseSchema.safeParse({});

    expect(result.success).toBe(false);
  });
});
