import { expect, test } from 'bun:test';
import * as everything from './index';

test('namespace', () => {
  expect(typeof everything.named).toBe('function');
});
