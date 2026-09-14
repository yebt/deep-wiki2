import { expect, test } from 'bun:test';
import { orphan } from './orphan';

// Nothing calls this, so `bun test` runs zero assertions over `orphan`.
export function neverCalled(): void {
  expect(orphan()).toBe(2);
}

test('registers a name and asserts nothing', () => {
  orphan();
});
