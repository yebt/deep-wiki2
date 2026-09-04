/**
 * Invitation lifecycle routes (invitations spec; design.md — "Ports and
 * adapters"). Creation is authorised through `can()` — the requester must
 * hold `manage` on the target workspace's root node, the same resolver
 * GATE-1 proves, not a bespoke "Workspace Admin" role check.
 */
import type { MailSender, PasswordHasher } from '@deep-wiki/core';
import { normalizeEmail } from '@deep-wiki/core';
import { acceptInvitation, can, createInvitation } from '@deep-wiki/db';
import { Hono } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface InvitationRouteDeps {
  readonly sql: postgres.Sql;
  readonly passwordHasher: PasswordHasher;
  readonly mailSender: MailSender;
  readonly appUrl: string;
  readonly invitationTtlDays: number;
  readonly sessionIdleTimeoutMinutes: number;
}

interface StartingGrantBody {
  readonly resourceId?: unknown;
  readonly action?: unknown;
}

interface CreateInvitationBody {
  readonly workspaceId?: unknown;
  readonly email?: unknown;
  readonly startingGrants?: unknown;
}

interface AcceptInvitationBody {
  readonly token?: unknown;
  readonly password?: unknown;
  readonly displayName?: unknown;
}

async function readJsonBody<T>(request: Request): Promise<T | Record<string, never>> {
  try {
    return (await request.json()) as T;
  } catch {
    return {};
  }
}

function isValidAction(value: unknown): value is 'read' | 'comment' | 'write' | 'manage' {
  return value === 'read' || value === 'comment' || value === 'write' || value === 'manage';
}

export function createInvitationRoutes(deps: InvitationRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();

  app.post('/invitations', sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes }), async (c) => {
    const body = await readJsonBody<CreateInvitationBody>(c.req.raw);
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    const rawGrants = Array.isArray(body.startingGrants) ? (body.startingGrants as StartingGrantBody[]) : [];

    if (!workspaceId || !email || rawGrants.length === 0) {
      return c.json({ error: 'workspaceId, email, and at least one starting grant are required' }, 400);
    }
    if (!rawGrants.every((g) => typeof g.resourceId === 'string' && isValidAction(g.action))) {
      return c.json({ error: 'each starting grant needs a resourceId and a valid action' }, 400);
    }

    const [root] = await deps.sql<{ id: string }[]>`
      SELECT id FROM nodes WHERE workspace_id = ${workspaceId} AND type = 'workspace'
    `;
    if (!root) {
      return c.json({ error: 'workspace not found' }, 404);
    }

    const session = c.get('session');
    const authorized = await can(deps.sql, {
      subjectType: 'user',
      subjectId: session.userId,
      resourceId: root.id,
      action: 'manage',
    });
    if (!authorized) {
      return c.json({ error: 'forbidden' }, 403);
    }

    const startingGrants = rawGrants.map((g) => ({
      resourceId: g.resourceId as string,
      action: g.action as 'read' | 'comment' | 'write' | 'manage',
      effect: 'allow' as const,
    }));

    const { token } = await createInvitation(deps.sql, {
      workspaceId,
      email,
      startingGrants,
      ttlDays: deps.invitationTtlDays,
      invitedByUserId: session.userId,
    });

    const acceptLink = `${deps.appUrl}/invite/accept?token=${token}`;
    await deps.mailSender.send({
      to: email,
      subject: 'You have been invited to a deep-wiki workspace',
      body: `Accept your invitation: ${acceptLink}\nThis link expires in ${deps.invitationTtlDays} day(s).`,
    });

    return c.json({ ok: true }, 201);
  });

  app.post('/invitations/accept', async (c) => {
    const body = await readJsonBody<AcceptInvitationBody>(c.req.raw);
    const token = typeof body.token === 'string' ? body.token : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName : '';

    if (!token) {
      return c.json({ error: 'token is required' }, 400);
    }

    const result = await acceptInvitation(deps.sql, token, { password, displayName }, deps.passwordHasher);

    if (result.outcome !== 'ok') {
      if (result.outcome === 'invalid') {
        return c.json({ error: 'invalid invitation token' }, 400);
      }
      if (result.outcome === 'expired') {
        return c.json({ error: 'this invitation has expired' }, 410);
      }
      return c.json({ error: 'this invitation has already been accepted' }, 409);
    }

    return c.json({ ok: true, workspaceId: result.workspaceId });
  });

  return app;
}
