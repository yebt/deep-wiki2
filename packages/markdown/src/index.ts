import type { Root } from 'mdast';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

/**
 * The single shared unified/remark pipeline (docs/SPECS.md §13, §14):
 * every consumer that needs to read or write Markdown — the editor, the
 * API, and later the indexer — goes through this package rather than
 * instantiating its own parser.
 */

const parseProcessor = unified().use(remarkParse);
const stringifyProcessor = unified().use(remarkStringify);

/** Parses Markdown source into an mdast syntax tree. */
export function parse(markdown: string): Root {
  return parseProcessor.parse(markdown) as Root;
}

/** Serializes an mdast syntax tree back into Markdown source. */
export function stringify(tree: Root): string {
  return stringifyProcessor.stringify(tree);
}
