import { describe, expect, test } from 'bun:test';
import { toHtml } from 'hast-util-to-html';
import type { Element } from 'hast';
import { HIGHLIGHT_CLASSES, highlightToHast, isHighlightableLanguage } from './highlight';

function html(code: string, lang: string | null | undefined): string {
  const element = highlightToHast(code, lang);
  return element ? toHtml(element) : '';
}

/** Every class name the markup carries, in document order, duplicates included. */
function classesIn(markup: string): string[] {
  return [...markup.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1]!.split(/\s+/));
}

describe('highlightToHast', () => {
  test('an absent language is not highlighted', () => {
    expect(highlightToHast('const x = 1;', null)).toBeUndefined();
    expect(highlightToHast('const x = 1;', undefined)).toBeUndefined();
    expect(highlightToHast('const x = 1;', '')).toBeUndefined();
  });

  test('an unknown language is not highlighted, and does not throw', () => {
    expect(highlightToHast('whatever', 'no-such-language')).toBeUndefined();
    // The diagram fences (docs/SPECS.md §6) are source for a diagram
    // renderer, not prose to colour. They take the unhighlighted path by
    // the same rule that covers a language nobody has added yet.
    expect(highlightToHast('graph TD;\n  a --> b', 'mermaid')).toBeUndefined();
    expect(highlightToHast('a -> b', 'd2')).toBeUndefined();
  });

  test('a known language yields <pre><code> carrying token spans', () => {
    const markup = html('const x = 1;', 'ts');

    expect(markup.startsWith('<pre><code')).toBe(true);
    expect(markup).toContain('<span class="hl-keyword">const</span>');
    expect(markup).toContain('hl-line');
  });

  test('the language is recorded on <code> exactly as the fence spelled it', () => {
    expect(html('x = 1', 'python')).toContain('<code class="language-python">');
    expect(html('const x = 1;', 'ts')).toContain('<code class="language-ts">');
  });

  test('an alias resolves to its grammar', () => {
    for (const alias of ['ts', 'js', 'bash', 'sh', 'yml', 'py', 'rb']) {
      expect(isHighlightableLanguage(alias)).toBe(true);
      expect(classesIn(html('x', alias))).toContain('hl-line');
    }
  });

  test('a language name is matched case-insensitively', () => {
    expect(isHighlightableLanguage('TS')).toBe(true);
    expect(classesIn(html('const x = 1;', 'TS'))).toContain('hl-keyword');
  });

  test('every emitted span class is one of the declared highlight classes', () => {
    const samples: ReadonlyArray<readonly [string, string]> = [
      ['const x: number = 1; // c\nfunction f(a) { return `t${a}`; }', 'ts'],
      ['def f(a):\n    return "s"  # c\n', 'python'],
      ['SELECT a FROM b WHERE c = 1;', 'sql'],
      ['- a: 1\n# c\n', 'yaml'],
      ['echo "hi" # c\n', 'bash'],
      ['- a\n+ b\n', 'diff'],
      ['package main\n\nimport "fmt"\n', 'go'],
      ['fn main() { println!("x"); }', 'rust'],
      ['{ "a": 1 }', 'json'],
      ['<p class="x">a</p>', 'html'],
      ['.a { color: red }', 'css'],
    ];

    for (const [code, lang] of samples) {
      const spanClasses = classesIn(html(code, lang)).filter((name) => !name.startsWith('language-'));
      expect(spanClasses.length).toBeGreaterThan(0);
      for (const name of spanClasses) expect(HIGHLIGHT_CLASSES).toContain(name);
    }
  });

  test('the plain-foreground spans shiki emits are unwrapped, never left as bare spans', () => {
    // `(a) { ` tokenises as the theme's plain foreground — a span with no
    // meaning, and one the sanitiser would strip the class off anyway,
    // leaving `<span>` noise in every cached page.
    const markup = html('function f(a) { return 1; }', 'ts');

    expect(markup).not.toContain('<span>');
    expect(markup).toContain('(a) { ');
  });

  test('no inline style and no tabindex reach the output', () => {
    const markup = html('const x = 1;', 'ts');

    expect(markup).not.toContain('style=');
    expect(markup).not.toContain('tabindex');
    // The theme is expressed as classes, so no CSS variable survives into
    // the cached HTML — a theme switch is a stylesheet change, never a
    // re-render of every page (docs/DESIGN-SYSTEM.md §4.2).
    expect(markup).not.toContain('--dw-hl-');
    expect(markup).not.toContain('var(');
  });

  test('source text is carried verbatim, and markup in it stays text', () => {
    const markup = html('<script>alert(1)</script>', 'html');

    // The source text survives — split across token spans, as highlighting
    // by definition does — while its own angle brackets stay escaped text.
    expect(markup).not.toContain('<script');
    expect(markup.replace(/<[^>]*>/g, '')).toBe('&#x3C;script>alert(1)&#x3C;/script>\n');
  });

  test('a one-line block emits exactly one line element, closed by the newline mdast-util-to-hast also appends', () => {
    const element = highlightToHast('const x = 1;', 'ts') as Element;
    const code = element.children[0] as Element;

    expect(code.children.filter((child) => child.type === 'element')).toHaveLength(1);
    expect(code.children.at(-1)).toEqual({ type: 'text', value: '\n' });
  });

  test('every line of a multi-line block is its own line element', () => {
    const element = highlightToHast('const a = 1;\nconst b = 2;\nconst c = 3;', 'ts') as Element;
    const code = element.children[0] as Element;
    const lines = code.children.filter((child): child is Element => child.type === 'element');

    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line.properties.className).toEqual(['hl-line']);
  });

  // The header's whole reason for lifting `tokenizeTimeLimit`:
  // `rendered_html` is a cache, so a render that depends on how warm the
  // process is makes a save and a later backfill of the same bytes
  // disagree. With the default 500 ms-per-line limit in place this loop
  // returned a different token count on every one of its first five
  // iterations.
  test('the same block highlights byte-identically however many times it has been rendered', () => {
    const samples: ReadonlyArray<readonly [string, string]> = [
      ['const x: number = 1; // c', 'ts'],
      ['-- c\nSELECT a FROM t;', 'sql'],
      ['// c\nint main() { return 0; }', 'cpp'],
      ['<?php\n// c\nfunction f() { return 1; }', 'php'],
      ['/* c */\n.a { color: red }', 'css'],
      ['const A = () => <div x="y">{z}</div>;', 'tsx'],
    ];

    for (const [code, lang] of samples) {
      const first = html(code, lang);
      for (let attempt = 0; attempt < 5; attempt += 1) expect(html(code, lang)).toBe(first);
    }
  });

  test('a language whose grammar is loaded is tokenised in full on its very first use', () => {
    // The instability above showed up as a *coarser* first result — one
    // span for a whole line instead of a token per construct. Naming the
    // constructs is what makes this test fail on a regression rather than
    // merely on a crash.
    const markup = html('const x: number = 1; // c', 'ts');

    expect(markup).toContain('<span class="hl-keyword">const</span>');
    expect(markup).toContain('<span class="hl-comment">// c</span>');
  });
});

describe('HIGHLIGHT_CLASSES', () => {
  test('is the closed vocabulary the sanitiser allowlist is built from', () => {
    expect(HIGHLIGHT_CLASSES).toContain('hl-line');
    expect(HIGHLIGHT_CLASSES).toContain('hl-keyword');
    expect(HIGHLIGHT_CLASSES).toContain('hl-comment');
    expect(HIGHLIGHT_CLASSES).toContain('hl-string');
    // Nothing outside the `hl-` namespace, so no highlight class can
    // collide with an application class the read screen also carries.
    for (const name of HIGHLIGHT_CLASSES) expect(name.startsWith('hl-')).toBe(true);
    expect(new Set(HIGHLIGHT_CLASSES).size).toBe(HIGHLIGHT_CLASSES.length);
  });
});
