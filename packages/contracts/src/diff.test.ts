import { describe, expect, test } from 'bun:test';
import { BookDiffResponseSchema, PageDiffResponseSchema } from './diff';

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
      workspace: { id: 'ws-1', slug: 'acme' },
      diff: {
        from: { id: 'rev-1', createdAt: '2026-01-01T00:00:00.000Z' },
        to: { id: 'rev-2', createdAt: '2026-01-02T00:00:00.000Z' },
        changes: [
          { kind: 'added', id: 'b1', slot: 1, text: 'New paragraph.' },
          { kind: 'removed', id: 'b2', slot: 2, text: 'Gone paragraph.' },
          { kind: 'modified', id: 'b3', fromSlot: 0, toSlot: 0, moved: false, text: 'Changed paragraph.', segments: [{ kind: 'equal', text: 'Changed ' }, { kind: 'deleted', text: 'sentence' }, { kind: 'inserted', text: 'paragraph' }, { kind: 'equal', text: '.' }] },
          { kind: 'moved', id: 'b4', fromSlot: 0, toSlot: 1, text: 'Same paragraph.' },
          { kind: 'unchanged', id: 'b5', slot: 3, text: 'Untouched paragraph.' },
        ],
      },
    });

    expect(parsed.diff.changes).toEqual([
      { kind: 'added', id: 'b1', slot: 1, text: 'New paragraph.' },
      { kind: 'removed', id: 'b2', slot: 2, text: 'Gone paragraph.' },
      { kind: 'modified', id: 'b3', fromSlot: 0, toSlot: 0, moved: false, text: 'Changed paragraph.', segments: [{ kind: 'equal', text: 'Changed ' }, { kind: 'deleted', text: 'sentence' }, { kind: 'inserted', text: 'paragraph' }, { kind: 'equal', text: '.' }] },
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
        workspace: { id: 'ws-1', slug: 'acme' },
        diff: {
          from: { id: 'rev-1', createdAt: '2026-01-01T00:00:00.000Z' },
          to: { id: 'rev-2', createdAt: '2026-01-02T00:00:00.000Z' },
          changes: [{ kind: 'modified', id: 'b3', fromSlot: 0, toSlot: 2, moved, text: 'Changed.', segments: [] }],
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
      segments: [],
    });
    expect(modifiedWith(false)).toEqual({
      kind: 'modified',
      id: 'b3',
      fromSlot: 0,
      toSlot: 2,
      moved: false,
      text: 'Changed.',
      segments: [],
    });
  });

  test('rejects a change missing its text', () => {
    const result = PageDiffResponseSchema.safeParse({
      workspace: { id: 'ws-1', slug: 'acme' },
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

  // The word-level half of "a diff like GitHub's" (owner review
  // 2026-09-17): an edited block carries its inline segments; no other
  // kind does, because no other kind has two sides of one block to show.
  test('only a modified block carries inline segments, and it must', () => {
    const base = { from: { id: 'rev-1', createdAt: '2026-01-01T00:00:00.000Z' }, to: { id: 'rev-2', createdAt: '2026-01-02T00:00:00.000Z' } };

    const missing = PageDiffResponseSchema.safeParse({ workspace: { id: 'ws-1', slug: 'acme' }, diff: { ...base, changes: [{ kind: 'modified', id: 'b3', fromSlot: 0, toSlot: 0, moved: false, text: 'x' }] } });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues.map((issue) => issue.path)).toEqual([['diff', 'changes', 0, 'segments']]);

    const badKind = PageDiffResponseSchema.safeParse({ workspace: { id: 'ws-1', slug: 'acme' }, diff: { ...base, changes: [{ kind: 'modified', id: 'b3', fromSlot: 0, toSlot: 0, moved: false, text: 'x', segments: [{ kind: 'changed', text: 'x' }] }] } });
    expect(badKind.success).toBe(false);

    const onUnchanged = PageDiffResponseSchema.parse({ workspace: { id: 'ws-1', slug: 'acme' }, diff: { ...base, changes: [{ kind: 'unchanged', id: 'b5', slot: 0, text: 'x', segments: [{ kind: 'equal', text: 'x' }] }] } });
    expect(onUnchanged.diff.changes[0]).toEqual({ kind: 'unchanged', id: 'b5', slot: 0, text: 'x' });
  });

  test('rejects an unknown change kind', () => {
    const result = PageDiffResponseSchema.safeParse({
      workspace: { id: 'ws-1', slug: 'acme' },
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
  // The diff screen's frame holds `/w/<slug>/p/<id>` to its word from
  // this response, not from a second request (2026-09-17).
  test('names the workspace by id and slug, and a response without the pair is rejected', () => {
    const diff = { from: { id: 'rev-1', createdAt: '2026-01-01T00:00:00.000Z' }, to: { id: 'rev-2', createdAt: '2026-01-02T00:00:00.000Z' }, changes: [] };
    expect(PageDiffResponseSchema.parse({ workspace: { id: 'ws-1', slug: 'acme' }, diff }).workspace).toEqual({ id: 'ws-1', slug: 'acme' });
    const result = PageDiffResponseSchema.safeParse({ diff });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['workspace']]);
  });
});

/**
 * `GET /books/:id/diff` response (block-diff spec: "Book-Level Diff
 * Aggregates Changed Pages Since A Date"). Until this schema existed the
 * route returned `diffBlocks()`'s raw output unvalidated (no `text`, no
 * revision ids, no page title) and the web book-diff screen had to
 * re-derive `baselineRevisionId`/`latestRevisionId` from a separate
 * `GET /pages/:id/history` call per page and refetch text from
 * `GET /pages/:id/diff` — the exact N+1 `book-diff.ts`'s own comment says
 * it exists to avoid, reintroduced client-side.
 */
describe('BookDiffResponseSchema', () => {
  test('parses the book title/workspaceId and each changed page with its own text, revision ids and title', () => {
    const parsed = BookDiffResponseSchema.parse({
      title: 'Operations Handbook',
      workspaceId: 'ws-1',
      workspace: { id: 'ws-1', slug: 'acme' },
      pages: [
        {
          pageId: 'page-1',
          pageTitle: 'Runbook',
          baselineRevisionId: 'rev-1',
          latestRevisionId: 'rev-2',
          diff: { changes: [{ kind: 'added', id: 'b1', slot: 0, text: 'New paragraph.' }] },
        },
      ],
    });

    expect(parsed.title).toBe('Operations Handbook');
    expect(parsed.workspaceId).toBe('ws-1');
    expect(parsed.pages[0]).toEqual({
      pageId: 'page-1',
      pageTitle: 'Runbook',
      baselineRevisionId: 'rev-1',
      latestRevisionId: 'rev-2',
      diff: { changes: [{ kind: 'added', id: 'b1', slot: 0, text: 'New paragraph.' }] },
    });
  });

  // A page with no revision before `since` (its very first save landed
  // after the cutoff) has no baseline to diff against — `null`, not an
  // empty string standing in for "none".
  test('a changed page with no baseline revision parses with baselineRevisionId null', () => {
    const parsed = BookDiffResponseSchema.parse({
      title: 'Operations Handbook',
      workspaceId: 'ws-1',
      workspace: { id: 'ws-1', slug: 'acme' },
      pages: [
        {
          pageId: 'page-1',
          pageTitle: 'Runbook',
          baselineRevisionId: null,
          latestRevisionId: 'rev-1',
          diff: { changes: [] },
        },
      ],
    });

    expect(parsed.pages[0]!.baselineRevisionId).toBeNull();
  });

  // A book-diff test whose changed page has no text is one of the traps
  // named for this task — the change's own `text` must be required, not
  // silently defaulted to `''` by an over-permissive schema.
  test('rejects a changed page whose block change carries no text', () => {
    const result = BookDiffResponseSchema.safeParse({
      title: 'Operations Handbook',
      workspaceId: 'ws-1',
      workspace: { id: 'ws-1', slug: 'acme' },
      pages: [
        {
          pageId: 'page-1',
          pageTitle: 'Runbook',
          baselineRevisionId: 'rev-1',
          latestRevisionId: 'rev-2',
          diff: { changes: [{ kind: 'added', id: 'b1', slot: 0 }] },
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['pages', 0, 'diff', 'changes', 0, 'text']]);
  });

  test('names the workspace by id and slug, and a response without the pair is rejected', () => {
    expect(BookDiffResponseSchema.parse({ title: 'Ops', workspaceId: 'ws-1', workspace: { id: 'ws-1', slug: 'acme' }, pages: [] }).workspace).toEqual({ id: 'ws-1', slug: 'acme' });
    const result = BookDiffResponseSchema.safeParse({ title: 'Ops', workspaceId: 'ws-1', pages: [] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['workspace']]);
  });

  test('rejects a response missing the book title', () => {
    const result = BookDiffResponseSchema.safeParse({ workspaceId: 'ws-1', workspace: { id: 'ws-1', slug: 'acme' }, pages: [] });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['title']]);
  });
});
