import { describe, expect, test } from 'bun:test';
import { BookHistoryResponseSchema, PageHistoryResponseSchema, RevisionSummarySchema } from './revisions';

describe('RevisionSummarySchema', () => {
  test('parses a revision summary, author id/name and changeset all nullable', () => {
    const parsed = RevisionSummarySchema.parse({
      id: 'rev-1',
      authorId: null,
      authorDisplayName: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      changesetId: null,
    });

    expect(parsed.authorId).toBeNull();
    expect(parsed.authorDisplayName).toBeNull();
    expect(parsed.changesetId).toBeNull();
  });

  test('rejects a summary missing the author display name the history screen renders "who" from', () => {
    const result = RevisionSummarySchema.safeParse({
      id: 'rev-1',
      authorId: 'user-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      changesetId: null,
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    // The name of this test claims one specific field; without this, a
    // schema that refused the body for any other reason would satisfy it.
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['authorDisplayName']]);
  });
});

describe('PageHistoryResponseSchema', () => {
  // Renamed 2026-09-09: this was called "parses a newest-first revision
  // list" and asserted that the first element of a fixture written
  // newest-first is the newest — the fixture's own order, read back. The
  // schema is a `z.array`, and makes no ordering promise whatsoever;
  // "Page History Query Returns Revisions Newest First" is the *query's*
  // guarantee and is tested where the ORDER BY lives, in packages/db. What
  // this schema does guarantee is that it hands the list back in the order
  // it received it, rather than reordering or deduplicating.
  test('parses a revision list, handing it back in the order it arrived', () => {
    const parsed = PageHistoryResponseSchema.parse({
      revisions: [
        { id: 'rev-2', authorId: 'user-1', authorDisplayName: 'Owner', createdAt: '2026-01-02T00:00:00.000Z', changesetId: 'cs-1' },
        { id: 'rev-1', authorId: 'user-1', authorDisplayName: 'Owner', createdAt: '2026-01-01T00:00:00.000Z', changesetId: null },
      ],
    });

    expect(parsed.revisions.map((revision) => revision.id)).toEqual(['rev-2', 'rev-1']);
    expect(parsed.revisions[0]).toEqual({
      id: 'rev-2',
      authorId: 'user-1',
      authorDisplayName: 'Owner',
      createdAt: '2026-01-02T00:00:00.000Z',
      changesetId: 'cs-1',
    });
  });

  test('rejects a revision missing required fields, naming each one and its position', () => {
    const result = PageHistoryResponseSchema.safeParse({ revisions: [{ id: 'rev-1' }] });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.path)).toEqual([
      ['revisions', 0, 'authorId'],
      ['revisions', 0, 'authorDisplayName'],
      ['revisions', 0, 'createdAt'],
      ['revisions', 0, 'changesetId'],
    ]);
  });
});

describe('BookHistoryResponseSchema', () => {
  // changesets spec: "Changeset Carries An Optional Message" — no code path
  // writes it yet, so a null message must parse cleanly rather than being
  // required.
  test('parses a changeset with a null message and its grouped revisions', () => {
    const parsed = BookHistoryResponseSchema.parse({
      changesets: [
        {
          id: 'cs-1',
          authorId: 'user-1',
          authorDisplayName: 'Owner',
          message: null,
          windowStart: '2026-01-01T00:00:00.000Z',
          windowEnd: '2026-01-01T00:10:00.000Z',
          revisions: [{ id: 'rev-1', pageId: 'page-1', createdAt: '2026-01-01T00:10:00.000Z' }],
        },
      ],
    });

    expect(parsed.changesets[0]!.message).toBeNull();
    expect(parsed.changesets[0]!.revisions).toHaveLength(1);
  });

  test('rejects a changeset missing its revisions', () => {
    const result = BookHistoryResponseSchema.safeParse({
      changesets: [
        {
          id: 'cs-1',
          authorId: null,
          authorDisplayName: null,
          message: null,
          windowStart: '2026-01-01T00:00:00.000Z',
          windowEnd: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['changesets', 0, 'revisions']]);
  });
});
