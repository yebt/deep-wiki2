import type { TreeNode } from '~/composables/useTree';

/**
 * A pre-order walk of the workspace tree — shelf → book → chapter → page,
 * each level ordered by its own `position` — as a node id → index map.
 *
 * Exists for `useBookDiffNavigator`'s page switcher: `GET /books/:id/diff`
 * orders changed pages by `page_id` (`packages/db/src/changesets/
 * book-diff.ts`'s `ORDER BY page_id, created_at DESC`), an id the database
 * mints at random, so without this the switcher's order would be arbitrary
 * on every load (docs/TODO.md Findings, 2026-09-14 — the server should
 * order instead; this is the client-side stand-in until it does). Sorting
 * within a level by `position` is defensive rather than load-bearing —
 * `TreeNode.children` is expected to already arrive in that order — but
 * costs nothing and means a caller never has to know which is true.
 */
export function buildTreeOrderIndex(nodes: readonly TreeNode[]): ReadonlyMap<string, number> {
  const index = new Map<string, number>();
  let next = 0;

  function walk(level: readonly TreeNode[]): void {
    for (const node of [...level].sort((a, b) => a.position - b.position)) {
      index.set(node.id, next);
      next += 1;
      walk(node.children);
    }
  }

  walk(nodes);
  return index;
}
