import { expect, test } from 'bun:test';
import { fromMarkdown, UnsupportedConstructError } from './from-markdown';
import { probe, refusalFor } from './probe';
import { roundTrip } from './round-trip';
import { toMarkdown } from './to-markdown';

// markdown-round-trip: Unrepresentable Content Fails Closed. The API's
// edit-session route (WU-12) surfaces `construct` and `line` verbatim in
// its 409 body, so the probe itself must carry a line, not only a
// pass/fail verdict.
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

// ── An empty page is a page ────────────────────────────────────────────
//
// `markdown: z.string()` has no minimum and `canonicalise('') === ''`, so
// clearing a page and saving stores an empty document. Reopening it then
// went through `fromMarkdown('')` -> `schema.node('doc', null, [])`, which
// ProseMirror refuses because `doc`'s content expression is `block+`. That
// `RangeError` is not an `UnsupportedConstructError`, so it fell into
// `probe`'s catch-all and came back as a refusal that named no construct
// and no line: the page was permanently uneditable and the UI could not
// tell the author a single thing about why.
test('an empty document opens in edit mode instead of being refused', () => {
  expect(probe('')).toEqual({ ok: true });
});

test('an empty document opens as one empty paragraph and saves back as zero bytes', () => {
  const doc = fromMarkdown('');

  expect(doc.childCount).toBe(1);
  expect(doc.firstChild?.type.name).toBe('paragraph');
  expect(doc.firstChild?.content.size).toBe(0);
  expect(toMarkdown(doc)).toBe('');
  expect(roundTrip('')).toBe('');
});

// ── A refusal that cannot explain itself is its own defect ─────────────
//
// `ProbeResult`'s `unsupported_construct` variant promises a `construct`
// and a `line`; the edit screen renders both. Returning neither leaves the
// UI with "we will not open this" and nothing the author can act on. This
// asserts the promise as an invariant over a battery of inputs rather than
// over one, because the reasonless refusal was reachable through a branch
// nobody had a fixture for.
const REFUSAL_BATTERY = [
  '',
  '\n',
  '   \n',
  '\u0000\n',
  'Title\n=====\n',
  '    indented code\n',
  '* non canonical bullet\n',
  '![a](b.png)\n',
  '<div>raw</div>\n',
] as const;

test('every unsupported_construct refusal names both the construct and the line', () => {
  const reasonless = REFUSAL_BATTERY.filter((markdown) => {
    const result = probe(markdown);
    if (result.ok || result.reason !== 'unsupported_construct') return false;
    return typeof result.construct !== 'string' || typeof result.line !== 'number';
  });

  expect(reasonless).toEqual([]);
});

test('a bucket-C construct is reported by its mdast type and its source line', () => {
  const result = refusalFor(new UnsupportedConstructError('someFutureNode', 7, 'inline'));

  expect(result).toEqual({ ok: false, reason: 'unsupported_construct', construct: 'someFutureNode', line: 7 });
});

test('an unanticipated conversion failure still names something the UI can render', () => {
  // The branch that produced the reasonless refusal. It is not dead code:
  // `doc`'s `block+` content expression threw a bare RangeError here for
  // every empty document, and the next unforeseen throw will land here too.
  const result = refusalFor(new RangeError('Invalid content for node doc: <>'));

  expect(result).toEqual({ ok: false, reason: 'unsupported_construct', construct: 'RangeError', line: 1 });
});

// ── An inline image must not make a page permanently uneditable ────────
//
// SPECS §5.1 puts "reference-style links and images" in the **Verbatim**
// bucket: carried opaquely, byte-identical, edit mode opens. A resource
// image is the same construct with its destination inline, and read mode
// renders it either way — so refusing it meant a page with one screenshot
// in it rendered perfectly and could never be edited again.
test('an inline image is carried verbatim, so a page containing one still opens', () => {
  const markdown = 'An inline ![alt text](https://example.com/pic.png) image.\n';

  expect(roundTrip(markdown)).toBe(markdown);
  expect(probe(markdown)).toEqual({ ok: true });
});

test('an inline image survives round-tripping with its title and its escaping intact', () => {
  const markdown = '![alt text](https://example.com/pic.png "A title")\n';

  expect(roundTrip(markdown)).toBe(markdown);
  expect(probe(markdown)).toEqual({ ok: true });
});
