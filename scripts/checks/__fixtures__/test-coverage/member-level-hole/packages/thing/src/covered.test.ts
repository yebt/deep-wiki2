import { expect, test } from 'bun:test';
import { covered } from './covered';

test('covered', () => {
  expect(covered()).toBe(1);
});
