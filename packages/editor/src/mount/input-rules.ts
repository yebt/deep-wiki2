/**
 * Markdown-shortcut input rules (document-editor spec: "Live Preview
 * Renders In Place"). Typing `**bold**`, `# `, `> `, `- `, `1. ` or
 * `` `code` `` converts the typed syntax into the real schema node/mark
 * at the cursor, consuming the markdown punctuation — there is no
 * separate preview pane because the editable ProseMirror document *is*
 * the rendered result. Every rule's `handler` is a pure
 * `(state, match, start, end) => Transaction | null` function, matching
 * `prosemirror-inputrules`' own contract, so each is unit-testable
 * without a view or a DOM (see input-rules.test.ts).
 */
import type { MarkType, NodeType, Schema } from 'prosemirror-model';
import { InputRule, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import type { EditorState, Transaction } from 'prosemirror-state';

/**
 * A repeatable mark input rule: `regexp`'s last capture group is the text
 * to keep, everything else in the match is the markdown punctuation to
 * drop. The regexp's leading `(?:^|\s)` alternative exists only so the
 * rule does not fire mid-word (`email@example` must not turn into a
 * mention, and `foo**bar**` at the very start of a run must not eat the
 * character before it) — the whitespace character it matches is
 * deliberately preserved, never deleted, which is why `startSpaces` is
 * computed and added to `start` rather than deleting the whole match.
 */
function markInputRule(regexp: RegExp, markType: MarkType): InputRule {
  return new InputRule(regexp, (state: EditorState, match: RegExpMatchArray, start: number, end: number): Transaction | null => {
    const content = match[1];
    if (content === undefined) return null;

    const fullMatch = match[0];
    const startSpaces = fullMatch.length - fullMatch.trimStart().length;
    const contentStart = start + startSpaces;
    const textStart = start + fullMatch.indexOf(content);
    const textEnd = textStart + content.length;

    const tr = state.tr;
    if (textEnd < end) tr.delete(textEnd, end);
    if (textStart > contentStart) tr.delete(contentStart, textStart);
    const markEnd = contentStart + content.length;
    tr.addMark(contentStart, markEnd, markType.create());
    tr.removeStoredMark(markType);
    return tr;
  });
}

export function buildInputRules(schema: Schema): InputRule[] {
  const heading = schema.nodes.heading as NodeType;
  const blockquote = schema.nodes.blockquote as NodeType;
  const list = schema.nodes.list as NodeType;

  return [
    textblockTypeInputRule(/^(#{1,6})\s$/, heading, (match) => ({ level: match[1]!.length })),
    wrappingInputRule(/^\s*>\s$/, blockquote),
    wrappingInputRule(/^\s*[-+]\s$/, list, () => ({ ordered: false })),
    wrappingInputRule(/^(\d+)\.\s$/, list, (match) => ({ ordered: true, start: Number(match[1]) })),
    markInputRule(/(?:^|\s)\*\*([^*]+)\*\*$/, schema.marks.strong!),
    markInputRule(/(?:^|\s)_([^_]+)_$/, schema.marks.emphasis!),
    markInputRule(/(?:^|\s)`([^`]+)`$/, schema.marks.inlineCode!),
  ];
}
