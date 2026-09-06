import type { Result } from '../result';

/**
 * Content entity types built from primitives (design.md "Where the pure
 * logic lives" — D19: no mdast type ever crosses into `packages/core`).
 * `BlockId` is an opaque string: `d:` + 12-hex sha256 + `#n` while
 * derived-only, or a minted 10-character Crockford base32 id once
 * referenced (`packages/markdown/src/match-blocks.ts` owns producing
 * these; core only holds the primitive and the port shapes that move it).
 */
export type BlockId = string;

/** `page_blocks.status` (design.md "Block identity"). */
export type BlockStatus = 'active' | 'superseded' | 'tombstoned';

/** Points at exactly one page's content row, tenant-scoped. */
export interface PageContentRef {
  readonly nodeId: string;
  readonly workspaceId: string;
}

/** `block_id → {start, end, hash}` — derived, rebuilt every save, never itself an anchor (docs/SPECS.md §3.3). */
export interface BlockIndexEntry {
  readonly start: number;
  readonly end: number;
  readonly hash: string;
}

export interface PageContent {
  readonly markdown: string;
  readonly renderedHtml: string;
  readonly blockIndex: Readonly<Record<BlockId, BlockIndexEntry>>;
  readonly contentHash: string;
  readonly pipelineVersion: number;
}

export interface SavePageInput {
  readonly markdown: string;
  /** `null` when saving for the first time; otherwise the `contentHash` the caller last read (design D16 — optimistic concurrency). */
  readonly expectedContentHash: string | null;
}

export interface ContentStoreError {
  readonly reason: 'not_found' | 'stale' | 'not_canonical';
}

/** The port `packages/db` implements for reading/writing a page's canonical content. */
export interface ContentStore {
  read(ref: PageContentRef): Promise<Result<PageContent, ContentStoreError>>;
  save(ref: PageContentRef, input: SavePageInput): Promise<Result<PageContent, ContentStoreError>>;
}

export interface PersistedBlock {
  readonly id: BlockId;
  readonly status: BlockStatus;
  readonly supersededBy?: BlockId;
  readonly contentHash: string;
  readonly excerpt: string;
}

export interface BlockRegistryError {
  readonly reason: 'tombstoned_id_reused';
  readonly id: BlockId;
}

/** The port `packages/db` implements for `page_blocks` — UNIQUE (page_id, block_id) spans every status, so a tombstoned id is never reused. */
export interface BlockRegistry {
  listByPage(ref: PageContentRef): Promise<Result<readonly PersistedBlock[], BlockRegistryError>>;
  reconcile(ref: PageContentRef, blocks: readonly PersistedBlock[]): Promise<Result<void, BlockRegistryError>>;
}
