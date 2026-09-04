import { describe, expect, test } from 'bun:test';
import { normalizeEmail } from './email';

describe('normalizeEmail', () => {
  test('lower-cases the email', () => {
    expect(normalizeEmail('User@Example.COM')).toBe('user@example.com');
  });

  test('trims surrounding whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  test('is idempotent: normalising an already-normalised email changes nothing', () => {
    const once = normalizeEmail('User@Example.COM');
    const twice = normalizeEmail(once);
    expect(twice).toBe(once);
  });
});
