import { expect, test } from 'bun:test';
import { postponed } from './postponed';

test.todo('one day', () => {
  expect(postponed()).toBe(3);
});
