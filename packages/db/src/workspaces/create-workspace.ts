/**
 * Workspace creation bound by the owner's plan (design.md — "Plan Limits
 * Bound Workspace Creation"; D12). Locks the owner's `users` row with
 * `SELECT ... FOR UPDATE` inside the same transaction that counts existing
 * workspaces and inserts the new one, so two concurrent creations at the
 * limit boundary serialise instead of both racing past it. This is the
 * same portable row-lock idiom the reparent algorithm uses
 * (`packages/db/src/nodes/move.ts`) — one concurrency pattern, not two.
 */
import type postgres from 'postgres';

export class PlanLimitExceededError extends Error {
  constructor(planName: string, maxWorkspaces: number) {
    super(`plan "${planName}" allows at most ${maxWorkspaces} workspace(s); the limit has been reached`);
    this.name = 'PlanLimitExceededError';
  }
}

export interface CreateWorkspaceInput {
  readonly ownerId: string;
  readonly name: string;
  readonly slug: string;
}

export interface CreatedWorkspace {
  readonly workspaceId: string;
  readonly rootNodeId: string;
}

export async function createWorkspace(sql: postgres.Sql, input: CreateWorkspaceInput): Promise<CreatedWorkspace> {
  return sql.begin(async (tx) => {
    const [owner] = await tx<{ id: string; plan_name: string; max_workspaces: number }[]>`
      SELECT u.id, p.name AS plan_name, p.max_workspaces
        FROM users u
        JOIN plans p ON p.id = u.plan_id
       WHERE u.id = ${input.ownerId}
       FOR UPDATE OF u
    `;

    if (!owner) {
      throw new Error(`user ${input.ownerId} has no plan assigned; cannot bound workspace creation`);
    }

    const countRows = await tx<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM workspaces WHERE owner_id = ${input.ownerId}
    `;
    const count = countRows[0]!.count;

    if (count >= owner.max_workspaces) {
      throw new PlanLimitExceededError(owner.plan_name, owner.max_workspaces);
    }

    const [workspace] = await tx<{ id: string }[]>`
      INSERT INTO workspaces (owner_id, name, slug)
      VALUES (${input.ownerId}, ${input.name}, ${input.slug})
      RETURNING id
    `;

    const [root] = await tx<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspace!.id}, NULL, 'workspace', '', 0, ${input.slug}, ${input.name})
      RETURNING id
    `;

    return { workspaceId: workspace!.id, rootNodeId: root!.id };
  });
}
