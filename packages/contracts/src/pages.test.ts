import { describe, expect, test } from 'bun:test';
import { EditSessionResponseSchema, ReadPageResponseSchema, SavePageResponseSchema, TakeOverResponseSchema } from './pages';

describe('ReadPageResponseSchema', () => {
  // The read screen opens the workspace-scoped presence stream
  // (`GET /workspaces/:workspaceId/presence/stream`) and has nowhere else
  // to learn the id from without a side effect: `GET /pages/:id/edit-session`
  // is the only other route that carries it, and it acquires the edit lock.
  test('carries the workspace id, so a read-only screen can open presence without acquiring the lock', () => {
    const parsed = ReadPageResponseSchema.parse({ html: '<p>Hi</p>', title: 'Hi', workspaceId: 'ws-1' });

    expect(parsed.workspaceId).toBe('ws-1');
  });

  test('a response without a workspace id is rejected — the field is required, not optional', () => {
    expect(() => ReadPageResponseSchema.parse({ html: '<p>Hi</p>', title: 'Hi' })).toThrow();
  });
});

// page-content spec, D16: the edit screen's first Save on an existing page
// has no other way to learn the row's current content_hash — the read
// screen never acquires the lock, and the edit-session response is the only
// one that does. Without this field, edit.vue's first Save always sends
// `expectedContentHash: null`, which `savePage()` treats as a brand-new
// page and refuses with a stale-content 409 on every page that already has
// content (docs/TODO.md Finding, this task).
describe('EditSessionResponseSchema', () => {
  const base = {
    markdown: '# Hi\n',
    title: 'Hi',
    workspaceId: 'ws-1',
    lock: { holderUserId: 'me', acquiredAt: '2026-01-01T00:00:00Z', heartbeatAt: '2026-01-01T00:00:00Z' },
  };

  test('carries the content hash of the row it just read, so the first Save can match it back', () => {
    const parsed = EditSessionResponseSchema.parse({ ...base, contentHash: 'abc123' });

    expect(parsed.contentHash).toBe('abc123');
  });

  test('a response without a content hash is rejected — the field is required, not optional', () => {
    expect(() => EditSessionResponseSchema.parse(base)).toThrow();
  });
});

// `POST /pages/:id/lock/take-over` reuses the same shape, and a take-over
// hands the document back to open exactly like a successful edit-session —
// the taking-over author's first Save needs the same hash for the same
// reason.
describe('TakeOverResponseSchema', () => {
  test('also requires the content hash', () => {
    expect(() =>
      TakeOverResponseSchema.parse({
        markdown: '# Hi\n',
        title: 'Hi',
        workspaceId: 'ws-1',
        lock: { holderUserId: 'me', acquiredAt: '2026-01-01T00:00:00Z', heartbeatAt: '2026-01-01T00:00:00Z' },
      }),
    ).toThrow();
  });
});

// revision-history spec, via `savePage()`'s `unchanged`: a byte-identical
// save writes nothing and the response says so, so the edit screen can
// confirm honestly ("nothing changed") rather than claim a revision that
// does not exist (docs/UI-CHECKLIST.md §3, "Success — specifically").
describe('SavePageResponseSchema', () => {
  test('carries whether the save wrote anything', () => {
    expect(SavePageResponseSchema.parse({ contentHash: 'abc', unchanged: true }).unchanged).toBe(true);
    expect(SavePageResponseSchema.parse({ contentHash: 'abc', unchanged: false }).unchanged).toBe(false);
  });

  test('the flag is required, so a route cannot silently omit it', () => {
    expect(() => SavePageResponseSchema.parse({ contentHash: 'abc' })).toThrow();
  });
});
