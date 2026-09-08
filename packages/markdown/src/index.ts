/**
 * The single shared unified/remark pipeline (docs/SPECS.md §13, §14):
 * every consumer that needs to read or write Markdown — the editor, the
 * API, and later the indexer — goes through this package rather than
 * instantiating its own parser.
 *
 * The actual parse/stringify/canonicalise implementation lives in
 * `./pipeline` (also its own package export, `"./pipeline"`) — see that
 * file's doc comment for why: `block-index.ts`/`match-blocks.ts` import
 * `node:crypto`, which has no browser build, and a single shared barrel
 * file makes that reachable from anything that imports even one
 * unrelated export from it under an unbundled dev server. This file
 * re-exports everything for server-side consumers (`packages/db`,
 * `apps/api`), unchanged.
 */
export { collectWikiLinks } from './extensions/wiki-link';
export type { CollectedWikiLink, WikiLinkNode, WikiLinkResolver, WikiLinkTarget } from './extensions/wiki-link';
export { collectTags } from './extensions/tag';
export type { TagNode } from './extensions/tag';
export type { BlockAnchorNode } from './extensions/block-anchor';
export type { VerbatimInlineNode, VerbatimNode } from './extensions/verbatim';
export { buildBlockIndex } from './block-index';
export type { BlockIndex, BlockIndexEntry } from './block-index';
export { sliceBlocks } from './blocks';
export type { BlockSlice } from './blocks';
export { chunk } from './chunk';
export type { Chunk, ChunkOptions } from './chunk';
export { deriveBlockId, matchBlocks, mintBlockId, MATCH_THRESHOLD } from './match-blocks';
export type { BlockAssignment, BlockAssignmentStatus, MatchBlocksResult, PersistedBlockRecord } from './match-blocks';
export { CURRENT_PIPELINE_VERSION, render } from './render';
export { PINNED_OPTIONS, canonicalise, parse, stringify } from './pipeline';
export type { ParseOptions } from './pipeline';
