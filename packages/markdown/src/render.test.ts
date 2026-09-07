import { expect, test } from 'bun:test';
import { canonicalise } from './index';
import { render } from './render';

// Threat matrix — executable-file/active-content classification: markdown
// carries raw HTML verbatim (bucket B) and the rendered HTML is served to
// browsers. Sanitising happens at render time only, never at save (D12) —
// the stored Markdown keeps the raw bytes; the rendered HTML must not.

test('a script tag round-trips byte-identical in Markdown but renders inert', () => {
  const markdown = 'Before.\n\n<script>alert(1)</script>\n\nAfter.\n';

  expect(canonicalise(markdown)).toBe(markdown);

  const html = render(markdown);
  expect(html).not.toContain('<script');
  expect(html).not.toContain('alert(1)');
});

test('an onerror attribute is stripped from the rendered HTML', () => {
  const markdown = '<img src="x" onerror="alert(1)">\n';

  expect(canonicalise(markdown)).toBe(markdown);

  const html = render(markdown);
  expect(html).not.toContain('onerror');
});

test('a javascript: href is stripped from the rendered HTML', () => {
  const markdown = '[click me](javascript:alert(1))\n';

  const html = render(markdown);
  expect(html).not.toContain('javascript:');
});

test('an https link target is preserved', () => {
  const markdown = '[a link](https://example.com)\n';

  const html = render(markdown);
  expect(html).toContain('href="https://example.com"');
});

test('an https image target is preserved', () => {
  const markdown = '![alt](https://example.com/pic.png)\n';

  const html = render(markdown);
  expect(html).toContain('src="https://example.com/pic.png"');
});

test('a data: image target is stripped by the URL-scheme allowlist', () => {
  const markdown = '![alt](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)\n';

  const html = render(markdown);
  expect(html).not.toContain('data:text/html');
});

// knowledge-graph: Unresolved-Link Rendering Does Not Disclose Existence.
// `render()` takes only a markdown string — it has no channel to receive a
// wiki-link's resolution status (that lives in packages/db, resolved per
// save against the workspace's pages), so its output structurally cannot
// depend on whether a given `[[Target]]` happened to resolve. Both a
// resolved-looking and an unresolved-looking target therefore always
// render with identical treatment (docs/TODO.md Finding: render() does not
// yet hyperlink wiki-links at all — this property holds today by
// construction and MUST be preserved whenever that gap is closed).
test('a wiki-link to a title that could resolve and one that could not render with identical treatment', () => {
  const resolvable = render('See [[Existing Page]] for more.\n');
  const unresolvable = render('See [[Totally Nonexistent Page]] for more.\n');

  // Neither is turned into a distinguishing wrapper (an anchor tag, a
  // "resolved"/"unresolved" class) — both are the same plain paragraph
  // structure around their own bracketed text.
  expect(resolvable).not.toContain('<a ');
  expect(unresolvable).not.toContain('<a ');
  expect(resolvable.replace('Existing Page', 'X')).toBe(unresolvable.replace('Totally Nonexistent Page', 'X'));
});
