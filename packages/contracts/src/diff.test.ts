import { describe, expect, test } from 'bun:test';
import { PageDiffResponseSchema } from './diff';

/**
 * `GET /pages/:id/diff` response (block-diff spec). Every change kind
 * carries its own `text`, attached by the route from the two revisions'
 * own `sliceBlocks()` output (`diffBlocks()` itself reports classification
 * only, per design.md Decision 2's `BlockChange` union) — moved/modified
 * are the two kinds most likely to collapse into each other under a loose
 * schema, so each variant's parsed output is asserted whole below.
 *
 * "Whole" is the point. Until 2026-09-09 this comment claimed each variant
 * was asserted in isolation while the test read back only `kind` and the
 * array length: deleting `moved` from `ModifiedChangeSchema` — the one
 * field that tells the two collapsing kinds apart — left the suite green,
 * because `z.object` strips an undeclared field silently.
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

    expect(parsed.diff.changes).toEqual([
      { kind: 'added', id: 'b1', slot: 1, text: 'New paragraph.' },
      { kind: 'removed', id: 'b2', slot: 2, text: 'Gone paragraph.' },
      { kind: 'modified', id: 'b3', fromSlot: 0, toSlot: 0, moved: false, text: 'Changed paragraph.' },
      { kind: 'moved', id: 'b4', fromSlot: 0, toSlot: 1, text: 'Same paragraph.' },
      { kind: 'unchanged', id: 'b5', slot: 3, text: 'Untouched paragraph.' },
    ]);
    expect(parsed.diff.from).toEqual({ id: 'rev-1', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(parsed.diff.to).toEqual({ id: 'rev-2', createdAt: '2026-01-02T00:00:00.000Z' });
  });

  // `moved` on a modified block is the field that keeps "modified" and
  // "moved" from collapsing into each other, so it gets its own assertion
  // in both states rather than riding along in the fixture above.
  test('a modified block carries its own moved flag, in both states', () => {
    function modifiedWith(moved: boolean): unknown {
      return PageDiffResponseSchema.parse({
        diff: {
          from: { id: 'rev-1', createdAt: '2026-01-01T00:00:00.000Z' },
          to: { id: 'rev-2', createdAt: '2026-01-02T00:00:00.000Z' },
          changes: [{ kind: 'modified', id: 'b3', fromSlot: 0, toSlot: 2, moved, text: 'Changed.' }],
        },
      }).diff.changes[0];
    }

    expect(modifiedWith(true)).toEqual({
      kind: 'modified',
      id: 'b3',
      fromSlot: 0,
      toSlot: 2,
      moved: true,
      text: 'Changed.',
    });
    expect(modifiedWith(false)).toEqual({
      kind: 'modified',
      id: 'b3',
      fromSlot: 0,
      toSlot: 2,
      moved: false,
      text: 'Changed.',
    });
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
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.path)).toEqual([['diff', 'changes', 0, 'text']]);
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
    if (result.success) return;

    // The discriminator is what refuses it — not, say, a missing field on
    // whichever member the union happened to try first.
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['diff', 'changes', 0, 'kind']]);
    expect(result.error.issues[0]?.code).toBe('invalid_union_discriminator');
  });
});
