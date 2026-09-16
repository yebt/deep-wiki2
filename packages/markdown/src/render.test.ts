import { describe, expect, test } from 'bun:test';
import { canonicalise, parse, stringify } from './index';
import { CURRENT_PIPELINE_VERSION, render } from './render';
import { sliceBlocks } from './blocks';

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

  // A block with no persisted anchor has no id the client could send to
  // `POST /pages/:id/comments` — its derived identity lives only in the
  // parser (`sliceBlocks`). The read screen composes the overlay over
  // cached HTML and never parses, so the render has to carry that identity
  // too, under its own attribute: `data-block-id` stays "persisted anchor
  // only", exactly as the comment-overlay spec states it.
  describe('data-derived-block-id emission', () => {
    test('an unanchored paragraph carries its derived identity, and still no data-block-id', () => {
      const markdown = 'A paragraph with no persisted anchor at all.\n';
      const [slice] = sliceBlocks(parse(markdown), markdown);
      expect(slice!.anchorId).toBeNull();

      const html = render(markdown);
      expect(html).toContain(`data-derived-block-id="${slice!.id}"`);
      expect(html).not.toContain('data-block-id');
    });

    test('an anchored block carries data-block-id and never a derived id', () => {
      const html = render('Anchored. ^abc123\n');
      expect(html).toContain('data-block-id="abc123"');
      expect(html).not.toContain('data-derived-block-id');
    });

    test('a heading carries a derived id; a list, a code block and a table carry neither attribute', () => {
      const markdown = '## A heading\n\n- one\n- two\n\n```\ncode\n```\n\n| a |\n| - |\n| b |\n';
      const html = render(markdown);
      const [heading] = sliceBlocks(parse(markdown), markdown);
      expect(html).toContain(`<h2 data-derived-block-id="${heading!.id}">`);
      // Only the heading: a persisted anchor cannot live on the other three
      // (`ANCHORABLE_BLOCKS`), so offering them an identity a mint could not
      // honour would be an affordance that fails on use.
      expect(html.split('data-derived-block-id').length - 1).toBe(1);
      expect(html).not.toContain('data-block-id');
    });

    test('two identical unanchored paragraphs get distinct derived ids, in document order', () => {
      const markdown = 'Same text.\n\nSame text.\n';
      const html = render(markdown);
      const [first, second] = sliceBlocks(parse(markdown), markdown);
      expect(first!.id).not.toBe(second!.id);
      expect(html.indexOf(`data-derived-block-id="${first!.id}"`)).toBeLessThan(html.indexOf(`data-derived-block-id="${second!.id}"`));
    });

    test('a well-formed derived id on raw HTML survives; a malformed one is stripped while the element survives', () => {
      const forged = render('<p data-derived-block-id="d:0123456789ab#0">x</p>\n');
      expect(forged).toContain('data-derived-block-id="d:0123456789ab#0"');

      const malformed = render('<p data-derived-block-id="not an id">x</p>\n');
      expect(malformed).toContain('>x</p>');
      expect(malformed).not.toContain('data-derived-block-id');
    });

    test('CURRENT_PIPELINE_VERSION moved past the derived-id emission so the backfill re-renders every older row', () => {
      expect(CURRENT_PIPELINE_VERSION).toBeGreaterThanOrEqual(4);
    });
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
  // The derived block id is a hash of the block's own text, so it differs
  // between the two by construction — an identity, not a treatment.
  const withoutIdentity = (html: string) => html.replace(/ data-derived-block-id="[^"]*"/, '');
  expect(withoutIdentity(resolvable).replace('Existing Page', 'X')).toBe(withoutIdentity(unresolvable).replace('Totally Nonexistent Page', 'X'));
});

// docs/TODO.md Finding (2026-09-09), "two pipelines agreeing on the bytes
// and disagreeing on what the user sees": raw HTML is bucket-B **Verbatim**
// under SPECS §5.1 — `probe()` returns `{ok: true}`, edit mode opens, and
// GATE-2 proves `markdown -> ProseMirror -> markdown` is byte-identical.
// None of that touches `render()`, which dropped every hast `raw` node
// wholesale (`rehypeSanitize` handles only root/element/text/comment/
// doctype), so a `<details>` runbook saved correctly and read as an empty
// gap. These tests assert at the layer that was blind: the reader's HTML.
describe('raw HTML reaches the reader (SPECS §5.1, Verbatim)', () => {
  test('a block-level <details> runbook renders its summary and its body, not an empty gap', () => {
    const markdown = '<details>\n<summary>Rollback steps</summary>\n\nRun `deploy --rollback`.\n\n</details>\n';

    // The canonical bytes were never in doubt — that is the whole point.
    expect(canonicalise(markdown)).toBe(markdown);

    const html = render(markdown);
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>Rollback steps</summary>');
    expect(html).toContain('deploy --rollback');
  });

  test('a block-level raw HTML element renders both its tag and its text', () => {
    const markdown = '<div>hello world</div>\n';

    expect(canonicalise(markdown)).toBe(markdown);

    const html = render(markdown);
    expect(html).toContain('<div>');
    expect(html).toContain('hello world');
  });

  test('inline raw HTML keeps its tags rather than being flattened to bare text', () => {
    const markdown = 'Some <b>bold</b> inline.\n';

    expect(canonicalise(markdown)).toBe(markdown);

    const html = render(markdown);
    expect(html).toContain('<b>bold</b>');
  });

  test('raw HTML surrounding modelled markdown does not swallow the modelled content', () => {
    const markdown = '<div>\n\n## A real heading\n\n</div>\n';

    const html = render(markdown);
    expect(html).toContain('<div>');
    expect(html).toMatch(/<h2 data-derived-block-id="[^"]+">A real heading<\/h2>/);
  });
});

// The read-mode HTML is cached and injected with `v-html`
// (`apps/web/app/pages/pages/[id]/index.vue`), so everything that survives
// `SANITIZE_SCHEMA` reaches a reader's DOM. Before raw HTML was parsed,
// every probe below passed for the wrong reason — the payload was dropped
// wholesale, along with all of its neighbouring content. Each test
// therefore pairs its negative assertion with a positive one proving the
// surrounding raw HTML *did* render, so none of them can ever go green
// again by the pipeline simply throwing the input away.
describe('raw HTML sanitisation', () => {
  test('a script element is stripped with its source, while its sibling raw HTML renders', () => {
    const html = render('<div>kept</div>\n\n<script>alert(1)</script>\n');

    expect(html).toContain('<div>kept</div>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  test('an onerror handler is stripped while the img element itself survives', () => {
    const html = render('<img src="x" onerror="alert(1)">\n');

    expect(html).toContain('<img');
    expect(html).toContain('src="x"');
    expect(html).not.toContain('onerror');
  });

  test('an ontoggle handler on a rendered details element is stripped', () => {
    const html = render('<details open ontoggle="alert(1)"><summary>s</summary>b</details>\n');

    expect(html).toContain('<details');
    expect(html).toContain('<summary>s</summary>');
    expect(html).not.toContain('ontoggle');
  });

  test('a javascript: href in raw HTML is stripped while the anchor text survives', () => {
    const html = render('<a href="javascript:alert(1)">click me</a>\n');

    expect(html).toContain('click me');
    expect(html).not.toContain('javascript:');
  });

  test('a vbscript: href in raw HTML is stripped while the anchor text survives', () => {
    const html = render('<a href="vbscript:msgbox(1)">click me</a>\n');

    expect(html).toContain('click me');
    expect(html).not.toContain('vbscript:');
  });

  test('a data: href in raw HTML is stripped while the anchor text survives', () => {
    const html = render('<a href="data:text/html,<script>alert(1)</script>">click me</a>\n');

    expect(html).toContain('click me');
    expect(html).not.toContain('data:text/html');
  });

  test('an iframe is removed entirely rather than unwrapped, and its sibling renders', () => {
    const html = render('<div>kept</div>\n\n<iframe src="https://evil.example"></iframe>\n');

    expect(html).toContain('<div>kept</div>');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('evil.example');
  });

  test('an object and an embed are removed entirely, and their sibling renders', () => {
    const html = render('<div>kept</div>\n\n<object data="https://evil.example/x.swf"></object>\n\n<embed src="https://evil.example/y.swf">\n');

    expect(html).toContain('<div>kept</div>');
    expect(html).not.toContain('<object');
    expect(html).not.toContain('<embed');
    expect(html).not.toContain('evil.example');
  });

  test('an svg <use> pointing at a data: URI is removed entirely, and its sibling renders', () => {
    const html = render('<div>kept</div>\n\n<svg><use href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+"/></svg>\n');

    expect(html).toContain('<div>kept</div>');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<use');
    expect(html).not.toContain('data:image/svg+xml');
  });

  test('a style element is removed with its CSS rather than unwrapped into visible text', () => {
    const html = render('<div>kept</div>\n\n<style>body{background:url(https://evil.example/leak)}</style>\n');

    expect(html).toContain('<div>kept</div>');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('evil.example');
  });

  test('the math/mtext/table/mglyph/style mXSS sequence yields no live img or handler', () => {
    const html = render(
      '<div>kept</div>\n\n<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>--></mglyph></table></mtext></math>\n',
    );

    expect(html).toContain('<div>kept</div>');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('<math');
    // No comment node survives to smuggle the payload past a second parse.
    expect(html).not.toContain('<!--');
  });

  test('a form and a named input are removed rather than exposing form-scoped named access', () => {
    const html = render('<div>kept</div>\n\n<form><input name="getElementById"></form>\n');

    expect(html).toContain('<div>kept</div>');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('name="getElementById"');
  });

  // `clobberPrefix: ''` used to be safe only because raw HTML — the sole
  // route to an author-chosen `id`/`name` — never rendered. Now that it
  // does, `id` is allowed by pattern (the `user-content-fn`/`fnref`
  // prefixes `mdast-util-to-hast` mints itself) and `name` is not allowed
  // at all, so an author still cannot introduce a global-namespace handle.
  test('an author-chosen id on rendered raw HTML is stripped while the element survives', () => {
    const html = render('<div id="app">clobber</div>\n');

    expect(html).toContain('<div>clobber</div>');
    expect(html).not.toContain('id="app"');
  });

  test('an author-chosen name on rendered raw HTML is stripped while the element survives', () => {
    const html = render('<img src="x" name="currentScript">\n');

    expect(html).toContain('<img');
    expect(html).toContain('src="x"');
    expect(html).not.toContain('name=');
  });

  test('the footnote id/href pairs and the aria-describedby target all still resolve', () => {
    const html = render('A claim.[^1]\n\n[^1]: The real citation.\n');

    expect(html).toContain('id="user-content-fnref-1"');
    expect(html).toContain('href="#user-content-fn-1"');
    expect(html).toContain('id="user-content-fn-1"');
    expect(html).toContain('href="#user-content-fnref-1"');
    // Both halves of the aria pair. Narrowing `id` to an allowlist drops
    // this one silently if `footnote-label` is left off it: the heading
    // loses its id, the reference keeps pointing at it, and every footnote
    // reference ends up describing nothing.
    expect(html).toContain('aria-describedby="footnote-label"');
    expect(html).toContain('id="footnote-label"');
  });

  // The boundary on `id`, pinned in both directions. `rehype-raw`
  // reserializes and reparses the whole document, so node identity — and
  // with it any way to tell a machine-minted attribute from an
  // author-written one of the same shape — is gone by the time the
  // sanitiser runs. The allowlist can therefore bound the *shape* of an
  // `id` but not its *origin*; both halves of that are asserted here so
  // widening the pattern cannot pass unnoticed.
  test('raw HTML cannot introduce an id of its own choosing', () => {
    const html = render('<div id="app">a</div>\n\n<div id="__NUXT__">b</div>\n\n<div id="footnote-label">c</div>\n');

    // Every div still renders — this is not passing by dropping the input.
    expect(html).toContain('>a</div>');
    expect(html).toContain('>b</div>');
    expect(html).toContain('>c</div>');
    // Neither an application handle nor a global-namespace one survives.
    expect(html).not.toContain('id="app"');
    expect(html).not.toContain('id="__NUXT__"');
    // `footnote-label` is on the allowlist, so this one shape does survive
    // — the accepted, bounded residual. It is not a valid JavaScript
    // identifier, so it is not a `window.<name>` handle, and duplicating it
    // only retargets an in-page anchor inside the author's own document.
    expect(html).toContain('id="footnote-label"');
  });

  // `span: ['className']` existed only so `wikiLinkHandler`/`tagHandler`
  // could carry their own class. Raw HTML now reaches the same rule, so it
  // is narrowed to those two literal values rather than left open.
  test('raw HTML cannot borrow an arbitrary class on a span, but the span itself renders', () => {
    const html = render('<span class="hl">highlighted</span>\n');

    expect(html).toContain('highlighted');
    expect(html).not.toContain('class="hl"');
  });

  test('raw HTML can wear the wiki-link and tag classes, and no others', () => {
    // Deliberately no literal `#tag` text in the payload: `tagHandler`
    // would legitimately mint `class="tag"` for it, and the assertion
    // below must fail on impersonation, not on a real tag rendering.
    const html = render('<span class="wiki-link">fake link</span> and <span class="tag">fake tag</span>\n');

    expect(html).toContain('fake link');
    expect(html).toContain('fake tag');
    // Accepted residual, for the same reason as the `id` boundary above:
    // the sanitiser bounds the value, not the author. What it does buy is
    // that these two are the *only* classes raw HTML can wear — see below.
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain('class="tag"');
  });

  test('raw HTML cannot borrow any class outside the two this file itself mints', () => {
    const html = render('<span class="doc-body">a</span> <span class="wiki-link extra">b</span>\n');

    expect(html).toContain('>a</span>');
    expect(html).toContain('>b</span>');
    expect(html).not.toContain('doc-body');
    expect(html).not.toContain('extra');
    // The allowed half of the second span's class list is kept, not the
    // whole attribute discarded — sanitisation filters a class list
    // value-by-value.
    expect(html).toContain('class="wiki-link"');
  });

  test('a span whose classes are all filtered out carries no empty class attribute', () => {
    const html = render('<span class="doc-body">a</span>\n');

    expect(html).toContain('>a</span>');
    expect(html).not.toContain('class=""');
    expect(html).not.toContain('class=');
  });

  test('a well-formed data-block-id on raw HTML survives, alongside a real anchor', () => {
    const html = render('<p data-block-id="forged">x</p>\n\nAnchored paragraph. ^real01\n');

    expect(html).toContain('data-block-id="real01"');
    expect(html).toContain('>x</p>');
    // Accepted residual again: a well-formed id survives. What the grammar
    // buys is that the attribute stays machine-shaped — nothing outside
    // `[0-9A-Za-z]+` can ride in on it.
    expect(html).toContain('data-block-id="forged"');
  });

  test('a malformed data-block-id on raw HTML is stripped while the element survives', () => {
    const html = render('<p data-block-id="not a real id!">x</p>\n');

    expect(html).toContain('>x</p>');
    expect(html).not.toContain('data-block-id');
  });
});
