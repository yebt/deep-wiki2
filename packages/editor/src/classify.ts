import type { Schema } from 'prosemirror-model';

/**
 * mdast node types carried verbatim as an opaque atom rather than modelled
 * directly (design.md bucket B): raw/inline HTML, images (resource and
 * reference alike — SPECS §5.1's Verbatim row), reference-style links
 * (which need their paired `definition` to resolve), and YAML frontmatter.
 * None of these are ProseMirror node names — `classify()` checks the schema
 * first, so this list only matters for a type the schema does not already
 * claim.
 *
 * Kept deliberately in step with `from-markdown.ts`'s
 * `VERBATIM_BLOCK_TYPES`/`VERBATIM_INLINE_TYPES`: a type this file calls
 * verbatim that the converter refuses would classify a page as openable
 * that edit mode then rejects.
 */
const VERBATIM_TYPES = new Set(['html', 'definition', 'image', 'linkReference', 'imageReference', 'yaml']);

export type Classification =
  | { bucket: 'modelled' }
  | { bucket: 'verbatim'; carriedType: string }
  | { bucket: 'refused'; reasonCode: string; nodeType: string };

interface TreeLike {
  type: string;
  children?: TreeLike[];
}

function walk(node: TreeLike, visitor: (node: TreeLike) => boolean | undefined): boolean {
  if (visitor(node) === false) return false;
  if (!node.children) return true;
  for (const child of node.children) {
    if (!walk(child, visitor)) return false;
  }
  return true;
}

/**
 * Walks an mdast tree and asks `schema` whether it names each node type
 * (design.md D5 — "classify() derives its verdict from the schema"). A type
 * the schema names as a node OR a mark is bucket A. A type in
 * `VERBATIM_TYPES` is bucket B. Anything else is refused, naming the
 * offending type as its reason. Moving a node into or out of `schema`
 * therefore moves the verdict without this function changing at all.
 */
export function classify(tree: TreeLike, schema: Schema): Classification {
  let verbatimType: string | undefined;
  let refused: { reasonCode: string; nodeType: string } | undefined;

  walk(tree, (node) => {
    if (node.type === 'root') return true;
    if (schema.nodes[node.type] || schema.marks[node.type]) return true;
    if (VERBATIM_TYPES.has(node.type)) {
      verbatimType ??= node.type;
      return true;
    }
    refused = { reasonCode: `unsupported_construct:${node.type}`, nodeType: node.type };
    return false; // first refusal wins; stop walking
  });

  if (refused) return { bucket: 'refused', ...refused };
  if (verbatimType) return { bucket: 'verbatim', carriedType: verbatimType };
  return { bucket: 'modelled' };
}
