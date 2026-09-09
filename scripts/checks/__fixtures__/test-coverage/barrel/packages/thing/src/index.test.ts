import { expect, test } from 'bun:test';
import { named } from './index';

test('named', () => {
  expect(named()).toBe(1);
});
