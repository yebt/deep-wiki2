import { describe, expect, test } from 'bun:test';
import { daysUntilPurge, decideRestore, decideTrash, TRASH_RETENTION_DAYS } from './rules';

describe('decideTrash', () => {
  // node-trash spec — "Manage subject trashes an empty container".
  test('manage subject trashes an empty container', () => {
    const result = decideTrash({
      mode: 'trash',
      isOwner: false,
      hasManage: true,
      isContainer: true,
      live: { pages: 0, containers: 0 },
      title: 'Chapter',
    });
    expect(result).toEqual({ ok: true });
  });

  // node-trash spec — "Reader without manage or ownership gets a named 403".
  test('reader without manage or ownership gets a named 403', () => {
    const result = decideTrash({
      mode: 'trash',
      isOwner: false,
      hasManage: false,
      isContainer: false,
      live: { pages: 0, containers: 0 },
      title: 'Page',
    });
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });

  // node-trash spec — "Non-owner manager cannot trash a non-empty chapter".
  test('non-owner manager cannot trash a non-empty chapter', () => {
    const result = decideTrash({
      mode: 'trash',
      isOwner: false,
      hasManage: true,
      isContainer: true,
      live: { pages: 1, containers: 0 },
      title: 'Chapter',
    });
    expect(result).toEqual({ ok: false, reason: 'not_empty' });
  });

  // node-trash spec — "Correct name and current count succeeds".
  test('owner force-delete with the correct name and the current count succeeds', () => {
    const result = decideTrash({
      mode: 'force',
      isOwner: true,
      hasManage: false,
      isContainer: true,
      live: { pages: 3, containers: 0 },
      submitted: { confirmName: 'Chapter', acceptedCount: 3 },
      title: 'Chapter',
    });
    expect(result).toEqual({ ok: true });
  });

  test('owner force-delete with the wrong name is refused', () => {
    const result = decideTrash({
      mode: 'force',
      isOwner: true,
      hasManage: false,
      isContainer: true,
      live: { pages: 3, containers: 0 },
      submitted: { confirmName: 'Chaptre', acceptedCount: 3 },
      title: 'Chapter',
    });
    expect(result).toEqual({ ok: false, reason: 'name_mismatch' });
  });

  // node-trash spec — "Stale count is refused".
  test('owner force-delete with a stale count is refused', () => {
    const result = decideTrash({
      mode: 'force',
      isOwner: true,
      hasManage: false,
      isContainer: true,
      live: { pages: 4, containers: 0 },
      submitted: { confirmName: 'Chapter', acceptedCount: 3 },
      title: 'Chapter',
    });
    expect(result).toEqual({ ok: false, reason: 'stale_count' });
  });

  test('a leaf page carries no non-empty restriction', () => {
    const result = decideTrash({
      mode: 'trash',
      isOwner: false,
      hasManage: true,
      isContainer: false,
      live: { pages: 0, containers: 0 },
      title: 'Page',
    });
    expect(result).toEqual({ ok: true });
  });
});

describe('decideRestore', () => {
  // trash-restore spec — "Restoring a page under a still-trashed chapter is refused".
  test('restoring under a still-trashed ancestor is refused', () => {
    const result = decideRestore({ parentLive: false, slugTaken: false });
    expect(result).toEqual({ ok: false, reason: 'ancestor_trashed' });
  });

  // trash-restore spec — "Collision names the live sibling".
  test('a slug collision with a live sibling is refused', () => {
    const result = decideRestore({ parentLive: true, slugTaken: true });
    expect(result).toEqual({ ok: false, reason: 'slug_taken' });
  });

  // trash-restore spec — "No collision restores under the original slug".
  test('a live parent and no collision restores successfully', () => {
    const result = decideRestore({ parentLive: true, slugTaken: false });
    expect(result).toEqual({ ok: true });
  });

  test('a second collision on a typed replacement name is refused the same way', () => {
    const result = decideRestore({ parentLive: true, slugTaken: true, requestedName: 'overview-2026' });
    expect(result).toEqual({ ok: false, reason: 'slug_taken' });
  });
});

describe('TRASH_RETENTION_DAYS and daysUntilPurge', () => {
  test('a node trashed just now has the full retention window left', () => {
    const now = new Date('2026-01-15T12:00:00Z');
    expect(daysUntilPurge(now, now)).toBe(TRASH_RETENTION_DAYS);
  });

  test('a node trashed 29 days ago has 1 day left', () => {
    const trashedAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-01-30T00:00:00Z');
    expect(daysUntilPurge(trashedAt, now)).toBe(1);
  });

  test('a node past its retention window has zero days left, never negative', () => {
    const trashedAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-03-01T00:00:00Z');
    expect(daysUntilPurge(trashedAt, now)).toBe(0);
  });
});
