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
 */

const blockAnchorAttr = { blockAnchor: { default: null as string | null } };

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  // --- Bucket A: block nodes -------------------------------------------
  paragraph: {
    content: 'inline*',
    group: 'block',
    attrs: blockAnchorAttr,
  },
  heading: {
    content: 'inline*',
    group: 'block',
    attrs: { level: { default: 1 }, ...blockAnchorAttr },
  },
  blockquote: {
    content: 'block+',
    group: 'block',
    attrs: blockAnchorAttr,
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
  },
  listItem: {
    content: 'block+',
    attrs: blockAnchorAttr,
  },
  code: {
    content: 'text*',
    marks: '',
    code: true,
    group: 'block',
    attrs: { lang: { default: null as string | null }, meta: { default: null as string | null }, ...blockAnchorAttr },
  },
  thematicBreak: {
    group: 'block',
    attrs: blockAnchorAttr,
  },
  table: {
    content: 'tableRow+',
    group: 'block',
    attrs: blockAnchorAttr,
  },
  tableRow: {
    content: 'tableCell+',
  },
  tableCell: {
    content: 'inline*',
    attrs: { align: { default: null as 'left' | 'right' | 'center' | null } },
  },
  footnoteDefinition: {
    content: 'block+',
    group: 'block',
    attrs: { identifier: { default: '' }, ...blockAnchorAttr },
  },

  // --- Bucket A: inline nodes --------------------------------------------
  text: { group: 'inline' },
  break: { inline: true, group: 'inline' },
  footnoteReference: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { identifier: { default: '' } },
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
  },
  tag: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { name: { default: '' } },
  },

  // --- Bucket B: carried verbatim ----------------------------------------
  // `raw` holds the literal source slice; a stored literal is stable under
  // every edit elsewhere in the document, unlike an offset into the
  // original buffer (design.md "Why raw is a string and not source
  // offsets"). `selectable: true` + `atom: true` + no `contentEditable`
  // (enforced at the view layer, WU-16) — the node itself is opaque.
  verbatim: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { raw: { default: '' }, nodeType: { default: '' }, ...blockAnchorAttr },
  },
  verbatimInline: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { raw: { default: '' }, nodeType: { default: '' } },
  },
};

const marks: Record<string, MarkSpec> = {
  emphasis: {},
  strong: {},
  delete: {},
  inlineCode: {},
  link: {
    attrs: { href: { default: '' }, title: { default: null as string | null } },
  },
};

export const schema = new Schema({ nodes, marks });
