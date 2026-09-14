import { expect, test } from 'bun:test';
import { skipped } from './skipped';

test.skip('bun runs zero assertions over this', () => {
  expect(skipped()).toBe(2);
});
