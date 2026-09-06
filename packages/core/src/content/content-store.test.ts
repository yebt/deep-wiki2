/**
 * Port-contract test: any `ContentStore` implementation — the real
 * `packages/db` adapter or a stub used by higher-layer tests — must
 * satisfy this shape and this optimistic-concurrency behaviour
 * (page-content: Single Current Row Per Page; design D16).
 */
import { describe, expect, test } from 'bun:test';
import { err, ok } from '../result';
import type { ContentStore, PageContent, PageContentRef } from './types';

class StubContentStore implements ContentStore {
  #rows = new Map<string, PageContent>();

  private key(ref: PageContentRef): string {
    return `${ref.workspaceId}:${ref.nodeId}`;
  }

  async read(ref: PageContentRef) {
    const row = this.#rows.get(this.key(ref));
    return row ? ok(row) : err({ reason: 'not_found' as const });
  }

  async save(ref: PageContentRef, input: { markdown: string; expectedContentHash: string | null }) {
    const existing = this.#rows.get(this.key(ref));
    if (existing && existing.contentHash !== input.expectedContentHash) {
      return err({ reason: 'stale' as const });
    }

    const saved: PageContent = {
      markdown: input.markdown,
      renderedHtml: `<p>${input.markdown.trim()}</p>`,
      blockIndex: {},
      contentHash: `hash(${input.markdown})`,
      pipelineVersion: 1,
    };
    this.#rows.set(this.key(ref), saved);
    return ok(saved);
  }
}

const REF: PageContentRef = { nodeId: 'page-1', workspaceId: 'ws-1' };

describe('ContentStore port contract', () => {
  test('saving persists the submitted markdown unchanged', async () => {
    const store: ContentStore = new StubContentStore();

    const result = await store.save(REF, { markdown: 'Hello.\n', expectedContentHash: null });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.markdown).toBe('Hello.\n');
  });

  test('a saved page reads back the same markdown', async () => {
    const store: ContentStore = new StubContentStore();
    await store.save(REF, { markdown: 'Hello.\n', expectedContentHash: null });

    const result = await store.read(REF);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.markdown).toBe('Hello.\n');
  });

  test('a stale expected hash is rejected without writing', async () => {
    const store: ContentStore = new StubContentStore();
    await store.save(REF, { markdown: 'First.\n', expectedContentHash: null });

    const result = await store.save(REF, { markdown: 'Second.\n', expectedContentHash: 'wrong-hash' });

    expect(result.ok).toBe(false);
    const read = await store.read(REF);
    expect(read.ok && read.value.markdown).toBe('First.\n');
  });

  test('re-saving with the correct hash overwrites the single current row', async () => {
    const store: ContentStore = new StubContentStore();
    const first = await store.save(REF, { markdown: 'First.\n', expectedContentHash: null });
    const correctHash = first.ok ? first.value.contentHash : '';

    const result = await store.save(REF, { markdown: 'Second.\n', expectedContentHash: correctHash });

    expect(result.ok).toBe(true);
    const read = await store.read(REF);
    expect(read.ok && read.value.markdown).toBe('Second.\n');
  });
});
