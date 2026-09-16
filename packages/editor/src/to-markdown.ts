// See from-markdown.ts's same comment: "./pipeline" avoids the root
// barrel's transitive node:crypto import (block-index.ts/match-blocks.ts),
// which apps/web's edit route would otherwise load in the browser.
import { stringify } from '@deep-wiki/markdown/pipeline';
import type {
  BlockContent,
  DefinitionContent,
  PhrasingContent,
  Root,
  RootContent,
  TableCell,
  TableRow,
} from 'mdast';
import type { Mark, Node as PMNode } from 'prosemirror-model';

/** Appends a `blockAnchor` mdast node to `children` when `blockAnchor` names one. */
function withBlockAnchor<T extends BlockContent | DefinitionContent | PhrasingContent>(
  children: T[],
  blockAnchor: string | null,
): T[] {
  if (!blockAnchor) return children;
  return [...children, { type: 'blockAnchor', id: blockAnchor } as unknown as T];
}

/** The mdast wrapper node a given wrapping mark corresponds to (everything but `inlineCode`, which is a leaf transform, not a wrapper — see `convertLeaf`). */
function markWrapperShape(mark: Mark): Record<string, unknown> {
  if (mark.type.name === 'link') {
    return { type: 'link', url: mark.attrs.href as string, title: (mark.attrs.title as string | null) ?? null };
  }
  return { type: mark.type.name };
}

/** Whether two marks are the same wrapping construct (type and attrs), so adjacent runs can share one mdast wrapper node instead of each getting their own. */
function sameMark(a: Mark, b: Mark): boolean {
  return a.type === b.type && a.eq(b);
}

/**
 * A PM inline node's own leaf value, ignoring marks — the caller (the
 * mark-stack algorithm below) is responsible for wrapping this in whatever
 * mdast parent nodes the node's marks require.
 */
function convertLeaf(node: PMNode): PhrasingContent {
  if (node.isText) {
    const isCode = node.marks.some((mark) => mark.type.name === 'inlineCode');
    return (
      isCode ? { type: 'inlineCode', value: node.text ?? '' } : { type: 'text', value: node.text ?? '' }
    ) as PhrasingContent;
  }

  switch (node.type.name) {
    case 'break':
      return { type: 'break', data: { spelling: node.attrs.spelling } } as unknown as PhrasingContent;
    case 'wikiLink':
      return {
        type: 'wikiLink',
        raw: node.attrs.raw,
        target: node.attrs.target,
        anchor: node.attrs.anchor ?? undefined,
        alias: node.attrs.alias ?? undefined,
        children: [],
      } as unknown as PhrasingContent;
    case 'tag':
      return { type: 'tag', name: node.attrs.name, children: [] } as unknown as PhrasingContent;
    case 'footnoteReference':
      return { type: 'footnoteReference', identifier: node.attrs.identifier } as PhrasingContent;
    case 'verbatimInline':
      return { type: 'verbatimInline', raw: node.attrs.raw } as unknown as PhrasingContent;
    default:
      throw new Error(`toMarkdown: unsupported inline node type "${node.type.name}"`);
  }
}

interface OpenWrap {
  mark: Mark;
  children: PhrasingContent[];
}

/** The half-open range of consecutive inline children, around `index`, that all carry a mark equal to `mark`. */
function runOf(marksPerChild: readonly (readonly Mark[])[], index: number, mark: Mark): { start: number; end: number } {
  let start = index;
  while (start > 0 && marksPerChild[start - 1]!.some((candidate) => sameMark(candidate, mark))) start--;
  let end = index + 1;
  while (end < marksPerChild.length && marksPerChild[end]!.some((candidate) => sameMark(candidate, mark))) end++;
  return { start, end };
}

/**
 * Orders one inline child's marks outermost-first, by the **extent** of the
 * run each mark covers: the mark that starts earliest wins, and on a tie the
 * one that reaches furthest.
 *
 * This is the whole fix for the save direction, and it exists because a
 * ProseMirror mark set is *sorted by declaration rank*, not by nesting.
 * `_x y z_` with `y` bolded holds three text nodes — `x ` marked
 * `{emphasis}`, `y` marked `{strong, emphasis}`, ` z` marked `{emphasis}` —
 * and `strong` is declared before `emphasis`, so the middle node's set reads
 * `[strong, emphasis]` while its neighbours' read `[emphasis]`. Matching
 * those two as a common *prefix* finds nothing in common, so `emphasis` was
 * closed and reopened around the bolded word: three sibling wrappers where
 * the user made one continuous italic run. `mdast-util-to-markdown` then did
 * exactly what that tree asked for — an `emphasis` ending in a space cannot
 * carry a right-flanking `_`, so the space became `&#x20;`, and two adjacent
 * `_`-delimited wrappers had to grow their delimiter runs apart from each
 * other — producing `_x&#x20;____y____&#x20;z_`, which is no longer the
 * document and no longer re-openable.
 *
 * Extent order reconstructs the nesting the mark set threw away: `emphasis`
 * spans all three children and `strong` only the middle one, so `emphasis`
 * is the outer wrapper and the prefix match succeeds for every child.
 *
 * **What this still cannot decide.** Two marks covering *exactly* the same
 * run are genuinely ambiguous — `__[a](b)__` and `[__a__](b)` are the same
 * mark set and only one spelling can come back. `own` arrives in declaration
 * rank order and `Array.prototype.sort` is stable, so rank remains the
 * tiebreak there and `strong` stays outside `link`. That is a document the
 * probe refuses to open (fail-closed, no byte is rewritten), not a document
 * the editor corrupts: whichever spelling this emits re-parses to the same
 * mark set and re-serialises identically.
 */
function orderMarksByExtent(marksPerChild: readonly (readonly Mark[])[], index: number): readonly Mark[] {
  const own = marksPerChild[index]!;
  if (own.length < 2) return own;

  const runs = new Map<Mark, { start: number; end: number }>();
  for (const mark of own) runs.set(mark, runOf(marksPerChild, index, mark));

  return [...own].sort((a, b) => {
    const first = runs.get(a)!;
    const second = runs.get(b)!;
    return first.start - second.start || second.end - first.end;
  });
}

/**
 * Converts a PM inline fragment (a paragraph's, heading's or table cell's
 * content) into mdast phrasing nodes, merging adjacent runs that share a
 * mark into one wrapper instead of giving each run its own — otherwise
 * `strong(text, [strong])` next to `strong+emphasis(text, [strong,
 * emphasis])` next to `strong(text, [strong])` would each close and reopen
 * `strong` around the middle run instead of nesting `emphasis` inside one
 * continuous `strong`. Mirrors how a DOM/HTML serialiser merges adjacent
 * marked runs, applied to mdast's node-per-mark tree shape instead.
 *
 * The merge is only as good as the order the marks are opened in, which is
 * what `orderMarksByExtent` decides — see its comment.
 */
function convertInline(node: PMNode): PhrasingContent[] {
  const root: PhrasingContent[] = [];
  const stack: OpenWrap[] = [];
  const children: PMNode[] = [];
  node.forEach((child) => children.push(child));

  // `inlineCode` is a leaf transform, not a wrapper (see `convertLeaf`).
  //
  // An inline ATOM's own marks count exactly as a text node's do. Reading
  // them as `[]` was the second half of the same corruption: `addMark` puts
  // `strong` on a `wikiLink`/`tag`/`break`/`verbatimInline` node just as it
  // does on the text either side of it, so bolding a line containing a
  // wiki-link is ONE strong run — but an atom reported as unmarked closed
  // that run and reopened it, and `__a __[[Page]]__ b__` came back with the
  // spaces entity-encoded and `#tag` mangled to `#ta&#x67;`.
  const marksPerChild: readonly Mark[][] = children.map((child) =>
    child.marks.filter((mark) => mark.type.name !== 'inlineCode'),
  );

  const currentChildren = (): PhrasingContent[] => (stack.length === 0 ? root : stack[stack.length - 1]!.children);

  children.forEach((child, index) => {
    const wrappingMarks = orderMarksByExtent(marksPerChild, index);

    let matchLength = 0;
    while (
      matchLength < stack.length &&
      matchLength < wrappingMarks.length &&
      sameMark(stack[matchLength]!.mark, wrappingMarks[matchLength]!)
    ) {
      matchLength++;
    }
    while (stack.length > matchLength) stack.pop();
    for (let i = matchLength; i < wrappingMarks.length; i++) {
      const mark = wrappingMarks[i]!;
      const wrapperNode = { ...markWrapperShape(mark), children: [] } as unknown as PhrasingContent & {
        children: PhrasingContent[];
      };
      currentChildren().push(wrapperNode);
      stack.push({ mark, children: wrapperNode.children });
    }

    currentChildren().push(convertLeaf(child));
  });

  return root;
}

/** True for the one empty paragraph `from-markdown.ts` puts in an empty container — see `convertContainerChildren` there. */
function isEmptyParagraph(node: PMNode): boolean {
  return node.type.name === 'paragraph' && node.content.size === 0 && !node.attrs.blockAnchor;
}

class ToMarkdownConverter {
  /**
   * A container's mdast children. A container holding only the empty
   * paragraph `from-markdown.ts` gave it goes back as ZERO children, which
   * is how `mdast-util-to-markdown` spells the canonical empty container:
   * `[^1]:` rather than `[^1]: ` (the empty paragraph costs a trailing
   * space there, which the save path then refuses as non-canonical).
   */
  private containerChildren(node: PMNode): BlockContent[] {
    if (node.childCount === 1 && isEmptyParagraph(node.child(0))) return [];
    const children: BlockContent[] = [];
    node.forEach((child) => children.push(this.convertBlock(child) as BlockContent));
    return children;
  }

  convertRoot(doc: PMNode): Root {
    const children: RootContent[] = [];
    doc.forEach((node) => children.push(this.convertBlock(node) as RootContent));
    return { type: 'root', children };
  }

  private convertBlock(node: PMNode): BlockContent | DefinitionContent {
    const blockAnchor = (node.attrs.blockAnchor as string | null | undefined) ?? null;

    switch (node.type.name) {
      case 'paragraph':
        return { type: 'paragraph', children: withBlockAnchor(convertInline(node), blockAnchor) };
      case 'heading':
        return {
          type: 'heading',
          depth: node.attrs.level,
          children: withBlockAnchor(convertInline(node), blockAnchor),
        } as BlockContent;
      case 'blockquote':
        return { type: 'blockquote', children: withBlockAnchor(this.containerChildren(node), blockAnchor) } as BlockContent;
      case 'list': {
        const children: DefinitionContent[] = [];
        node.forEach((child) => children.push(this.convertBlock(child) as DefinitionContent));
        return {
          type: 'list',
          ordered: node.attrs.ordered,
          start: node.attrs.ordered ? node.attrs.start : null,
          spread: node.attrs.spread,
          data: node.attrs.bulletChar ? { bulletChar: node.attrs.bulletChar } : undefined,
          children,
        } as unknown as BlockContent;
      }
      case 'listItem':
        return {
          type: 'listItem',
          checked: node.attrs.checked,
          spread: node.attrs.spread,
          children: withBlockAnchor(this.containerChildren(node), blockAnchor),
        } as unknown as DefinitionContent;
      case 'code':
        return {
          type: 'code',
          lang: node.attrs.lang,
          meta: node.attrs.meta,
          value: node.textContent,
        } as BlockContent;
      case 'thematicBreak':
        return { type: 'thematicBreak' } as BlockContent;
      case 'table': {
        const rows: TableRow[] = [];
        const align: (string | null)[] = [];
        node.forEach((rowNode) => {
          const cells: TableCell[] = [];
          rowNode.forEach((cellNode, _offset, cellIndex) => {
            if (align[cellIndex] === undefined) align[cellIndex] = (cellNode.attrs.align as string | null) ?? null;
            cells.push({ type: 'tableCell', children: convertInline(cellNode) } as TableCell);
          });
          rows.push({ type: 'tableRow', children: cells } as TableRow);
        });
        return { type: 'table', align, children: rows } as unknown as BlockContent;
      }
      case 'footnoteDefinition':
        return {
          type: 'footnoteDefinition',
          identifier: node.attrs.identifier,
          children: withBlockAnchor(this.containerChildren(node), blockAnchor),
        } as unknown as BlockContent;
      case 'verbatim': {
        // A join-sensitive carried type (today: `definition`) is re-emitted
        // as its own mdast node so `mdast-util-to-markdown`'s type-keyed
        // join rules — `tightDefinitions` above all — still see it. Every
        // other carried type goes back as its literal bytes. See the
        // `verbatim` node's comment in schema.ts.
        // Cloned, not handed out directly: `toMdast()` is exported, and a
        // caller mutating the tree must not reach back into the PM node's
        // attributes.
        const carried = node.attrs.carried as BlockContent | null;
        if (carried) return structuredClone(carried);
        return { type: 'verbatim', raw: node.attrs.raw } as unknown as BlockContent;
      }
      default:
        throw new Error(`toMarkdown: unsupported block node type "${node.type.name}"`);
    }
  }
}

/**
 * Converts a ProseMirror document into the mdast tree `toMarkdown` would
 * stringify. Exported separately so tests can apply an alternate
 * `stringify` configuration to the exact tree the editor's own conversion
 * produces (round-trip.test.ts's pin-removal regression), rather than only
 * to a tree built directly by `packages/markdown`'s `parse()`.
 */
export function toMdast(doc: PMNode): Root {
  return new ToMarkdownConverter().convertRoot(doc);
}

/**
 * Converts a ProseMirror document back into Markdown, reusing
 * `packages/markdown`'s `stringify()` for the Markdown-side work
 * (markdown-round-trip: Round Trip Exercises The ProseMirror Schema).
 */
export function toMarkdown(doc: PMNode): string {
  return stringify(toMdast(doc));
}
