import { expect, test } from 'bun:test';
import { probe } from './probe';

// markdown-round-trip: Unrepresentable Content Fails Closed. The API's
// edit-session route (WU-12) surfaces `construct` and `line` verbatim in
// its 409 body, so the probe itself must carry a line, not only a
// pass/fail verdict. Every construct in today's refused/ corpus (setext
// headings, indented code, one non-canonical spelling per pin) fails via
// `not_byte_identical` rather than `unsupported_construct` — bucket A/B
// together already name every node type remark-gfm plus this pipeline's
// extensions can produce, so `unsupported_construct` is reachable only by
// a future remark upgrade adding a node type neither bucket claims. The
// line it would report is still computed and typed (see from-markdown.ts's
// `UnsupportedConstructError`), just not exercised by an achievable
// fixture today.
test('a setext heading (not byte-identical) reports the line where the divergence starts', () => {
  const markdown = 'Intro line.\n\nTitle\n=====\n';

  const result = probe(markdown);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe('not_byte_identical');
    expect(result.line).toBeGreaterThanOrEqual(1);
  }
});

test('byte-identical canonical markdown probes ok with no reason or line', () => {
  const result = probe('# Hello\n');

  expect(result).toEqual({ ok: true });
});
