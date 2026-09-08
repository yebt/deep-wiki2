import { expect, test } from 'bun:test';
import { readConfig } from './config';

test('config', () => {
  expect(typeof readConfig()).toBe('string');
});
