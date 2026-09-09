import { expect, test } from 'bun:test';
import type { Changeset } from './changeset';

// versioning-and-collaboration changesets spec: book-scoped, implicit
// grouping by author within a window; message is optional; closedAt marks
// retirement only, never a second copy of the window.

test('a Changeset with no message is a valid, complete shape', () => {
  const changeset: Changeset = {
    id: 'cs-1',
    workspaceId: 'ws-1',
    bookId: 'book-1',
    authorId: 'user-1',
    message: null,
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    closedAt: null,
  };

  expect(changeset.message).toBeNull();
  expect(changeset.closedAt).toBeNull();
});

test('a retired Changeset records when activity stopped, not a window value', () => {
  const changeset: Changeset = {
    id: 'cs-2',
    workspaceId: 'ws-1',
    bookId: 'book-1',
    authorId: 'user-1',
    message: 'Restructured onboarding chapter',
    lastActivityAt: '2026-01-01T00:09:00.000Z',
    closedAt: '2026-01-01T00:09:00.000Z',
  };

  expect(changeset.closedAt).toBe(changeset.lastActivityAt);
  expect(changeset.message).toBe('Restructured onboarding chapter');
});
