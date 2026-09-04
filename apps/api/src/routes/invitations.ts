/**
 * Invitation lifecycle routes (invitations spec; design.md — "Ports and
 * adapters"). Creation is authorised through `can()` — the requester must
 * hold `manage` on the target workspace's root node, the same resolver
 * GATE-1 proves, not a bespoke "Workspace Admin" role check.
 *
 * Request and response shapes are validated against `@deep-wiki/contracts`
 * — the single source of truth for this route's wire shape, shared with
 * `apps/web`.
 */
import type { MailSender, PasswordHasher } from '@deep-wiki/core';
import { normalizeEmail } from '@deep-wiki/core';
import {
  AcceptInvitationRequestSchema,
  AcceptInvitationResponseSchema,
  CreateInvitationRequestSchema,
  CreateInvitationResponseSchema,
  ErrorResponseSchema,
  StartingGrantSchema,
} from '@deep-wiki/contracts';
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

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function createInvitationRoutes(deps: InvitationRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();

  app.post('/invitations', sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes }), async (c) => {
    const body = await readJsonBody(c.req.raw);
    const workspaceIdField = CreateInvitationRequestSchema.shape.workspaceId.safeParse(body.workspaceId);
    const emailField = CreateInvitationRequestSchema.shape.email.safeParse(body.email);
    const workspaceId = workspaceIdField.success ? workspaceIdField.data : '';
    const email = emailField.success ? normalizeEmail(emailField.data) : '';
    const rawGrants = Array.isArray(body.startingGrants) ? body.startingGrants : [];

    if (!workspaceId || !email || rawGrants.length === 0) {
      return c.json(ErrorResponseSchema.parse({ error: 'workspaceId, email, and at least one starting grant are required' }), 400);
    }
    const grantsField = StartingGrantSchema.array().safeParse(rawGrants);
    if (!grantsField.success) {
      return c.json(ErrorResponseSchema.parse({ error: 'each starting grant needs a resourceId and a valid action' }), 400);
    }

    const [root] = await deps.sql<{ id: string }[]>`
      SELECT id FROM nodes WHERE workspace_id = ${workspaceId} AND type = 'workspace'
    `;
    if (!root) {
      return c.json(ErrorResponseSchema.parse({ error: 'workspace not found' }), 404);
    }

    const session = c.get('session');
    const authorized = await can(deps.sql, {
      subjectType: 'user',
      subjectId: session.userId,
      resourceId: root.id,
      action: 'manage',
    });
    if (!authorized) {
      return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);
    }

    const startingGrants = grantsField.data.map((g) => ({
      resourceId: g.resourceId,
      action: g.action,
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

    return c.json(CreateInvitationResponseSchema.parse({ ok: true }), 201);
  });

  app.post('/invitations/accept', async (c) => {
    const body = await readJsonBody(c.req.raw);
    const tokenField = AcceptInvitationRequestSchema.shape.token.safeParse(body.token);
    const passwordField = AcceptInvitationRequestSchema.shape.password.safeParse(body.password);
    const displayNameField = AcceptInvitationRequestSchema.shape.displayName.safeParse(body.displayName);
    const token = tokenField.success ? tokenField.data : '';
    const password = passwordField.success ? passwordField.data : '';
    const displayName = displayNameField.success ? displayNameField.data : '';

    if (!token) {
      return c.json(ErrorResponseSchema.parse({ error: 'token is required' }), 400);
    }

    const result = await acceptInvitation(deps.sql, token, { password, displayName }, deps.passwordHasher);

    if (result.outcome !== 'ok') {
      if (result.outcome === 'invalid') {
        return c.json(ErrorResponseSchema.parse({ error: 'invalid invitation token' }), 400);
      }
      if (result.outcome === 'expired') {
        return c.json(ErrorResponseSchema.parse({ error: 'this invitation has expired' }), 410);
      }
      return c.json(ErrorResponseSchema.parse({ error: 'this invitation has already been accepted' }), 409);
    }

    return c.json(AcceptInvitationResponseSchema.parse({ ok: true, workspaceId: result.workspaceId }));
  });

  return app;
}
