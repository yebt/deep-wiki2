import { describe, expect, test } from 'bun:test';
import type { InputRule } from 'prosemirror-inputrules';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { fromMarkdown } from '../from-markdown';
import { schema } from '../schema';
import { toMarkdown } from '../to-markdown';
import { buildInputRules } from './input-rules';

/**
 * `InputRule.match`/`.handler` are real runtime properties this test
 * relies on directly, but `prosemirror-inputrules`' own `.d.ts` marks
 * both constructor parameters `@internal` and does not re-declare them as
 * public fields — this is a types-only gap (verified: they exist and
 * work at runtime, which is what every test below actually exercises).
 */
interface TestableInputRule {
  readonly match: RegExp;
  readonly handler: (state: EditorState, match: RegExpMatchArray, start: number, end: number) => Transaction | null;
}
function internals(rule: InputRule): TestableInputRule {
  return rule as unknown as TestableInputRule;
}

/**
 * document-editor: Live Preview Renders In Place. Typed Markdown syntax
 * (`**bold**`, `# `, …) becomes the real ProseMirror node/mark at the
 * cursor as soon as the closing character is typed — there is no separate
 * preview to render, because the editable document *is* the formatted
 * result. Each `InputRule`'s handler is a pure function of
 * `(state, match, start, end)`, testable with no view and no DOM.
 *
 * Document positions: a single-paragraph doc opens the paragraph at
 * position 0, so its text content starts at position 1 — every `start`/
 * `end` below is `1 + <index into the JS string>`, never the raw string
 * index itself.
 */
function stateWithParagraph(text: string): EditorState {
  const doc = schema.node('doc', null, [schema.node('paragraph', { blockAnchor: null }, text ? schema.text(text) : undefined)]);
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, text.length + 1) });
}

function findRule(rules: ReturnType<typeof buildInputRules>, sample: string) {
  return rules.find((rule) => internals(rule).match.test(sample));
}

describe('buildInputRules', () => {
  test('"# " turns the current paragraph into a heading', () => {
    const state = stateWithParagraph('# ');
    const rule = findRule(buildInputRules(schema), '# ');
    expect(rule).toBeDefined();
    const match = internals(rule!).match.exec('# ')!;
    const tr = internals(rule!).handler(state, match, 1, 3);
    expect(tr).not.toBeNull();
    const next = state.apply(tr!);
    expect(next.doc.firstChild!.type.name).toBe('heading');
    expect(next.doc.firstChild!.attrs.level).toBe(1);
  });

  test('"### " sets heading level 3', () => {
    const state = stateWithParagraph('### ');
    const rule = findRule(buildInputRules(schema), '### ');
    const match = internals(rule!).match.exec('### ')!;
    const next = state.apply(internals(rule!).handler(state, match, 1, 5)!);
    expect(next.doc.firstChild!.attrs.level).toBe(3);
  });

  test('"> " turns the current block into a blockquote', () => {
    const state = stateWithParagraph('> ');
    const rule = findRule(buildInputRules(schema), '> ');
    const match = internals(rule!).match.exec('> ')!;
    const next = state.apply(internals(rule!).handler(state, match, 1, 3)!);
    expect(next.doc.firstChild!.type.name).toBe('blockquote');
  });

  test('"- " turns the current block into a bullet list', () => {
    const state = stateWithParagraph('- ');
    const rule = findRule(buildInputRules(schema), '- ');
    const match = internals(rule!).match.exec('- ')!;
    const next = state.apply(internals(rule!).handler(state, match, 1, 3)!);
    expect(next.doc.firstChild!.type.name).toBe('list');
    expect(next.doc.firstChild!.attrs.ordered).toBe(false);
  });

  test('"1. " turns the current block into an ordered list starting at 1', () => {
    const state = stateWithParagraph('1. ');
    const rule = findRule(buildInputRules(schema), '1. ');
    const match = internals(rule!).match.exec('1. ')!;
    const next = state.apply(internals(rule!).handler(state, match, 1, 4)!);
    expect(next.doc.firstChild!.type.name).toBe('list');
    expect(next.doc.firstChild!.attrs.ordered).toBe(true);
    expect(next.doc.firstChild!.attrs.start).toBe(1);
  });

  test('"**bold**" applies the strong mark and consumes both marker pairs', () => {
    const text = 'Say **bold**';
    const state = stateWithParagraph(text);
    const rule = findRule(buildInputRules(schema), text);
    const match = internals(rule!).match.exec(text)!;
    // `match[0]` includes the rule's own leading `(?:^|\s)` — the doc
    // position of the match start is 1 (paragraph content offset) plus
    // the string index the regex actually matched from, not the
    // paragraph's own start.
    const next = state.apply(internals(rule!).handler(state, match, 1 + match.index!, text.length + 1)!);
    expect(next.doc.textContent).toBe('Say bold');
    const markedNode = next.doc.firstChild!.child(next.doc.firstChild!.childCount - 1);
    expect(markedNode.text).toBe('bold');
    expect(schema.marks.strong!.isInSet(markedNode.marks)).toBeTruthy();
  });

  test('"`code`" applies the inlineCode mark', () => {
    const text = 'Say `code`';
    const state = stateWithParagraph(text);
    const rule = findRule(buildInputRules(schema), text);
    const match = internals(rule!).match.exec(text)!;
    const next = state.apply(internals(rule!).handler(state, match, 1 + match.index!, text.length + 1)!);
    expect(next.doc.textContent).toBe('Say code');
    const markedNode = next.doc.firstChild!.child(next.doc.firstChild!.childCount - 1);
    expect(markedNode.text).toBe('code');
    expect(schema.marks.inlineCode!.isInSet(markedNode.marks)).toBeTruthy();
  });

  /**
   * The rest of what `packages/markdown`'s pipeline already parses inline
   * (owner decision, 2026-09-17): `~~x~~`, `*x*`, `__x__`, `[text](url)` and
   * a bare URL closed by a space. Each is typed the way the pipeline
   * would *read* it; what the editor then *writes* is the pinned canonical
   * spelling (`_x_`, `__x__`, `[url](url)`), which the round-trip cases
   * below hold.
   */
  test('"~~gone~~" applies the delete mark and consumes both tilde pairs', () => {
    const text = 'Say ~~gone~~';
    const state = stateWithParagraph(text);
    const rule = findRule(buildInputRules(schema), text);
    expect(rule).toBeDefined();
    const match = internals(rule!).match.exec(text)!;
    const next = state.apply(internals(rule!).handler(state, match, 1 + match.index!, text.length + 1)!);
    expect(next.doc.textContent).toBe('Say gone');
    const markedNode = next.doc.firstChild!.lastChild!;
    expect(markedNode.text).toBe('gone');
    expect(schema.marks.delete!.isInSet(markedNode.marks)).toBeTruthy();
  });

  test('"*em*" applies the emphasis mark — the same mark "_em_" applies', () => {
    const text = 'Say *em*';
    const state = stateWithParagraph(text);
    const rule = findRule(buildInputRules(schema), text);
    expect(rule).toBeDefined();
    const match = internals(rule!).match.exec(text)!;
    const next = state.apply(internals(rule!).handler(state, match, 1 + match.index!, text.length + 1)!);
    expect(next.doc.textContent).toBe('Say em');
    const markedNode = next.doc.firstChild!.lastChild!;
    expect(markedNode.text).toBe('em');
    expect(schema.marks.emphasis!.isInSet(markedNode.marks)).toBeTruthy();
    expect(schema.marks.strong!.isInSet(markedNode.marks)).toBeFalsy();
  });

  test('"__strong__" applies the strong mark — the pinned spelling `**bold**` also produces', () => {
    const text = 'Say __strong__';
    const state = stateWithParagraph(text);
    const rule = findRule(buildInputRules(schema), text);
    expect(rule).toBeDefined();
    const match = internals(rule!).match.exec(text)!;
    const next = state.apply(internals(rule!).handler(state, match, 1 + match.index!, text.length + 1)!);
    expect(next.doc.textContent).toBe('Say strong');
    const markedNode = next.doc.firstChild!.lastChild!;
    expect(markedNode.text).toBe('strong');
    expect(schema.marks.strong!.isInSet(markedNode.marks)).toBeTruthy();
    expect(schema.marks.emphasis!.isInSet(markedNode.marks)).toBeFalsy();
  });

  test('a half-typed "**bold*" or "__strong_" fires nothing: the single-marker rules do not claim the double markers', () => {
    const rules = buildInputRules(schema);
    expect(findRule(rules, 'Say **bold*')).toBeUndefined();
    expect(findRule(rules, 'Say __strong_')).toBeUndefined();
  });

  test('markers padded with spaces fire nothing: the pipeline reads `** bar **` as text, so a mark there would not survive a save', () => {
    const rules = buildInputRules(schema);
    for (const typed of ['Say ** bar **', 'Say __ bar __', 'Say _ bar _', 'Say * bar *', 'Say ~~ bar ~~', 'Say ` bar `']) {
      expect(findRule(rules, typed), typed).toBeUndefined();
    }
  });

  test('"[text](url)" applies the link mark with the url as href and keeps only the text', () => {
    const text = 'Read [the docs](https://example.com/docs)';
    const state = stateWithParagraph(text);
    const rule = findRule(buildInputRules(schema), text);
    expect(rule).toBeDefined();
    const match = internals(rule!).match.exec(text)!;
    const next = state.apply(internals(rule!).handler(state, match, 1 + match.index!, text.length + 1)!);
    expect(next.doc.textContent).toBe('Read the docs');
    const markedNode = next.doc.firstChild!.lastChild!;
    expect(markedNode.text).toBe('the docs');
    const link = schema.marks.link!.isInSet(markedNode.marks);
    expect(link).toBeTruthy();
    expect(link!.attrs).toEqual({ href: 'https://example.com/docs', title: null });
  });

  test('a bare URL followed by a space becomes a link whose text is the URL, and the space is kept', () => {
    // The space is the typed character: not in the document when the rule
    // runs (`prosemirror-inputrules` matches text-before plus the typed
    // text), so the handler is what inserts it — unmarked, so the link
    // ends at the URL.
    const text = 'See https://example.com/a?b=c ';
    const state = stateWithParagraph(text.slice(0, -1));
    const rule = findRule(buildInputRules(schema), text);
    expect(rule).toBeDefined();
    const match = internals(rule!).match.exec(text)!;
    const next = state.apply(internals(rule!).handler(state, match, 1 + match.index!, text.length)!);
    expect(next.doc.textContent).toBe('See https://example.com/a?b=c ');
    const paragraph = next.doc.firstChild!;
    const url = paragraph.child(1);
    expect(url.text).toBe('https://example.com/a?b=c');
    const link = schema.marks.link!.isInSet(url.marks);
    expect(link!.attrs).toEqual({ href: 'https://example.com/a?b=c', title: null });
    expect(paragraph.lastChild!.text).toBe(' ');
    expect(paragraph.lastChild!.marks).toEqual([]);
    // The caret sits after the space, with no link mark stored for the next character.
    expect(next.selection.from).toBe(paragraph.nodeSize - 1);
    expect(schema.marks.link!.isInSet(next.storedMarks ?? next.selection.$from.marks())).toBeFalsy();
  });

  test('a URL not closed by a space, or a scheme-less word, fires nothing', () => {
    const rules = buildInputRules(schema);
    expect(findRule(rules, 'See https://example.com')).toBeUndefined();
    expect(findRule(rules, 'See example.com ')).toBeUndefined();
    expect(findRule(rules, 'See https:// ')).toBeUndefined();
  });
});

/**
 * Every rule's output must be a document the pipeline writes back to the
 * *same* document: apply the rule, `toMarkdown`, `fromMarkdown`, compare.
 * The point is the spelling — a rule that produced a mark the serialiser
 * spells one way and the parser reads another would silently change what
 * the person typed on the first save. The bare-URL case keeps typing
 * after the space, since a paragraph's trailing space is not content.
 */
describe('buildInputRules — every rule\'s result survives toMarkdown → fromMarkdown unchanged', () => {
  const CASES: { readonly name: string; readonly typed: string; readonly then?: string; readonly markdown: string }[] = [
    { name: '**bold**', typed: 'Say **bold**', markdown: 'Say __bold__\n' },
    { name: '_em_', typed: 'Say _em_', markdown: 'Say _em_\n' },
    { name: '`code`', typed: 'Say `code`', markdown: 'Say `code`\n' },
    { name: '~~gone~~', typed: 'Say ~~gone~~', markdown: 'Say ~~gone~~\n' },
    { name: '*em*', typed: 'Say *em*', markdown: 'Say _em_\n' },
    { name: '__strong__', typed: 'Say __strong__', markdown: 'Say __strong__\n' },
    { name: '[text](url)', typed: 'Read [the docs](https://example.com/docs)', markdown: 'Read [the docs](https://example.com/docs)\n' },
    {
      name: 'bare URL then a space',
      typed: 'See https://example.com ',
      then: 'now',
      markdown: 'See [https://example.com](https://example.com) now\n',
    },
  ];

  for (const { name, typed, then, markdown } of CASES) {
    test(name, () => {
      const inDocument = typed.endsWith(' ') ? typed.slice(0, -1) : typed;
      const state = stateWithParagraph(inDocument);
      const rule = findRule(buildInputRules(schema), typed);
      expect(rule).toBeDefined();
      const match = internals(rule!).match.exec(typed)!;
      let next = state.apply(internals(rule!).handler(state, match, 1 + match.index!, inDocument.length + 1)!);
      if (then) next = next.apply(next.tr.insertText(then));

      const written = toMarkdown(next.doc);
      expect(written).toBe(markdown);
      expect(fromMarkdown(written).eq(next.doc)).toBe(true);
    });
  }
});
