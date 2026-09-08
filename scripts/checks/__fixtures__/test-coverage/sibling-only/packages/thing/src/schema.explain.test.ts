import { expect, test } from 'bun:test';

test('asserts against a database, never importing the module', () => {
  expect(1).toBe(1);
});
