import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';

/**
 * The real ProseMirror schema (design.md "The ProseMirror schema and the
 * three buckets"). No Milkdown import — this is the root `"."` export;
 * Milkdown wiring lives only behind `"./mount"` (D13).
 *
 * `blockAnchor` is a **block attribute**, not a node — at the mdast layer
 * (`packages/markdown/src/extensions/block-anchor.ts`) it is its own node
 * because the extension is tested independently there; here it folds onto
 * whichever block it anchors, exactly as design.md's schema table states.
 *
 * `toDOM` on every node/mark below is additive, WU-16 work: GATE-2
 * (`round-trip.test.ts`) exercises `fromMarkdown`/`toMarkdown` only and
 * never touches DOM serialization, so adding it does not change any
 * property that suite verifies. It exists because `prosemirror-view`
 * (behind `"./mount"`, never imported here) requires every node/mark it
 * renders to have one — without it, mounting a real `EditorView` throws
 * `node.type.spec.toDOM is not a function` the first time it encounters
 * a node this schema names. `parseDOM` is deliberately omitted for now:
 * nothing in this batch pastes rich HTML into the editor, and adding
 * paste-parsing rules without a fixture proving they round-trip would be
 * exactly the untested promise design.md's own bucket model argues
 * against.
 */

const blockAnchorAttr = { blockAnchor: { default: null as string | null } };

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  // --- Bucket A: block nodes -------------------------------------------
  paragraph: {
    content: 'inline*',
    group: 'block',
    attrs: blockAnchorAttr,
    toDOM: () => ['p', 0],
  },
  heading: {
    content: 'inline*',
    group: 'block',
    attrs: { level: { default: 1 }, ...blockAnchorAttr },
    toDOM: (node) => [`h${node.attrs.level}`, 0],
  },
  blockquote: {
    content: 'block+',
    group: 'block',
    attrs: blockAnchorAttr,
    toDOM: () => ['blockquote', 0],
  },
  list: {
    content: 'listItem+',
    group: 'block',
    attrs: {
      ordered: { default: false },
      start: { default: 1 },
      spread: { default: false },
      bulletChar: { default: null as string | null },
      ...blockAnchorAttr,
    },
    toDOM: (node) => (node.attrs.ordered ? ['ol', { start: node.attrs.start !== 1 ? node.attrs.start : null }, 0] : ['ul', 0]),
  },
  // `checked` carries GFM's task-list state (`- [ ]` / `- [x]`); `null`
  // means "not a task item at all", which is what distinguishes `- item`
  // from `- [ ] item`. `spread` is the ITEM's own looseness, distinct from
  // the list's: `mdast-util-to-markdown` joins a list item's children with
  // a blank line only when the item is spread, so dropping it turns
  // `- text\n\n  > quote` into `- text\n  > quote` — different bytes for
  // canonical input. (A paragraph followed by another paragraph survives
  // either way, which is why the looser `list-loose.md` fixture never
  // caught this.)
  listItem: {
    content: 'block+',
    attrs: { checked: { default: null as boolean | null }, spread: { default: false }, ...blockAnchorAttr },
    toDOM: (node) => ['li', node.attrs.checked === null ? {} : { 'data-checked': String(node.attrs.checked) }, 0],
  },
  code: {
    content: 'text*',
    marks: '',
    code: true,
    group: 'block',
    attrs: { lang: { default: null as string | null }, meta: { default: null as string | null }, ...blockAnchorAttr },
    toDOM: () => ['pre', ['code', 0]],
  },
  thematicBreak: {
    group: 'block',
    attrs: blockAnchorAttr,
    toDOM: () => ['hr'],
  },
  table: {
    content: 'tableRow+',
    group: 'block',
    attrs: blockAnchorAttr,
    toDOM: () => ['table', ['tbody', 0]],
  },
  tableRow: {
    content: 'tableCell+',
    toDOM: () => ['tr', 0],
  },
  tableCell: {
    content: 'inline*',
    attrs: { align: { default: null as 'left' | 'right' | 'center' | null } },
    toDOM: (node) => ['td', node.attrs.align ? { style: `text-align: ${node.attrs.align}` } : {}, 0],
  },
  footnoteDefinition: {
    content: 'block+',
    group: 'block',
    attrs: { identifier: { default: '' }, ...blockAnchorAttr },
    toDOM: (node) => ['div', { class: 'footnote-definition', 'data-identifier': node.attrs.identifier }, 0],
  },

  // --- Bucket A: inline nodes --------------------------------------------
  text: { group: 'inline' },
  break: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { spelling: { default: 'backslash' as 'space' | 'backslash' } },
    toDOM: () => ['br'],
  },
  footnoteReference: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { identifier: { default: '' } },
    toDOM: (node) => ['sup', { class: 'footnote-reference' }, `[${node.attrs.identifier}]`],
  },
  wikiLink: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: {
      raw: { default: '' },
      target: { default: '' },
      anchor: { default: null as string | null },
      alias: { default: null as string | null },
    },
    toDOM: (node) => ['a', { class: 'wiki-link', 'data-target': node.attrs.target }, node.attrs.alias || node.attrs.target],
  },
  tag: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { name: { default: '' } },
    toDOM: (node) => ['span', { class: 'tag' }, `#${node.attrs.name}`],
  },

  // --- Bucket B: carried verbatim ----------------------------------------
  // `raw` holds the literal source slice; a stored literal is stable under
  // every edit elsewhere in the document, unlike an offset into the
  // original buffer (design.md "Why raw is a string and not source
  // offsets"). `selectable: true` + `atom: true` + no `contentEditable`
  // (enforced at the view layer, WU-16) — the node itself is opaque.
  // `carried` holds the original mdast node (position-stripped) for a
  // carried type whose SPELLING is decided by its neighbours rather than
  // by its own bytes. Today that is `definition` and only `definition`:
  // `mdast-util-to-markdown` drops the blank line between two adjacent
  // `definition` nodes when `tightDefinitions` is pinned on, and that join
  // rule keys on the node's `type`. Re-emitting a definition as an opaque
  // `verbatim` node therefore made canonical `[a]: /a\n[b]: /b` come back
  // as `[a]: /a\n\n[b]: /b` — canonical Markdown that edit mode then
  // refused, while the NON-canonical spaced spelling round-tripped and was
  // accepted. `raw` stays authoritative for `html`/`yaml`, where no join
  // rule inspects the type and the literal bytes are the whole point.
  verbatim: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: {
      raw: { default: '' },
      nodeType: { default: '' },
      carried: { default: null as Record<string, unknown> | null },
      ...blockAnchorAttr,
    },
    toDOM: (node) => ['div', { class: 'verbatim', contenteditable: 'false' }, node.attrs.raw],
  },
  verbatimInline: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { raw: { default: '' }, nodeType: { default: '' } },
    toDOM: (node) => ['span', { class: 'verbatim-inline', contenteditable: 'false' }, node.attrs.raw],
  },
};

/**
 * Declaration order fixes each mark's rank in ProseMirror's internal mark
 * set (`Mark.addToSet` always sorts by rank, regardless of application
 * order). `to-markdown.ts` does NOT treat that rank as the wrapping order:
 * it orders a run's marks by *extent* (`orderMarksByExtent`), so `_italic
 * with __nested bold__ text_` and `__bold with _nested italic_ text__` both
 * round-trip, and so does the document the editor itself builds when a
 * user bolds one word inside an italic run (docs/TODO.md, 2026-09-14).
 *
 * **Known limitation, narrowed.** A ProseMirror mark is a *set* over a
 * text range, not a nested stack — it has no memory of which of two marks
 * covering *exactly the same run* was written as the outer one. Rank is
 * the tiebreak there: `strong` before `link` means `__[a](b)__` opens and
 * `[__a__](b)` is refused by the probe. That is fail-closed on a document
 * written outside the editor, never corruption of one written inside it —
 * whichever spelling the editor emits re-parses to the same mark set. It
 * is the same residual limitation `prosemirror-markdown` has for the
 * identical reason.
 */
const marks: Record<string, MarkSpec> = {
  strong: { toDOM: () => ['strong', 0] },
  emphasis: { toDOM: () => ['em', 0] },
  delete: { toDOM: () => ['del', 0] },
  inlineCode: { toDOM: () => ['code', 0] },
  link: {
    attrs: { href: { default: '' }, title: { default: null as string | null } },
    toDOM: (mark) => ['a', { href: mark.attrs.href, title: mark.attrs.title }, 0],
  },
};

export const schema = new Schema({ nodes, marks });
