import { test, expect } from 'bun:test';
import { genuine } from './genuine';

// expect(genuine()).toBe(0) — the old spelling, kept as a note
const NOTE = 'the old assertion read expect(genuine()).toBe(0)';

test('a real assertion beside a commented one still counts', () => {
  void NOTE;
  expect(genuine()).toBe(1);
});
