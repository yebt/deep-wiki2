import { test, expect } from 'bun:test';
import type { Whole } from './whole';
import { type Inline } from './inline';
import type Defaulted from './defaulted';
import { type Shape, valued } from './index';

export type { Reexported } from './reexported';

test('a type-only import exercises nothing', () => {
  const w: Whole = { a: '' };
  const i: Inline = { b: '' };
  const s: Shape = { d: '' };
  const d: typeof Defaulted = () => 3;
  expect([w.a, i.b, s.d, String(d()), String(valued())].length).toBe(5);
});
