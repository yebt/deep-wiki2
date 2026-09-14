import { expect, test } from 'bun:test';
import { thing } from './thing';

test('thing', () => {
  expect(thing()).toBe(1);
});
