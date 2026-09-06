/**
 * Port-contract test: any `BlockRegistry` implementation — the real
 * `packages/db` adapter or a stub — must satisfy this shape (page-blocks:
 * UNIQUE (page_id, block_id) spans every status, so a tombstoned id is
 * never reused; design.md "Block identity").
 */
import { describe, expect, test } from 'bun:test';
import { err, ok } from '../result';
import type { BlockRegistry, PageContentRef, PersistedBlock } from './types';

class StubBlockRegistry implements BlockRegistry {
  #byPage = new Map<string, PersistedBlock[]>();

  private key(ref: PageContentRef): string {
    return `${ref.workspaceId}:${ref.nodeId}`;
  }

  async listByPage(ref: PageContentRef) {
    return ok(this.#byPage.get(this.key(ref)) ?? []);
  }

  async reconcile(ref: PageContentRef, blocks: readonly PersistedBlock[]) {
    const existing = this.#byPage.get(this.key(ref)) ?? [];
    const tombstonedIds = new Set(existing.filter((b) => b.status === 'tombstoned').map((b) => b.id));

    for (const block of blocks) {
      if (block.status !== 'tombstoned' && tombstonedIds.has(block.id)) {
        return err({ reason: 'tombstoned_id_reused' as const, id: block.id });
      }
    }

    this.#byPage.set(this.key(ref), [...blocks]);
    return ok(undefined);
  }
}

const REF: PageContentRef = { nodeId: 'page-1', workspaceId: 'ws-1' };

describe('BlockRegistry port contract', () => {
  test('reconciling persists the given blocks, readable back by page', async () => {
    const registry: BlockRegistry = new StubBlockRegistry();
    const block: PersistedBlock = { id: 'abc123', status: 'active', contentHash: 'h', excerpt: 'text' };

    await registry.reconcile(REF, [block]);
    const result = await registry.listByPage(REF);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([block]);
  });

  test('an unregistered page has an empty block list', async () => {
    const registry: BlockRegistry = new StubBlockRegistry();

    const result = await registry.listByPage(REF);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  test('reusing a tombstoned id is rejected', async () => {
    const registry: BlockRegistry = new StubBlockRegistry();
    const tombstoned: PersistedBlock = { id: 'abc123', status: 'tombstoned', contentHash: 'h', excerpt: 'text' };
    await registry.reconcile(REF, [tombstoned]);

    const result = await registry.reconcile(REF, [
      { id: 'abc123', status: 'active', contentHash: 'h2', excerpt: 'new text' },
    ]);

    expect(result.ok).toBe(false);
  });
});
