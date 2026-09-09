import { describe, expect, test } from 'bun:test';
import { canonicalise, parse, stringify } from './index';
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

// markdown-pipeline / page-content: render() must reuse the shared pipeline
// (GFM, wiki-links, tags), not a bare remark-parse instance — otherwise
// these constructs render as their raw source text rather than the
// structure the rest of the system already models them as.

test('a GFM table renders as a real HTML table, not raw pipe text', () => {
  const markdown = '| Name | Age |\n| :--- | --: |\n| A    |   1 |\n| Bee  |  22 |\n';

  const html = render(markdown);
  expect(html).toContain('<table>');
  expect(html).toContain('<td');
  expect(html).toContain('Bee');
  expect(html).not.toContain('| Name | Age |');
});

test('a footnote reference and definition render as a linked footnotes section', () => {
  const markdown = 'A claim needing a citation.[^1]\n\n[^1]: The citation itself.\n';

  const html = render(markdown);
  // The reference becomes a linked back-reference, not literal "[^1]" text,
  // and the definition moves into a dedicated, linked footnotes section —
  // the reference/definition relationship a bare parser drops entirely.
  expect(html).not.toContain('[^1]');
  // The reference's own id and the definition's own href/id must pair up —
  // proving the link, not just that both ids happen to exist somewhere.
  expect(html).toContain('id="user-content-fnref-1"');
  expect(html).toContain('href="#user-content-fn-1"');
  expect(html).toContain('id="user-content-fn-1"');
  expect(html).toContain('href="#user-content-fnref-1"');
  expect(html).toContain('class="footnotes"');
  expect(html).toContain('The citation itself.');
});

test('a wiki-link renders its own text as a distinct, non-clickable span, not literal brackets', () => {
  const markdown = 'See [[Getting Started]] and [[Getting Started|the guide]].\n';

  const html = render(markdown);
  expect(html).not.toContain('[[');
  expect(html).toContain('<span class="wiki-link">Getting Started</span>');
  expect(html).toContain('<span class="wiki-link">the guide</span>');
  // Not clickable yet — deliberately out of scope this batch (SPECS §14's
  // per-viewer/per-page-cache tension stays unresolved).
  expect(html).not.toContain('<a ');
});

test('a tag renders as a distinct span, not literal hash text folded into the paragraph', () => {
  const markdown = 'This page is #important reading.\n';

  const html = render(markdown);
  expect(html).toContain('<span class="tag">#important</span>');
});

test('a persisted block anchor does not leak its raw id into the visible rendered text', () => {
  const markdown = 'A paragraph with a persisted anchor. ^abc123\n';

  const html = render(markdown);
  expect(html).not.toContain('^abc123');
  expect(html).toContain('A paragraph with a persisted anchor.');
});

// comment-overlay: "render() Emits An Invisible Block Identity Attribute" —
// carries no visible change, but the id is now available to the client as
// a `data-block-id` attribute rather than leaking into visible text.
describe('data-block-id emission', () => {
  test('an anchored block carries data-block-id on its rendered element', () => {
    const markdown = 'A paragraph with a persisted anchor. ^abc123\n';

    const html = render(markdown);
    expect(html).toContain('data-block-id="abc123"');
    // The attribute carries no visible change: the text itself is unchanged.
    expect(html).toContain('A paragraph with a persisted anchor.');
  });

  test('an unanchored block carries no data-block-id attribute', () => {
    const markdown = 'A paragraph with no persisted anchor at all.\n';

    const html = render(markdown);
    expect(html).not.toContain('data-block-id');
  });

  test('the data-block-id attribute survives rehypeSanitize', () => {
    // Sanitisation happens inside render() itself (rehypeSanitize is part
    // of renderTransform) — this asserts the attribute survives that exact
    // pipeline, not merely that it exists in a pre-sanitised hast tree.
    const markdown = 'A heading with a persisted anchor ^headid\n\nA second, unrelated paragraph.\n';

    const html = render(markdown);
    expect(html).toContain('data-block-id="headid"');
  });

  test('only the anchored block carries the attribute; a sibling block does not', () => {
    const markdown = 'First paragraph, anchored. ^first1\n\nSecond paragraph, not anchored.\n';

    const html = render(markdown);
    expect(html).toContain('data-block-id="first1"');
    // Exactly one occurrence — the second paragraph must not also carry it.
    expect(html.split('data-block-id').length - 1).toBe(1);
  });

  // GATE-2: the hProperties mutation must never touch the tree
  // reconcileDerived receives — render() parses and mutates its own local
  // tree, so stringifying a tree built the ordinary way (parse ->
  // stringify, exactly what `canonicalise` and `reconcileDerived` do) must
  // stay byte-identical whether or not render() has run first.
  test('the hProperties mutation never leaks into a tree serialised independently of render()', () => {
    const markdown = 'A paragraph with a persisted anchor. ^abc123\n\nA second paragraph.\n';

    const beforeRender = stringify(parse(markdown));
    render(markdown); // mutates only its own internal tree
    const afterRender = stringify(parse(markdown));

    expect(afterRender).toBe(beforeRender);
    expect(canonicalise(markdown)).toBe(markdown);
  });
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
