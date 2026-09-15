import { describe, expect, test } from 'vitest';
import type { TreeNode } from '~/composables/useTree';
import { buildTreeOrderIndex } from './tree-order';

/**
 * `useBookDiffNavigator`'s client-side stand-in for the server ordering
 * `GET /books/:id/diff` does not yet do — it orders changed pages by
 * `page_id` (`packages/db/src/changesets/book-diff.ts`), not tree position
 * (docs/TODO.md Findings, 2026-09-14). This is the tree side of that fix: a
 * pre-order walk — shelf → book → chapter → page, each level by its own
 * `position` — as a node id → index map.
 */
function node(id: string, position: number, children: readonly TreeNode[] = []): TreeNode {
  return { id, type: 'page', slug: id, title: id, position, children };
}

describe('buildTreeOrderIndex', () => {
  test('walks a nested tree in document order, not the order nodes were passed in', () => {
    // Two shelves, each with children, deliberately handed in out of order
    // so a test that happened to receive them already sorted would prove
    // nothing (the trap the task calls out by name).
    const tree = [
      node('shelf-b', 1, [node('book-b1', 0, [node('page-b1a', 0)])]),
      node('shelf-a', 0, [node('book-a1', 0, [node('page-a1a', 1), node('page-a1b', 0)])]),
    ];

    const index = buildTreeOrderIndex(tree);

    // Document order: shelf-a (position 0) before shelf-b (position 1); within
    // shelf-a's book, page-a1b (position 0) before page-a1a (position 1).
    expect([...index.keys()]).toEqual(['shelf-a', 'book-a1', 'page-a1b', 'page-a1a', 'shelf-b', 'book-b1', 'page-b1a']);
    expect(index.get('shelf-a')).toBeLessThan(index.get('shelf-b')!);
    expect(index.get('page-a1b')).toBeLessThan(index.get('page-a1a')!);
  });

  test('sorts by position within a level even when children already arrived out of order', () => {
    const tree = [node('shelf-a', 0, [node('z-book', 5), node('a-book', 1)])];

    const index = buildTreeOrderIndex(tree);

    expect(index.get('a-book')).toBeLessThan(index.get('z-book')!);
  });

  test('an empty tree produces an empty index', () => {
    expect(buildTreeOrderIndex([]).size).toBe(0);
  });
});
