import { describe, expect, test } from 'bun:test';
import { PageDiffResponseSchema } from './diff';

/**
 * `GET /pages/:id/diff` response (block-diff spec). Every change kind
 * carries its own `text`, attached by the route from the two revisions'
 * own `sliceBlocks()` output (`diffBlocks()` itself reports classification
 * only, per design.md Decision 2's `BlockChange` union) — moved/modified
 * are the two kinds most likely to collapse into each other under a loose
 * schema, so each variant is asserted in isolation below.
 */
describe('PageDiffResponseSchema', () => {
  test('parses one of each change kind, each carrying text', () => {
    const parsed = PageDiffResponseSchema.parse({
      diff: {
        from: { id: 'rev-1', createdAt: '2026-01-01T00:00:00.000Z' },
        to: { id: 'rev-2', createdAt: '2026-01-02T00:00:00.000Z' },
        changes: [
          { kind: 'added', id: 'b1', slot: 1, text: 'New paragraph.' },
          { kind: 'removed', id: 'b2', slot: 2, text: 'Gone paragraph.' },
          { kind: 'modified', id: 'b3', fromSlot: 0, toSlot: 0, moved: false, text: 'Changed paragraph.' },
          { kind: 'moved', id: 'b4', fromSlot: 0, toSlot: 1, text: 'Same paragraph.' },
          { kind: 'unchanged', id: 'b5', slot: 3, text: 'Untouched paragraph.' },
        ],
      },
    });

    expect(parsed.diff.changes).toHaveLength(5);
    expect(parsed.diff.changes.map((c) => c.kind)).toEqual(['added', 'removed', 'modified', 'moved', 'unchanged']);
  });

  test('rejects a change missing its text', () => {
    const result = PageDiffResponseSchema.safeParse({
      diff: {
        from: { id: 'rev-1', createdAt: '2026-01-01T00:00:00.000Z' },
        to: { id: 'rev-2', createdAt: '2026-01-02T00:00:00.000Z' },
        changes: [{ kind: 'added', id: 'b1', slot: 1 }],
      },
    });

    expect(result.success).toBe(false);
  });

  test('rejects an unknown change kind', () => {
    const result = PageDiffResponseSchema.safeParse({
      diff: {
        from: { id: 'rev-1', createdAt: '2026-01-01T00:00:00.000Z' },
        to: { id: 'rev-2', createdAt: '2026-01-02T00:00:00.000Z' },
        changes: [{ kind: 'renamed', id: 'b1', slot: 1, text: 'x' }],
      },
    });

    expect(result.success).toBe(false);
  });
});
