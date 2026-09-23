import { expect, test } from 'bun:test';
import { fromMarkdown as rootFromMarkdown, probe as rootProbe, roundTrip as rootRoundTrip, toMarkdown as rootToMarkdown } from '../index';
import { fromMarkdown, probe, roundTrip, toMarkdown } from './index';

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
test('"./mount" re-exports the "." export\'s fromMarkdown, toMarkdown, probe and roundTrip, not copies', () => {
  expect(fromMarkdown).toBe(rootFromMarkdown);
  expect(toMarkdown).toBe(rootToMarkdown);
  expect(probe).toBe(rootProbe);
  expect(roundTrip).toBe(rootRoundTrip);
});

test('the re-exported converters round-trip a document', () => {
  const markdown = '# Title\n\nA paragraph.\n';
  expect(toMarkdown(fromMarkdown(markdown))).toBe(markdown);
});

/**
 * Source mode's Format action (apps/web, owner decision 2026-09-23) is
 * `roundTrip` and nothing else: the canonical form of the buffer is the
 * text the probe beside it compares against, so the action and the check
 * cannot disagree about what "canonical" means. Taken from this chunk for
 * the same reason the converters are.
 */
test('roundTrip is the canonical form the probe accepts', () => {
  const formatted = roundTrip('A *word* here.\n\n\n');
  expect(formatted).toBe('A _word_ here.\n');
  expect(probe(formatted)).toEqual({ ok: true });
});
