/**
 * Markdown-shortcut input rules (document-editor spec: "Live Preview
 * Renders In Place"). Typing `**bold**`, `__strong__`, `_em_`, `*em*`,
 * `~~gone~~`, `` `code` ``, `[text](url)`, a bare URL closed by a space,
 * `# `, `> `, `- `, `1. `, `- [ ] ` or `- [x] ` converts the typed syntax
 * into the real schema node/mark at the cursor, consuming the markdown
 * punctuation —
 * there is no separate preview pane because the editable ProseMirror
 * document *is* the rendered result. Every rule's `handler` is a pure
 * `(state, match, start, end) => Transaction | null` function, matching
 * `prosemirror-inputrules`' own contract, so each is unit-testable
 * without a view or a DOM (see input-rules.test.ts).
 *
 * The inline set is exactly what `packages/markdown`'s pipeline parses
 * inline and this schema models as a mark (owner decision, 2026-09-17).
 * A rule accepts the spelling a person *types*; what the editor then
 * *writes* is the pinned canonical one (`PINNED_OPTIONS`: `_` for
 * emphasis and strong, `resourceLink` for every link), so `*em*` is
 * saved as `_em_`, `**bold**` as `__bold__` and a bare URL as
 * `[url](url)` — the spelling `canonicalise()` would have produced for
 * the same bytes. input-rules.test.ts holds every rule's result to
 * `toMarkdown` → `fromMarkdown` identity.
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

/**
 * `[text](url)`: the text stays, the brackets, the parentheses and the
 * URL go, and the text carries a `link` mark whose `href` is the URL.
 * `resourceLink` is pinned, so `[text](url)` is the canonical spelling
 * and the mark re-opens as exactly what was typed. No leading-space
 * requirement — a link is legal mid-word — and no title form: `[t](u
 * "title")` stays text until the toolbar's link popover or a later rule
 * takes it.
 */
function linkInputRule(regexp: RegExp, linkType: MarkType): InputRule {
  return new InputRule(regexp, (state: EditorState, match: RegExpMatchArray, start: number, end: number): Transaction | null => {
    const text = match[1];
    const href = match[2];
    if (text === undefined || href === undefined) return null;
    const textStart = start + match[0].indexOf(text);
    const textEnd = textStart + text.length;
    const tr = state.tr;
    // The tail first, so the head's deletion does not shift it.
    if (textEnd < end) tr.delete(textEnd, end);
    if (textStart > start) tr.delete(start, textStart);
    tr.addMark(start, start + text.length, linkType.create({ href, title: null }));
    tr.removeStoredMark(linkType);
    return tr;
  });
}

/**
 * A bare `http(s)://…` closed by a space: the URL becomes a link to itself
 * — the mark the pipeline's autolink-literal parse produces, and which
 * `canonicalise()` spells `[url](url)` under the `resourceLink` pin — and
 * the space is kept. The space is the typed character, absent from the
 * document when the rule runs (`prosemirror-inputrules` matches
 * text-before plus the typed text and the handler's transaction replaces
 * the insertion), so it is inserted here, as an unmarked text node, and
 * no stored mark follows it: the link ends where the URL ends.
 */
function bareUrlInputRule(regexp: RegExp, linkType: MarkType): InputRule {
  return new InputRule(regexp, (state: EditorState, match: RegExpMatchArray, start: number, end: number): Transaction | null => {
    const url = match[1];
    if (url === undefined) return null;
    const urlStart = start + match[0].indexOf(url);
    const urlEnd = urlStart + url.length;
    if (urlEnd !== end) return null;
    const tr = state.tr;
    tr.addMark(urlStart, urlEnd, linkType.create({ href: url, title: null }));
    tr.insert(end, state.schema.text(' '));
    tr.removeStoredMark(linkType);
    return tr;
  });
}

/**
 * `[ ] ` / `[x] ` at the very start of a list item's first block: the item
 * becomes a GFM task item and the typed brackets are consumed.
 *
 * This is how `- [ ] ` converts, and it has to be spelled this way rather
 * than as one rule for the whole prefix. `- ` has already fired by the time
 * the bracket is typed — `wrappingInputRule` above turned the paragraph
 * into a bullet list — so what remains in the document is `[ ] ` at the
 * start of a list item, and that is what this rule matches. Typing
 * `- [ ] Ship it` therefore produces the task item GFM spells the same way;
 * before this rule existed it produced a *bullet* whose text was the
 * literal `[ ] Ship it`, which `toMarkdown` then had to escape to
 * `- \[ ] Ship it` — the owner's 2026-09-23 report, at its root.
 *
 * Three refusals, each load-bearing:
 *
 * - **Not at the start of the block.** `A [ ] b` is prose about brackets,
 *   and GFM reads it as prose too.
 * - **Not in a list item's first block.** GFM's task marker is a property
 *   of the item, not of any paragraph inside it, so `- a\n\n  [ ] b` is
 *   text in both the pipeline and here.
 * - **Not on an item that is already a task.** `- [ ] [x] a` types the
 *   second pair as text, which is what it is.
 *
 * `X` is accepted as well as `x` because GFM accepts it; `canonicalise()`
 * writes `[x]` either way (`packages/markdown`'s pinned spelling), and so
 * does this rule, since it stores a boolean rather than the typed letter.
 */
function taskItemInputRule(regexp: RegExp, listItem: NodeType): InputRule {
  return new InputRule(regexp, (state: EditorState, match: RegExpMatchArray, start: number, end: number): Transaction | null => {
    const box = match[1];
    if (box === undefined) return null;

    const $start = state.doc.resolve(start);
    if ($start.parentOffset !== 0) return null;
    const itemDepth = $start.depth - 1;
    if (itemDepth < 1) return null;
    if ($start.node(itemDepth).type !== listItem) return null;
    if ($start.index(itemDepth) !== 0) return null;
    const item = $start.node(itemDepth);
    if (item.attrs.checked !== null) return null;

    return state.tr
      .delete(start, end)
      .setNodeMarkup($start.before(itemDepth), undefined, { ...item.attrs, checked: box !== ' ' });
  });
}

/**
 * The capture group of a mark rule: one or more characters that are not
 * the marker character, neither beginning nor ending with whitespace.
 * `marker` is one of `*`, `_`, `~`, `` ` `` — none needs escaping inside
 * a character class.
 */
function inner(marker: string): string {
  return `([^${marker}\\s][^${marker}]*[^${marker}\\s]|[^${marker}\\s])`;
}

export function buildInputRules(schema: Schema): InputRule[] {
  const heading = schema.nodes.heading as NodeType;
  const blockquote = schema.nodes.blockquote as NodeType;
  const list = schema.nodes.list as NodeType;
  const listItem = schema.nodes.listItem as NodeType;

  return [
    textblockTypeInputRule(/^(#{1,6})\s$/, heading, (match) => ({ level: match[1]!.length })),
    wrappingInputRule(/^\s*>\s$/, blockquote),
    wrappingInputRule(/^\s*[-+]\s$/, list, () => ({ ordered: false })),
    wrappingInputRule(/^(\d+)\.\s$/, list, (match) => ({ ordered: true, start: Number(match[1]) })),
    // After the bullet/ordered rules, because it acts on the item one of
    // them has just created — see `taskItemInputRule`.
    taskItemInputRule(/^\[([ xX])\]\s$/, listItem),
    // The double markers before the single ones: `[^*]+` / `[^_]+` keep a
    // single-marker rule from claiming half of a double one (`**bold*`),
    // and the order keeps the whole `**bold**` from being read as `*` +
    // `*bold*` + `*` when both could match.
    // `${inner('*')}` and its kin: the content may not begin or end with
    // whitespace. The pipeline reads `** bar **` as text (a marker beside
    // a space is not flanking), so a mark applied there would be written
    // as `__ bar __`, read back as text, and refused on the next open.
    markInputRule(new RegExp(`(?:^|\\s)\\*\\*${inner('*')}\\*\\*$`), schema.marks.strong!),
    markInputRule(new RegExp(`(?:^|\\s)__${inner('_')}__$`), schema.marks.strong!),
    markInputRule(new RegExp(`(?:^|\\s)_${inner('_')}_$`), schema.marks.emphasis!),
    markInputRule(new RegExp(`(?:^|\\s)\\*${inner('*')}\\*$`), schema.marks.emphasis!),
    markInputRule(new RegExp(`(?:^|\\s)~~${inner('~')}~~$`), schema.marks.delete!),
    markInputRule(new RegExp(`(?:^|\\s)\`${inner('`')}\`$`), schema.marks.inlineCode!),
    linkInputRule(/\[([^\]]+)\]\(([^\s()]+)\)$/, schema.marks.link!),
    bareUrlInputRule(/(?:^|\s)(https?:\/\/[^\s<>]+)\s$/, schema.marks.link!),
  ];
}
