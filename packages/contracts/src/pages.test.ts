import { describe, expect, test } from 'bun:test';
import { EditSessionRefusalSchema, EditSessionResponseSchema, ReadPageResponseSchema, SavePageResponseSchema, TakeOverResponseSchema } from './pages';

describe('ReadPageResponseSchema', () => {
  // The read screen opens the workspace-scoped presence stream
  // (`GET /workspaces/:workspaceId/presence/stream`) and has nowhere else
  // to learn the id from without a side effect: `GET /pages/:id/edit-session`
  // is the only other route that carries it, and it acquires the edit lock.
  test('carries the workspace id, so a read-only screen can open presence without acquiring the lock', () => {
    const parsed = ReadPageResponseSchema.parse({ html: '<p>Hi</p>', title: 'Hi', workspaceId: 'ws-1', workspace: { id: 'ws-1', slug: 'acme' } });

    expect(parsed.workspaceId).toBe('ws-1');
  });

  test('a response without a workspace id is rejected — the field is required, not optional', () => {
    expect(() => ReadPageResponseSchema.parse({ html: '<p>Hi</p>', title: 'Hi', workspace: { id: 'ws-1', slug: 'acme' } })).toThrow();
  });

  // design.md Decision 7: the `trash` block is present only for a manager
  // viewing a trashed page after a `live_nodes` miss; absent for the
  // ordinary read path this describe block otherwise exercises.
  test('the trash block is absent by default and parses when a manager is looking at a trashed page', () => {
    const ordinary = ReadPageResponseSchema.parse({ html: '<p>Hi</p>', title: 'Hi', workspaceId: 'ws-1', workspace: { id: 'ws-1', slug: 'acme' } });
    expect(ordinary.trash).toBeUndefined();

    const trashed = ReadPageResponseSchema.parse({
      html: '<p>Hi</p>',
      title: 'Hi',
      workspaceId: 'ws-1',
      workspace: { id: 'ws-1', slug: 'acme' },
      trash: { operationId: 'op-1', trashedAt: '2026-01-01T00:00:00.000Z', trashedBy: null, daysLeft: 12, restoreBlockedBy: null },
    });
    expect(trashed.trash?.daysLeft).toBe(12);
  });

  // The address `/w/<slug>/p/<id>` names a place twice; the frame checks
  // the two agree from this response rather than a second request
  // (`GET /nodes/:id/location`, 2026-09-17: one extra request per node
  // screen, and the edit route's budget of 500 measured 501).
  test('names the workspace by id and slug, so the frame holds the address to its word without a second request', () => {
    const parsed = ReadPageResponseSchema.parse({ html: '<p>Hi</p>', title: 'Hi', workspaceId: 'ws-1', workspace: { id: 'ws-1', slug: 'acme' } });

    expect(parsed.workspace).toEqual({ id: 'ws-1', slug: 'acme' });
    expect(ReadPageResponseSchema.safeParse({ html: '<p>Hi</p>', title: 'Hi', workspaceId: 'ws-1' }).success).toBe(false);
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
    workspace: { id: 'ws-1', slug: 'acme' },
    lock: { holderUserId: 'me', acquiredAt: '2026-01-01T00:00:00Z', heartbeatAt: '2026-01-01T00:00:00Z' },
  };

  test('carries the content hash of the row it just read, so the first Save can match it back', () => {
    const parsed = EditSessionResponseSchema.parse({ ...base, contentHash: 'abc123' });

    expect(parsed.contentHash).toBe('abc123');
  });

  test('a response without a content hash is rejected — the field is required, not optional', () => {
    expect(() => EditSessionResponseSchema.parse(base)).toThrow();
  });

  test('names the workspace by id and slug, and a response without the pair is rejected', () => {
    expect(EditSessionResponseSchema.parse({ ...base, contentHash: 'abc123' }).workspace).toEqual({ id: 'ws-1', slug: 'acme' });
    const { workspace: _omitted, ...withoutWorkspace } = { ...base, contentHash: 'abc123' };
    expect(EditSessionResponseSchema.safeParse(withoutWorkspace).success).toBe(false);
  });

  // A refused session (locked, or a document the probe will not open) is
  // still about a page the caller may write, and the frame still has an
  // address to hold to its word: the 409 body names the workspace too.
  test('a refusal names the workspace as well', () => {
    const refusal = { reason: 'locked', holder: { userId: 'other', acquiredAt: '2026-01-01T00:00:00Z', heartbeatAt: '2026-01-01T00:00:00Z' }, offeredExits: ['read_only', 'take_over'] };
    expect(EditSessionRefusalSchema.parse({ ...refusal, workspace: { id: 'ws-1', slug: 'acme' } }).workspace).toEqual({ id: 'ws-1', slug: 'acme' });
    expect(EditSessionRefusalSchema.safeParse(refusal).success).toBe(false);
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
        workspace: { id: 'ws-1', slug: 'acme' },
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
