import { expect, test } from 'bun:test';
import { fromMarkdown as rootFromMarkdown, probe as rootProbe, toMarkdown as rootToMarkdown } from '../index';
import { fromMarkdown, probe, toMarkdown } from './index';

/**
 * `"./mount"` re-exports the converters so the one consumer that needs
 * them together with the editing surface — apps/web's `EditorSurface` —
 * can take everything it needs from the chunk it already loads lazily,
 * instead of statically importing `"."` and dragging the whole
 * remark/micromark stack into the edit route's pre-hydration chunk
 * (docs/TODO.md Findings 2026-09-16, "edit-mode latency": 14 requests,
 * 2.3 MB in dev, before anything needed them). They must be the same
 * functions: a second binding would be a second parser by another name.
 */
test('"./mount" re-exports the "." export\'s fromMarkdown, toMarkdown and probe, not copies', () => {
  expect(fromMarkdown).toBe(rootFromMarkdown);
  expect(toMarkdown).toBe(rootToMarkdown);
  expect(probe).toBe(rootProbe);
});

test('the re-exported converters round-trip a document', () => {
  const markdown = '# Title\n\nA paragraph.\n';
  expect(toMarkdown(fromMarkdown(markdown))).toBe(markdown);
});
