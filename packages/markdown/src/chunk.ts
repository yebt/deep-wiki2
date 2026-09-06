import type { Root, RootContent } from 'mdast';
import { findBlockAnchor } from './extensions/block-anchor';
import { deriveBlockId } from './match-blocks';
import { parse } from './index';

export interface Chunk {
  blockIds: string[];
  text: string;
  ordinal: number;
}

export interface ChunkOptions {
  maxTokens: number;
}

/** A crude but deterministic token count — whitespace-separated words. */
function tokenCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

interface BlockSlice {
  id: string;
  text: string;
  tokens: number;
}

/** Assigns each top-level block its id: the persisted anchor if present, otherwise the derived identity. */
function sliceBlocks(tree: Root, source: string): BlockSlice[] {
  const occurrenceCounts = new Map<string, number>();

  return tree.children.map((node: RootContent) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const text = start !== undefined && end !== undefined ? source.slice(start, end) : '';

    const anchor = findBlockAnchor(node);
    let id: string;
    if (anchor) {
      id = anchor.id;
    } else {
      const occurrence = occurrenceCounts.get(text) ?? 0;
      occurrenceCounts.set(text, occurrence + 1);
      id = deriveBlockId(text, occurrence);
    }

    return { id, text, tokens: tokenCount(text) };
  });
}

/**
 * Splits Markdown into deterministic chunks whose boundaries always follow
 * block boundaries — never inside one — and which carry the block ids of
 * every block they span. Pure and stateless: `workspace_id` is attached by
 * the caller from the owning node (design.md "Chunking").
 * (markdown-pipeline: Deterministic Chunk Boundaries Carrying Block IDs)
 */
export function chunk(markdown: string, options: ChunkOptions): Chunk[] {
  const tree = parse(markdown);
  const blocks = sliceBlocks(tree, markdown);

  const chunks: Chunk[] = [];
  let currentIds: string[] = [];
  let currentTexts: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (currentIds.length === 0) return;
    chunks.push({ blockIds: currentIds, text: currentTexts.join('\n\n'), ordinal: chunks.length });
    currentIds = [];
    currentTexts = [];
    currentTokens = 0;
  };

  for (const block of blocks) {
    const wouldExceed = currentTokens + block.tokens > options.maxTokens;
    if (wouldExceed && currentIds.length > 0) {
      flush();
    }
    currentIds.push(block.id);
    currentTexts.push(block.text);
    currentTokens += block.tokens;

    // An oversized block (exceeds the budget on its own) becomes its own
    // chunk rather than being cut mid-content or absorbing neighbours.
    if (block.tokens > options.maxTokens) {
      flush();
    }
  }
  flush();

  return chunks;
}
