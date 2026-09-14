import { expect, test } from 'bun:test';
import { reached } from './reached';

function assertReached(): void {
  expect(reached()).toBe(1);
}

test('a helper the test calls is still executed', () => {
  assertReached();
});
