/**
 * `GET /workspaces` — the workspaces this caller may open.
 *
 * Nothing told a client which workspace ids exist for it, so
 * `/workspaces/:id/tree` could only be reached by someone who already knew
 * an id. This is the endpoint the navigation starts from.
 *
 * **Absent, never marked.** A workspace the caller cannot read is not in
 * the response at all — not present with a flag, not present with its name
 * nulled out. `listReadableWorkspaces` resolves the permitted set first and
 * selects only inside it, so an unreadable workspace's row is never loaded
 * and cannot leak through a later serialisation mistake (content-and-editor
 * design.md, "Listing without disclosure"). The response schema strips
 * anything it does not declare, which is the second half of the same rule.
 *
 * **Reading nothing is a 200.** A caller with no readable workspace gets
 * `{ workspaces: [] }`, byte-identical to what a caller with no workspaces
 * at all gets. Answering 403 or 404 instead would report the difference
 * between "there is nothing" and "there is something you may not see",
 * which is exactly the disclosure this endpoint exists to avoid — and it
 * would make a normal state (a new member waiting on a grant) look like a
 * failure.
 */
import { listReadableWorkspaces } from '@deep-wiki/db';
import { WorkspaceListResponseSchema } from '@deep-wiki/contracts';
import { Hono } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface WorkspaceRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes?: number;
}

export function createWorkspaceRoutes(deps: WorkspaceRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes ?? 30 });

  app.get('/workspaces', auth, async (c) => {
    const session = c.get('session');

    const workspaces = await listReadableWorkspaces(deps.sql, {
      subjectType: 'user',
      subjectId: session.userId,
    });

    return c.json(WorkspaceListResponseSchema.parse({ workspaces }));
  });

  return app;
}
