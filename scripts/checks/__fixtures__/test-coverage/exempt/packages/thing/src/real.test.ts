import { expect, test } from 'bun:test';
import { real } from './real';

test('real', () => {
  expect(real()).toBe(1);
});
