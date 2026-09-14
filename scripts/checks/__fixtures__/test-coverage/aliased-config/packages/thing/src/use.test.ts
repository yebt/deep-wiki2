import { expect, test } from 'bun:test';
import { nextDelay } from './use';

test('nextDelay delegates', () => {
  expect(nextDelay(0)).toBe(1000);
});
