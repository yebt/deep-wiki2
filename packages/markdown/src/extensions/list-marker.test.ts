import { expect, test } from 'bun:test';
import { canonicalise } from '../index';

// markdown-round-trip: Nested List Preservation — mdast erases which bullet
// character a list used; this pipeline captures and reserialises it per
// level so a nested list mixing markers is not silently flattened onto one.

test('a nested list mixing bullet markers preserves each level on round trip', () => {
  const markdown = '- top\n  * nested one\n  * nested two\n- top two\n';

  expect(canonicalise(markdown)).toBe(markdown);
});

test('a flat list with no nesting still uses the pinned bullet', () => {
  const markdown = '* one\n* two\n';

  expect(canonicalise(markdown)).toBe('- one\n- two\n');
});
