import { expect, test } from 'bun:test';
import { ANCHOR } from './anchor';

test('anchor', () => {
  expect(ANCHOR).toBe(1);
});
