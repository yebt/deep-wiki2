import { describe, expect, test } from 'bun:test';
import type { InputRule } from 'prosemirror-inputrules';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { schema } from '../schema';
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
});
