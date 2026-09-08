// Imports the crypto-free "./pipeline" subpath, not the package root: the
// root barrel also re-exports block-index.ts/match-blocks.ts, both of
// which import node:crypto — fine for packages/db and apps/api (server
// only), fatal for apps/web's edit route, which imports this module
// directly in the browser (see packages/markdown/src/pipeline.ts).
import { parse, type ParseOptions } from '@deep-wiki/markdown/pipeline';
import type {
  BlockContent,
  Code,
  DefinitionContent,
  Heading,
  List,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from 'mdast';
import { Node as PMNode, type Mark } from 'prosemirror-model';
import { schema as defaultSchema } from './schema';
import type { Schema } from 'prosemirror-model';

/** mdast node types carried verbatim as an opaque block atom (design.md bucket B, block-level members). */
const VERBATIM_BLOCK_TYPES = new Set(['html', 'definition', 'yaml']);
/** mdast node types carried verbatim as an opaque inline atom (design.md bucket B, inline-level members). */
const VERBATIM_INLINE_TYPES = new Set(['html', 'linkReference', 'imageReference']);

/**
 * A construct neither bucket A nor bucket B names (design.md bucket C).
 * Carries the offending node's type and source line so `probe.ts` — and,
 * through it, the edit-session route's 409 body (WU-12) — can name both
 * without re-parsing the document to find them again. Reachable only by a
 * future remark upgrade adding a node type this pipeline does not yet
 * claim; today's `refused/` corpus fails via `not_byte_identical` instead.
 */
export class UnsupportedConstructError extends Error {
  constructor(
    readonly construct: string,
    readonly line: number | undefined,
    kind: 'block' | 'inline',
  ) {
    super(`fromMarkdown: unsupported ${kind} node type "${construct}"`);
    this.name = 'UnsupportedConstructError';
  }
}

function sourceSliceOf(
  node: { position?: { start: { offset?: number }; end: { offset?: number } } },
  source: string,
) {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start !== undefined && end !== undefined ? source.slice(start, end) : '';
}

/**
 * mdast types whose canonical spelling is decided by a `join` rule keyed on
 * the node's own `type` rather than by its literal bytes, so re-emitting
 * them as an opaque `verbatim` node changes the output. `definition` is the
 * only member: `tightDefinitions` (a PINNED_OPTIONS key) removes the blank
 * line between two adjacent `definition` nodes, and that rule cannot see a
 * `verbatim` node. See the `verbatim` node's comment in schema.ts.
 */
const JOIN_SENSITIVE_VERBATIM_TYPES = new Set(['definition']);

/** A structured-clone of `node` with every `position` field removed, so it can live in a ProseMirror attribute (which must be plain, comparable data). */
function withoutPosition<T>(node: T): T {
  const clone = structuredClone(node) as unknown;
  const strip = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(strip);
      return;
    }
    if (!value || typeof value !== 'object') return;
    delete (value as { position?: unknown }).position;
    Object.values(value).forEach(strip);
  };
  strip(clone);
  return clone as T;
}

/** Splits a trailing `blockAnchor` mdast node off a block's own children, returning the anchor id (or `null`) and the remaining content. */
function splitOffBlockAnchor<T extends BlockContent | DefinitionContent | PhrasingContent>(
  children: T[],
): { content: T[]; blockAnchor: string | null } {
  const last = children[children.length - 1];
  if (last && (last as { type: string }).type === 'blockAnchor') {
    return { content: children.slice(0, -1), blockAnchor: (last as unknown as { id: string }).id };
  }
  return { content: children, blockAnchor: null };
}

class FromMarkdownConverter {
  constructor(
    private readonly schema: Schema,
    private readonly source: string,
  ) {}

  convertRoot(root: Root): PMNode {
    return this.schema.node(
      'doc',
      null,
      root.children.map((child) => this.convertBlock(child)),
    );
  }

  private convertInline(nodes: PhrasingContent[], marks: readonly Mark[] = []): PMNode[] {
    const result: PMNode[] = [];
    for (const node of nodes) {
      result.push(...this.convertInlineNode(node, marks));
    }
    return result;
  }

  private convertInlineNode(node: PhrasingContent, marks: readonly Mark[]): PMNode[] {
    const s = this.schema;
    switch (node.type) {
      case 'text':
        return node.value.length === 0 ? [] : [s.text(node.value, marks as Mark[])];
      case 'break':
        return [s.node('break', { spelling: (node.data as { spelling?: string } | undefined)?.spelling ?? 'backslash' })];
      case 'emphasis':
        return this.convertInline(node.children, [...marks, s.mark('emphasis')]);
      case 'strong':
        return this.convertInline(node.children, [...marks, s.mark('strong')]);
      case 'delete':
        return this.convertInline(node.children, [...marks, s.mark('delete')]);
      case 'inlineCode':
        return [s.text(node.value, [...marks, s.mark('inlineCode')] as Mark[])];
      case 'link':
        return this.convertInline(node.children, [
          ...marks,
          s.mark('link', { href: node.url, title: node.title ?? null }),
        ]);
      case 'wikiLink':
        return [
          s.node('wikiLink', {
            raw: node.raw,
            target: node.target,
            anchor: node.anchor ?? null,
            alias: node.alias ?? null,
          }),
        ];
      case 'tag':
        return [s.node('tag', { name: node.name })];
      case 'footnoteReference':
        return [s.node('footnoteReference', { identifier: node.identifier })];
      default:
        if (VERBATIM_INLINE_TYPES.has(node.type)) {
          return [s.node('verbatimInline', { raw: sourceSliceOf(node, this.source), nodeType: node.type })];
        }
        throw new UnsupportedConstructError(node.type, node.position?.start.line, 'inline');
    }
  }

  private convertBlock(node: RootContent): PMNode {
    const s = this.schema;

    switch (node.type) {
      case 'paragraph': {
        const { content, blockAnchor } = splitOffBlockAnchor(node.children);
        return s.node('paragraph', { blockAnchor }, this.convertInline(content));
      }
      case 'heading': {
        const heading = node as Heading;
        const { content, blockAnchor } = splitOffBlockAnchor(heading.children);
        return s.node('heading', { level: heading.depth, blockAnchor }, this.convertInline(content));
      }
      case 'blockquote': {
        const { content, blockAnchor } = splitOffBlockAnchor(node.children);
        return s.node(
          'blockquote',
          { blockAnchor },
          content.map((child) => this.convertBlock(child)),
        );
      }
      case 'list': {
        const list = node as List;
        const bulletChar = (list.data as { bulletChar?: string } | undefined)?.bulletChar ?? null;
        return s.node(
          'list',
          {
            ordered: list.ordered ?? false,
            start: list.start ?? 1,
            spread: list.spread ?? false,
            bulletChar,
          },
          list.children.map((child) => this.convertBlock(child)),
        );
      }
      case 'listItem': {
        const { content, blockAnchor } = splitOffBlockAnchor(node.children);
        return s.node(
          'listItem',
          { checked: node.checked ?? null, spread: node.spread ?? false, blockAnchor },
          content.map((child) => this.convertBlock(child)),
        );
      }
      case 'code': {
        const code = node as Code;
        return s.node(
          'code',
          { lang: code.lang ?? null, meta: code.meta ?? null, blockAnchor: null },
          code.value.length === 0 ? [] : [s.text(code.value)],
        );
      }
      case 'thematicBreak':
        return s.node('thematicBreak', { blockAnchor: null });
      case 'table': {
        const table = node as Table;
        const align = table.align ?? [];
        return s.node(
          'table',
          { blockAnchor: null },
          table.children.map((row) =>
            s.node(
              'tableRow',
              null,
              row.children.map((cell, columnIndex) =>
                s.node('tableCell', { align: align[columnIndex] ?? null }, this.convertInline(cell.children)),
              ),
            ),
          ),
        );
      }
      case 'footnoteDefinition': {
        const { content, blockAnchor } = splitOffBlockAnchor(node.children);
        return s.node(
          'footnoteDefinition',
          { identifier: node.identifier, blockAnchor },
          content.map((child) => this.convertBlock(child)),
        );
      }
      default:
        if (VERBATIM_BLOCK_TYPES.has(node.type)) {
          return s.node('verbatim', {
            raw: sourceSliceOf(node, this.source),
            nodeType: node.type,
            carried: JOIN_SENSITIVE_VERBATIM_TYPES.has(node.type) ? withoutPosition(node) : null,
            blockAnchor: null,
          });
        }
        throw new UnsupportedConstructError(node.type, node.position?.start.line, 'block');
    }
  }
}

/**
 * Converts canonical Markdown into a ProseMirror document, reusing
 * `packages/markdown`'s `parse()` for the Markdown-side work
 * (markdown-round-trip: Round Trip Exercises The ProseMirror Schema).
 */
export function fromMarkdown(markdown: string, options: ParseOptions & { schema?: Schema } = {}): PMNode {
  const tree = parse(markdown, options);
  return new FromMarkdownConverter(options.schema ?? defaultSchema, markdown).convertRoot(tree);
}
