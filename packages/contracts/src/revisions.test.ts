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
      contentHash: 'a'.repeat(64),
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
      contentHash: 'a'.repeat(64),
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    // The name of this test claims one specific field; without this, a
    // schema that refused the body for any other reason would satisfy it.
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['authorDisplayName']]);
  });

  // The history screen marks a revision whose bytes equal the previous
  // one's from the hash alone (docs/TODO.md Findings, 2026-09-17).
  test('rejects a summary missing the content hash the history screen compares neighbours by', () => {
    const result = RevisionSummarySchema.safeParse({
      id: 'rev-1',
      authorId: null,
      authorDisplayName: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      changesetId: null,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['contentHash']]);
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
      workspace: { id: 'ws-1', slug: 'acme' },
      revisions: [
        { id: 'rev-2', authorId: 'user-1', authorDisplayName: 'Owner', createdAt: '2026-01-02T00:00:00.000Z', changesetId: 'cs-1', contentHash: 'b'.repeat(64) },
        { id: 'rev-1', authorId: 'user-1', authorDisplayName: 'Owner', createdAt: '2026-01-01T00:00:00.000Z', changesetId: null, contentHash: 'a'.repeat(64) },
      ],
    });

    expect(parsed.revisions.map((revision) => revision.id)).toEqual(['rev-2', 'rev-1']);
    expect(parsed.revisions[0]).toEqual({
      id: 'rev-2',
      authorId: 'user-1',
      authorDisplayName: 'Owner',
      createdAt: '2026-01-02T00:00:00.000Z',
      changesetId: 'cs-1',
      contentHash: 'b'.repeat(64),
    });
  });

  test('rejects a revision missing required fields, naming each one and its position', () => {
    const result = PageHistoryResponseSchema.safeParse({ workspace: { id: 'ws-1', slug: 'acme' }, revisions: [{ id: 'rev-1' }] });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.path)).toEqual([
      ['revisions', 0, 'authorId'],
      ['revisions', 0, 'authorDisplayName'],
      ['revisions', 0, 'createdAt'],
      ['revisions', 0, 'changesetId'],
      ['revisions', 0, 'contentHash'],
    ]);
  });

  // The history screen's frame holds `/w/<slug>/p/<id>` to its word from
  // this response, not from a second request (2026-09-17).
  test('names the workspace by id and slug, and a response without the pair is rejected', () => {
    expect(PageHistoryResponseSchema.parse({ workspace: { id: 'ws-1', slug: 'acme' }, revisions: [] }).workspace).toEqual({ id: 'ws-1', slug: 'acme' });
    const result = PageHistoryResponseSchema.safeParse({ revisions: [] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['workspace']]);
  });
});

describe('BookHistoryResponseSchema', () => {
  // changesets spec: "Changeset Carries An Optional Message" — no code path
  // writes it yet, so a null message must parse cleanly rather than being
  // required.
  test('parses a changeset with a null message and its grouped revisions', () => {
    const parsed = BookHistoryResponseSchema.parse({
      title: 'Operations Handbook',
      workspaceId: 'ws-1',
      workspace: { id: 'ws-1', slug: 'acme' },
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
      title: 'Operations Handbook',
      workspaceId: 'ws-1',
      workspace: { id: 'ws-1', slug: 'acme' },
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

  // The book-history and book-diff screens cannot show the book's own name
  // or link back to its tree without these — added because neither field
  // existed on this response at all. A fixture using '' here would let a
  // schema that merely checks "is a string" pass without proving anything,
  // so this uses a distinctive non-empty title instead.
  test('rejects a response missing the book title, workspaceId or workspace pair', () => {
    const result = BookHistoryResponseSchema.safeParse({ changesets: [] });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['title'], ['workspaceId'], ['workspace']]);
  });

  test('a book with an empty-string title still parses — the schema enforces presence, not non-emptiness', () => {
    const parsed = BookHistoryResponseSchema.parse({ title: '', workspaceId: 'ws-1', workspace: { id: 'ws-1', slug: 'acme' }, changesets: [] });

    expect(parsed.title).toBe('');
  });
});
