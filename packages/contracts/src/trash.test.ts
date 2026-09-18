import { describe, expect, test } from 'bun:test';
import {
  DeletionTraceSchema,
  ForceDeleteRequestSchema,
  NotEmptyRefusalSchema,
  RestoreRequestSchema,
  RestoreResponseSchema,
  StaleCountRefusalSchema,
  TrashListingResponseSchema,
  TrashLookupResponseSchema,
  TrashNodeResponseSchema,
} from './trash';

describe('TrashNodeResponseSchema', () => {
  test('parses a successful trash outcome', () => {
    const parsed = TrashNodeResponseSchema.parse({ trashOperationId: 'op-1', trashed: { pages: 3, containers: 1 } });
    expect(parsed.trashed.pages).toBe(3);
  });
});

describe('NotEmptyRefusalSchema', () => {
  test('carries the count and whether force is available', () => {
    const parsed = NotEmptyRefusalSchema.parse({ error: 'not_empty', pages: 2, containers: 0, canForce: true });
    expect(parsed.canForce).toBe(true);
  });
});

describe('ForceDeleteRequestSchema', () => {
  test('requires both the typed name and the accepted count', () => {
    const result = ForceDeleteRequestSchema.safeParse({ confirmName: 'Handbook' });
    expect(result.success).toBe(false);
  });

  test('parses a complete submission', () => {
    const parsed = ForceDeleteRequestSchema.parse({ confirmName: 'Handbook', acceptedCount: 3 });
    expect(parsed.acceptedCount).toBe(3);
  });
});

describe('StaleCountRefusalSchema', () => {
  test('names the fresh count', () => {
    const parsed = StaleCountRefusalSchema.parse({ error: 'stale_count', pages: 4, containers: 0 });
    expect(parsed.pages).toBe(4);
  });
});

describe('TrashListingResponseSchema', () => {
  test('parses an empty listing', () => {
    expect(TrashListingResponseSchema.parse({ items: [] }).items).toEqual([]);
  });

  test('parses a full item with a null trashedBy and a named restoreBlockedBy', () => {
    const parsed = TrashListingResponseSchema.parse({
      items: [
        {
          operationId: 'op-1',
          root: { id: 'n-1', type: 'page', title: 'Overview' },
          location: ['Shelf', 'Book'],
          trashedBy: null,
          trashedAt: '2026-01-01T00:00:00.000Z',
          purgeAt: '2026-01-31T00:00:00.000Z',
          daysLeft: 30,
          pages: 1,
          containers: 0,
          restoreBlockedBy: { title: 'Chapter' },
        },
      ],
    });
    expect(parsed.items[0]!.restoreBlockedBy).toEqual({ title: 'Chapter' });
  });
});

describe('TrashLookupResponseSchema', () => {
  test('parses a lookup result with no restore block', () => {
    const parsed = TrashLookupResponseSchema.parse({
      operationId: 'op-1',
      trashedAt: '2026-01-01T00:00:00.000Z',
      trashedBy: { id: 'u-1', displayName: 'Ana' },
      daysLeft: 12,
      restoreBlockedBy: null,
    });
    expect(parsed.trashedBy).toEqual({ id: 'u-1', displayName: 'Ana' });
  });
});

describe('RestoreRequestSchema', () => {
  test('accepts an empty body — name is optional', () => {
    expect(RestoreRequestSchema.parse({}).name).toBeUndefined();
  });

  test('rejects an empty-string name — restore-as always types a real name', () => {
    expect(RestoreRequestSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('RestoreResponseSchema', () => {
  test('parses the restored node identity', () => {
    const parsed = RestoreResponseSchema.parse({ nodeId: 'n-1', parentId: 'p-1', slug: 'overview' });
    expect(parsed.slug).toBe('overview');
  });
});

describe('DeletionTraceSchema', () => {
  test('parses an unrestricted trashed line', () => {
    const parsed = DeletionTraceSchema.parse({
      id: 'd-1',
      event: 'trashed',
      nodeType: 'page',
      title: 'Overview',
      actorDisplayName: 'Ana',
      occurredAt: '2026-01-01T00:00:00.000Z',
      restricted: false,
    });
    expect(parsed.title).toBe('Overview');
  });

  test('parses a restricted line with the title and actor withheld', () => {
    const parsed = DeletionTraceSchema.parse({
      id: 'd-1',
      event: 'trashed',
      nodeType: 'page',
      title: null,
      actorDisplayName: null,
      occurredAt: '2026-01-01T00:00:00.000Z',
      restricted: true,
    });
    expect(parsed.title).toBeNull();
    expect(parsed.actorDisplayName).toBeNull();
  });
});
