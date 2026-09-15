import { describe, expect, test } from 'vitest';
import { initials } from './initials';

describe('initials', () => {
  test('takes the first letter of the first and last word, upper-cased', () => {
    expect(initials('ana ruiz')).toBe('AR');
    expect(initials('Ana María Ruiz')).toBe('AR');
  });

  test('a single word gives one letter, and an empty name gives a placeholder rather than nothing', () => {
    expect(initials('Bo')).toBe('B');
    expect(initials('   ')).toBe('?');
  });
});
