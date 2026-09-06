import { stringify } from '@deep-wiki/markdown';
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

/**
 * Converts a PM inline fragment (a paragraph's, heading's or table cell's
 * content) into mdast phrasing nodes, merging adjacent runs that share a
 * mark into one wrapper instead of giving each run its own — otherwise
 * `strong(text, [strong])` next to `strong+emphasis(text, [strong,
 * emphasis])` next to `strong(text, [strong])` would each close and reopen
 * `strong` around the middle run instead of nesting `emphasis` inside one
 * continuous `strong`. Mirrors how a DOM/HTML serialiser merges adjacent
 * marked runs, applied to mdast's node-per-mark tree shape instead.
 */
function convertInline(node: PMNode): PhrasingContent[] {
  const root: PhrasingContent[] = [];
  const stack: OpenWrap[] = [];

  const currentChildren = (): PhrasingContent[] => (stack.length === 0 ? root : stack[stack.length - 1]!.children);

  node.forEach((child) => {
    const wrappingMarks = child.isText ? child.marks.filter((mark) => mark.type.name !== 'inlineCode') : [];

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

class ToMarkdownConverter {
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
      case 'blockquote': {
        const children: BlockContent[] = [];
        node.forEach((child) => children.push(this.convertBlock(child) as BlockContent));
        return { type: 'blockquote', children: withBlockAnchor(children, blockAnchor) } as BlockContent;
      }
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
      case 'listItem': {
        const children: BlockContent[] = [];
        node.forEach((child) => children.push(this.convertBlock(child) as BlockContent));
        return {
          type: 'listItem',
          spread: false,
          children: withBlockAnchor(children, blockAnchor),
        } as unknown as DefinitionContent;
      }
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
      case 'footnoteDefinition': {
        const children: BlockContent[] = [];
        node.forEach((child) => children.push(this.convertBlock(child) as BlockContent));
        return {
          type: 'footnoteDefinition',
          identifier: node.attrs.identifier,
          children: withBlockAnchor(children, blockAnchor),
        } as unknown as BlockContent;
      }
      case 'verbatim':
        return { type: 'verbatim', raw: node.attrs.raw } as unknown as BlockContent;
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
