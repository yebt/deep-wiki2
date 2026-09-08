import { describe, expect, test } from 'bun:test';
import { PageHistoryResponseSchema, RevisionSummarySchema } from './revisions';

describe('RevisionSummarySchema', () => {
  test('parses a revision summary, author and changeset both nullable', () => {
    const parsed = RevisionSummarySchema.parse({
      id: 'rev-1',
      authorId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      changesetId: null,
    });

    expect(parsed.authorId).toBeNull();
    expect(parsed.changesetId).toBeNull();
  });
});

describe('PageHistoryResponseSchema', () => {
  test('parses a newest-first revision list', () => {
    const parsed = PageHistoryResponseSchema.parse({
      revisions: [
        { id: 'rev-2', authorId: 'user-1', createdAt: '2026-01-02T00:00:00.000Z', changesetId: 'cs-1' },
        { id: 'rev-1', authorId: 'user-1', createdAt: '2026-01-01T00:00:00.000Z', changesetId: null },
      ],
    });

    expect(parsed.revisions).toHaveLength(2);
    expect(parsed.revisions[0]?.id).toBe('rev-2');
  });

  test('rejects a revision missing a required field', () => {
    const result = PageHistoryResponseSchema.safeParse({ revisions: [{ id: 'rev-1' }] });

    expect(result.success).toBe(false);
  });
});
