import { expect, test } from 'bun:test';
import { live } from './live';

test('live really runs', () => {
  expect(live()).toBe(1);
});
