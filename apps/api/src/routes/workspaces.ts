/**
 * `GET /workspaces` — the workspaces this caller may open.
 * `POST /workspaces` — create one, for the caller.
 * `GET /workspaces/:id/members` — who belongs to one, and who is invited.
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
 *
 * ── Who may create a workspace ─────────────────────────────────────────
 *
 * Any signed-in user, within the plan assigned to them (docs/SPECS.md §2:
 * "A user may create N workspaces, bounded by the plan assigned by the
 * Super Root"; tenancy-model spec, "Plan Limits Bound Workspace
 * Creation"). There is no "may create workspaces" permission to check —
 * the spec has none, and inventing one here would be a second
 * authorisation model beside `can()`. The plan *is* the bound, and
 * `createWorkspace` enforces it inside its own transaction, so this route
 * only names the three refusals to the caller. Super Root is not special
 * here either: design.md D11 keeps instance operations on a separate
 * check and everything else on the same path as everyone.
 *
 * The creator becomes the workspace's admin by receiving `manage` on the
 * root node in the same transaction (`createWorkspace`), which is what
 * lets them reach `/workspaces/:id/members` and `POST /invitations`.
 *
 * ── The members listing does not disclose ──────────────────────────────
 *
 * Only `manage` on the root opens it, and a caller without it — a member
 * with `read`, or nobody at all — receives the same `404 not found` body
 * a workspace that was never created produces, from the same call site.
 * The route therefore never distinguishes "no such workspace" from "not
 * yours to manage", the rule `tree.ts` and `comments.ts` already follow.
 */
import {
  CreateWorkspaceRefusalSchema,
  CreateWorkspaceRequestSchema,
  CreateWorkspaceResponseSchema,
  ErrorResponseSchema,
  WorkspaceListResponseSchema,
  WorkspaceMembersResponseSchema,
} from '@deep-wiki/contracts';
import {
  can,
  createWorkspace,
  listPendingInvitations,
  listReadableWorkspaces,
  listWorkspaceMembers,
  NoPlanAssignedError,
  PlanLimitExceededError,
  WORKSPACE_MEMBERS_LIMIT,
} from '@deep-wiki/db';
import { Hono, type Context } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';
import { resolveWorkspaceId } from './workspace-ref';

export interface WorkspaceRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes?: number;
}


/** Postgres's unique-violation SQLSTATE, the only error `workspaces_slug_key` raises. */
const UNIQUE_VIOLATION = '23505';

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/** Absence and denial of `manage` answer with this exact body, from this one call site. */
function notFound(c: Context): Response {
  return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);
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

  app.post('/workspaces', auth, async (c) => {
    const parsed = CreateWorkspaceRequestSchema.safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success) {
      return c.json(ErrorResponseSchema.parse({ error: 'name and a slug of lowercase letters, digits and single hyphens are required' }), 400);
    }
    const session = c.get('session');

    try {
      const created = await createWorkspace(deps.sql, { ownerId: session.userId, name: parsed.data.name, slug: parsed.data.slug });
      return c.json(CreateWorkspaceResponseSchema.parse(created), 201);
    } catch (error) {
      if (error instanceof PlanLimitExceededError) {
        return c.json(
          CreateWorkspaceRefusalSchema.parse({
            error: error.message,
            reason: 'plan_limit',
            planName: error.planName,
            maxWorkspaces: error.maxWorkspaces,
          }),
          403,
        );
      }
      if (error instanceof NoPlanAssignedError) {
        return c.json(CreateWorkspaceRefusalSchema.parse({ error: 'your account has no plan assigned', reason: 'no_plan' }), 403);
      }
      if (isUniqueViolation(error)) {
        return c.json(CreateWorkspaceRefusalSchema.parse({ error: 'that slug is already taken', reason: 'slug_taken' }), 409);
      }
      throw error;
    }
  });

  app.get('/workspaces/:id/members', auth, async (c) => {
    // By id or by slug (`workspace-ref.ts`): the members screen asks by the
    // slug its address carries. A ref that is neither shape names nothing
    // and gets the same answer as an id that names nothing — and never
    // reaches the uuid cast below.
    const workspaceId = await resolveWorkspaceId(deps.sql, c.req.param('id'));
    if (!workspaceId) return notFound(c);
    const session = c.get('session');

    const [workspace] = await deps.sql<{ id: string; name: string; slug: string; root_id: string }[]>`
      SELECT w.id, w.name, w.slug, n.id AS root_id
        FROM workspaces w
        JOIN live_nodes n ON n.workspace_id = w.id AND n.type = 'workspace' AND n.parent_id IS NULL
       WHERE w.id = ${workspaceId}
    `;
    if (!workspace) return notFound(c);

    const authorized = await can(deps.sql, {
      subjectType: 'user',
      subjectId: session.userId,
      resourceId: workspace.root_id,
      action: 'manage',
    });
    if (!authorized) return notFound(c);

    const [members, invitations] = await Promise.all([
      listWorkspaceMembers(deps.sql, workspace.id),
      listPendingInvitations(deps.sql, workspace.id),
    ]);

    return c.json(
      WorkspaceMembersResponseSchema.parse({
        workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
        rootNodeId: workspace.root_id,
        members,
        invitations: invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          startingGrants: invitation.startingGrants,
          createdAt: invitation.createdAt.toISOString(),
          expiresAt: invitation.expiresAt.toISOString(),
        })),
        truncated: members.length >= WORKSPACE_MEMBERS_LIMIT,
      }),
    );
  });

  return app;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}
