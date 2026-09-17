/**
 * Node move: locked subtree path rewrite and cycle rejection
 * (design.md — "Reparent — subtree rewrite and its concurrency guard").
 *
 * Sequence, inside one transaction: lock the workspace row (serialises
 * moves per workspace, D12) -> cycle and cross-workspace and
 * parent-type checks -> capture the moved node's current path as
 * `oldPrefix` -> update `parent_id` (the `nodes_set_path` trigger
 * recomputes the moved row's own `path`) -> uniform prefix rewrite of
 * every descendant via `subtree.ts`, the one module allowed to write a
 * `path` predicate.
 */
import type postgres from 'postgres';
import { isDescendantPath } from '@deep-wiki/core';
import { assertLegalParent, type NodeType } from './legal-parent-types';
import { rewriteDescendantPaths } from './subtree';

export class CrossWorkspaceMoveError extends Error {
  constructor(nodeId: string, newParentId: string) {
    super(`cannot move node ${nodeId} to parent ${newParentId}: they belong to different workspaces`);
    this.name = 'CrossWorkspaceMoveError';
  }
}

export class CyclicMoveError extends Error {
  constructor(nodeId: string, newParentId: string) {
    super(`cannot move node ${nodeId} under ${newParentId}: the new parent is a descendant of the moved node`);
    this.name = 'CyclicMoveError';
  }
}

export interface MoveNodeInput {
  readonly nodeId: string;
  readonly newParentId: string;
}

interface NodeRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  type: NodeType;
  path: string;
}

export async function moveNode(sql: postgres.Sql, input: MoveNodeInput): Promise<void> {
  await sql.begin(async (tx) => {
    const [moved] = await tx<NodeRow[]>`
      SELECT id, workspace_id, parent_id, type, path FROM live_nodes WHERE id = ${input.nodeId}
    `;
    if (!moved) {
      throw new Error(`node ${input.nodeId} does not exist`);
    }

    // Serialises every move within this workspace (D12) — the same
    // portable row-lock idiom createWorkspace() uses for plan limits.
    await tx`SELECT id FROM workspaces WHERE id = ${moved.workspace_id} FOR UPDATE`;

    // live_nodes, not nodes: a trashed target answers exactly like a
    // missing one, never the raw nodes_trash_guard check-violation the
    // reparenting UPDATE below would otherwise raise (trash-non-disclosure
    // spec — a subject must not learn a trashed node exists at that id).
    const [newParent] = await tx<NodeRow[]>`
      SELECT id, workspace_id, parent_id, type, path FROM live_nodes WHERE id = ${input.newParentId}
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

    assertLegalParent(moved.type, newParent.type);

    const oldPrefix = moved.path;

    const positionRows = await tx<{ next_position: number }[]>`
      SELECT COALESCE(MAX(position) + 1, 0) AS next_position FROM live_nodes WHERE parent_id = ${newParent.id}
    `;
    const nextPosition = positionRows[0]!.next_position;

    // The nodes_set_path trigger recomputes `moved`'s own path from the
    // new parent_id; it never rewrites descendants.
    await tx`
      UPDATE nodes SET parent_id = ${newParent.id}, position = ${nextPosition}, updated_at = now()
       WHERE id = ${moved.id}
    `;

    const [rewired] = await tx<{ path: string }[]>`SELECT path FROM live_nodes WHERE id = ${moved.id}`;
    const newPrefix = rewired!.path;

    await rewriteDescendantPaths(tx, {
      workspaceId: moved.workspace_id,
      oldPrefix,
      newPrefix,
      excludeId: moved.id,
    });
  });
}
