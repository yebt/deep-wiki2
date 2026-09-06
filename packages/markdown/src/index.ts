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

/**
 * Every `remark-stringify` option that decides a *spelling* rather than a
 * *meaning* (design.md "The pinned-options rule, made mechanical"; docs/TODO.md
 * 2026-09-04 finding). Two kinds of entry live here, and both matter:
 *
 * - **Efficacious** pins (`bullet`, `emphasis`, `strong`, `resourceLink`,
 *   `tightDefinitions`): the pinned value differs from remark's own default,
 *   so removing the key changes the serialised bytes. `bullet`'s efficacy is
 *   asserted by an executable test (`canonical.test.ts`); the fixture per key
 *   documents the rest.
 * - **Defensive** pins (`bulletOrdered`, `fence`, `fences`, `listItemIndent`,
 *   `rule`, `setext`): the pinned value already matches remark's default,
 *   chosen deliberately over an efficacious-but-unconventional alternative
 *   (e.g. `)`-style ordered lists, tab-padded bullets) to keep this
 *   product's canonical Markdown unsurprising to the humans who read it.
 *   They are pinned anyway so a future remark upgrade that changes its
 *   default cannot silently change this pipeline's canonical spelling out
 *   from under a fixture.
 *
 * `fixtures/pins/pin-<key>.md` must exist for every key here — see the pin
 * coverage test, which reads these keys rather than a hardcoded list so it
 * cannot drift.
 */
export const PINNED_OPTIONS = {
  bullet: '-',
  bulletOrdered: '.',
  emphasis: '_',
  fence: '`',
  fences: true,
  listItemIndent: 'one',
  resourceLink: true,
  rule: '*',
  setext: false,
  strong: '_',
  tightDefinitions: true,
} as const;

const parseProcessor = unified().use(remarkParse);
const stringifyProcessor = unified().use(remarkStringify, PINNED_OPTIONS);

/** Parses Markdown source into an mdast syntax tree. */
export function parse(markdown: string): Root {
  return parseProcessor.parse(markdown) as Root;
}

/** Serializes an mdast syntax tree back into Markdown source. */
export function stringify(tree: Root): string {
  return stringifyProcessor.stringify(tree);
}

/**
 * The canonical form of a Markdown document under this pipeline's pinned
 * spelling (design.md "The canonical-form invariant", D1). Idempotent by
 * construction: `canonicalise(canonicalise(x)) === canonicalise(x)` for any
 * input, which is what `savePage()` will later assert to reject a
 * non-canonical write.
 */
export function canonicalise(markdown: string): string {
  return stringify(parse(markdown));
}
