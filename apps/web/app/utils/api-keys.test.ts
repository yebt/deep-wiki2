import { describe, expect, test } from 'vitest';
import {
  bookDiffKey,
  bookHistoryKey,
  keysStaledByRename,
  keysStaledBySave,
  pageDiffKey,
  pageHistoryKey,
  pageReadKey,
  workspaceActivityKey,
  workspaceMembersKey,
} from './api-keys';

describe('read-layer keys', () => {
  test('every key names its route and every parameter that changes the answer', () => {
    expect(pageReadKey('p1')).toBe('page:p1');
    expect(pageHistoryKey('p1')).toBe('page-history:p1');
    expect(pageDiffKey('p1', 'r1', 'r2')).toBe('page-diff:p1:r1:r2');
    expect(pageDiffKey('p1', 'r2', 'r1')).not.toBe(pageDiffKey('p1', 'r1', 'r2'));
    expect(bookHistoryKey('b1')).toBe('book-history:b1');
    expect(bookDiffKey('b1', '2026-09-16T00:00:00.000Z')).toBe('book-diff:b1:2026-09-16T00:00:00.000Z');
    expect(workspaceActivityKey('ws1')).toBe('workspace-activity:ws1');
    expect(workspaceMembersKey('ws1')).toBe('workspace-members:ws1');
  });

  test('two routes for the same id never share a key', () => {
    const keys = [pageReadKey('x'), pageHistoryKey('x'), bookHistoryKey('x'), workspaceActivityKey('x'), workspaceMembersKey('x')];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('keysStaledBySave', () => {
  const staled = keysStaledBySave('p1');

  test('stales the saved page and its history', () => {
    expect(staled(pageReadKey('p1'))).toBe(true);
    expect(staled(pageHistoryKey('p1'))).toBe(true);
  });

  test('leaves another page and its history alone', () => {
    expect(staled(pageReadKey('p2'))).toBe(false);
    expect(staled(pageHistoryKey('p2'))).toBe(false);
  });

  test('stales every book history, book diff and workspace activity, whose book and workspace the save does not name', () => {
    expect(staled(bookHistoryKey('any-book'))).toBe(true);
    expect(staled(bookDiffKey('any-book', 'since'))).toBe(true);
    expect(staled(workspaceActivityKey('any-workspace'))).toBe(true);
  });

  test('keeps a diff between two named revisions, which never changes, and the members list', () => {
    expect(staled(pageDiffKey('p1', 'r1', 'r2'))).toBe(false);
    expect(staled(workspaceMembersKey('ws1'))).toBe(false);
  });
});

/**
 * A rename changes a node's name and nothing else, so it stales exactly
 * the reads that draw that name: the page’s own (its `<h1>` and the tab
 * title come out of it) and every workspace activity list, whose rows
 * name the pages they are about. History and diffs name revisions, not
 * titles, and the tree is patched in place rather than refetched.
 */
describe('keysStaledByRename', () => {
  const staled = keysStaledByRename('p1');

  test('stales the renamed page’s own read, and no other page’s', () => {
    expect(staled(pageReadKey('p1'))).toBe(true);
    expect(staled(pageReadKey('p2'))).toBe(false);
  });

  test('stales every workspace activity list, whose rows name the page', () => {
    expect(staled(workspaceActivityKey('any-workspace'))).toBe(true);
  });

  test('leaves the page’s history, its diffs and the members list alone', () => {
    expect(staled(pageHistoryKey('p1'))).toBe(false);
    expect(staled(pageDiffKey('p1', 'r1', 'r2'))).toBe(false);
    expect(staled(workspaceMembersKey('ws1'))).toBe(false);
  });
});
