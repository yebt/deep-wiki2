/**
 * Drag-reorder among siblings, with an optional reparent in the same
 * operation (navigation-tree spec — "Drag Reorder Writes Back To
 * Position", "Cross-workspace drag target is rejected"). Extends
 * `move.ts` rather than duplicating it: the workspace lock, the
 * cross-workspace/cyclic/parent-type checks, and the descendant path
 * rewrite are identical. What this module adds is an explicit sibling
 * **index**, so a drop lands the node exactly where the user dragged it
 * instead of always appending to the end of the list — `path` itself does
 * not encode position (design.md — path is an id chain), so a same-parent
 * reorder never needs `rewriteDescendantPaths` at all.
 */
import type postgres from 'postgres';
import { isDescendantPath } from '@deep-wiki/core';
import { CrossWorkspaceMoveError, CyclicMoveError, IllegalParentTypeError } from './move';
import { rewriteDescendantPaths } from './subtree';

type NodeType = 'workspace' | 'shelf' | 'book' | 'chapter' | 'page';

/** Workspace -> Shelf -> Book -> {Chapter -> Page, Page} (docs/SPECS.md §3.1) — kept identical to move.ts's table. */
const LEGAL_PARENT_TYPES: Record<NodeType, readonly NodeType[]> = {
  workspace: [],
  shelf: ['workspace'],
  book: ['shelf'],
  chapter: ['book'],
  page: ['book', 'chapter'],
};

export interface ReorderNodeInput {
  readonly nodeId: string;
  readonly newParentId: string;
  /** 0-based target index among the new parent's children, after the move. Clamped to the valid range. */
  readonly newIndex: number;
}

interface NodeRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  type: NodeType;
  path: string;
}

export async function reorderNode(sql: postgres.Sql, input: ReorderNodeInput): Promise<void> {
  await sql.begin(async (tx) => {
    const [moved] = await tx<NodeRow[]>`
      SELECT id, workspace_id, parent_id, type, path FROM nodes WHERE id = ${input.nodeId}
    `;
    if (!moved) {
      throw new Error(`node ${input.nodeId} does not exist`);
    }

    // Serialises every reorder within this workspace, exactly as moveNode
    // does — two concurrent drags in the same tree must not interleave.
    await tx`SELECT id FROM workspaces WHERE id = ${moved.workspace_id} FOR UPDATE`;

    const [newParent] = await tx<NodeRow[]>`
      SELECT id, workspace_id, parent_id, type, path FROM nodes WHERE id = ${input.newParentId}
    `;
    if (!newParent) {
      throw new Error(`node ${input.newParentId} does not exist`);
    }

    if (newParent.workspace_id !== moved.workspace_id) {
      throw new CrossWorkspaceMoveError(moved.id, newParent.id);
    }

    if (isDescendantPath(moved.path, newParent.path)) {
      throw new CyclicMoveError(moved.id, newParent.id);
    }

    const legalParents = LEGAL_PARENT_TYPES[moved.type];
    if (!legalParents.includes(newParent.type)) {
      throw new IllegalParentTypeError(moved.type, newParent.type);
    }

    const parentChanged = moved.parent_id !== newParent.id;
    const oldPrefix = moved.path;

    const siblingRows = await tx<{ id: string }[]>`
      SELECT id FROM nodes WHERE parent_id = ${newParent.id} AND id <> ${moved.id} ORDER BY position ASC, id ASC
    `;
    const siblingIds = siblingRows.map((row) => row.id);
    const clampedIndex = Math.max(0, Math.min(input.newIndex, siblingIds.length));
    const newOrder = [...siblingIds.slice(0, clampedIndex), moved.id, ...siblingIds.slice(clampedIndex)];

    if (parentChanged) {
      // The nodes_set_path trigger recomputes `moved`'s own path from the
      // new parent_id; it never rewrites descendants.
      await tx`UPDATE nodes SET parent_id = ${newParent.id}, updated_at = now() WHERE id = ${moved.id}`;

      const [rewired] = await tx<{ path: string }[]>`SELECT path FROM nodes WHERE id = ${moved.id}`;
      await rewriteDescendantPaths(tx, {
        workspaceId: moved.workspace_id,
        oldPrefix,
        newPrefix: rewired!.path,
        excludeId: moved.id,
      });
    }

    for (let index = 0; index < newOrder.length; index += 1) {
      await tx`UPDATE nodes SET position = ${index}, updated_at = now() WHERE id = ${newOrder[index]!}`;
    }
  });
}
