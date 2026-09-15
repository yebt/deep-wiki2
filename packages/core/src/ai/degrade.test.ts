import { describe, expect, test } from 'bun:test';
import { degrade } from './degrade';

describe('degrade', () => {
  test('ladders schema -> tool-call -> prompted -> none in that fixed order', () => {
    expect(degrade('schema')).toBe('tool-call');
    expect(degrade('tool-call')).toBe('prompted');
    expect(degrade('prompted')).toBe('none');
  });

  test('never skips a rung (schema does not jump straight to prompted or none)', () => {
    expect(degrade('schema')).not.toBe('prompted');
    expect(degrade('schema')).not.toBe('none');
  });

  test('degrading past the floor returns null', () => {
    expect(degrade('none')).toBeNull();
  });
});
