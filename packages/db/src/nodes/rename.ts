/**
 * Rename a node — title and slug together.
 *
 * The slug is derived from the title (`packages/core/src/nodes/slug.ts`),
 * so leaving it behind on a rename would let the two drift until a node
 * titled "Deployment" answered at `/…/getting-started`. Rewriting both
 * faces exactly the question creation faces one row earlier — is this
 * name free among the siblings? — and answers it with the *same*
 * function, `resolveSiblingSlug()`, so the collision rule exists once.
 *
 * A rename never touches `path`: `path` is a chain of ids (design.md D3),
 * not of slugs, so no descendant is affected and `subtree.ts` is not
 * involved. That is the whole reason rename falls out of creation this
 * cleanly, and it is asserted rather than assumed in `rename.test.ts`.
 *
 * The workspace root is excluded. It has `parent_id IS NULL`, so
 * `nodes_parent_slug_unique (parent_id, slug)` cannot express uniqueness
 * for it, and its slug is the workspace's own (`createWorkspace()` writes
 * both). Renaming a workspace is a workspace operation, not a tree one.
 */
import type postgres from 'postgres';
import { resolveSiblingSlug } from './create';
import type { NodeType } from './legal-parent-types';

export class NodeNotFoundError extends Error {
  readonly nodeId: string;

  constructor(nodeId: string) {
    super(`node ${nodeId} does not exist`);
    this.name = 'NodeNotFoundError';
    this.nodeId = nodeId;
  }
}

export class WorkspaceRootRenameError extends Error {
  constructor(nodeId: string) {
    super(`node ${nodeId} is the workspace root; rename the workspace instead`);
    this.name = 'WorkspaceRootRenameError';
  }
}

export interface RenameNodeInput {
  readonly nodeId: string;
  readonly title: string;
}

export interface RenamedNode {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
}

interface NodeRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  type: NodeType;
}

export async function renameNode(sql: postgres.Sql, input: RenameNodeInput): Promise<RenamedNode> {
  return sql.begin(async (tx) => {
    const [node] = await tx<NodeRow[]>`
      SELECT id, workspace_id, parent_id, type FROM live_nodes WHERE id = ${input.nodeId}
    `;
    if (!node) {
      throw new NodeNotFoundError(input.nodeId);
    }
    if (node.parent_id === null) {
      throw new WorkspaceRootRenameError(node.id);
    }

    // The same workspace lock creation takes, for the same reason: the
    // "is this name free?" read and the UPDATE must be one decision.
    await tx`SELECT id FROM workspaces WHERE id = ${node.workspace_id} FOR UPDATE`;

    // `exceptNodeId` is what makes renaming a node to the name it already
    // has a no-op rather than a collision with itself.
    const slug = await resolveSiblingSlug(tx, {
      parentId: node.parent_id,
      title: input.title,
      exceptNodeId: node.id,
    });

    await tx`
      UPDATE nodes SET title = ${input.title}, slug = ${slug}, updated_at = now() WHERE id = ${node.id}
    `;

    return { id: node.id, slug, title: input.title };
  });
}
