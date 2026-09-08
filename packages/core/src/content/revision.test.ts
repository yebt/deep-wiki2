import { expect, test } from 'bun:test';
import type { Revision } from './revision';

// versioning-and-collaboration design.md Decision 7 ("Storage shape of
// page_revision") / revision-history spec: an immutable snapshot of a
// page's canonical Markdown and its own block index, primitive-typed per
// D19 — no mdast type, ever.

test('a Revision is a plain, primitive-typed snapshot of one save', () => {
  const revision: Revision = {
    id: 'rev-1',
    workspaceId: 'ws-1',
    pageId: 'page-1',
    authorId: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    content: '# Hello\n',
    contentHash: 'hash-1',
    blockIndex: {},
    changesetId: null,
  };

  expect(revision.content).toBe('# Hello\n');
  expect(revision.changesetId).toBeNull();
});

test('a Revision belonging to a changeset names it', () => {
  const revision: Revision = {
    id: 'rev-2',
    workspaceId: 'ws-1',
    pageId: 'page-1',
    authorId: 'user-1',
    createdAt: '2026-01-01T00:10:00.000Z',
    content: '# Hello again\n',
    contentHash: 'hash-2',
    blockIndex: { abc123: { start: 0, end: 8, hash: 'h' } },
    changesetId: 'changeset-1',
  };

  expect(revision.changesetId).toBe('changeset-1');
  expect(revision.blockIndex.abc123?.hash).toBe('h');
});
