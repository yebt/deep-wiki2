/**
 * Invitation lifecycle routes (invitations spec; design.md — "Ports and
 * adapters"). Creation is authorised through `can()` — the requester must
 * hold `manage` on the target workspace's root node, the same resolver
 * GATE-1 proves, not a bespoke "Workspace Admin" role check.
 *
 * **`workspaceId` is request input, and the route is not an oracle.** The
 * id comes from the body, so any caller can name any id. A caller without
 * `manage` therefore receives the same `404 not found` — same body, same
 * call site — whether the id names a real workspace or nothing at all.
 * Until 2026-09-14 the route answered 404 for a missing workspace and 403
 * for a denied one, which told anyone with a session which uuids exist
 * (the disclosure `tree.ts` and `workspaces.ts` are built to refuse).
 * `can(manage)` is still what decides; only the answer on refusal changed.
 *
 * **The mail is handed off, never awaited.** `MailDispatcher.dispatch`
 * returns `void` by design (`background-mail-dispatcher.ts`), so this
 * handler cannot make the admin's request wait on the SMTP round trip —
 * against a dead relay that is the transport's whole timeout, spent
 * inside a response that has nothing left to decide. A failed send is an
 * operator-visible `mail_dispatch_failed` line, and the pending
 * invitation is still listed on the members screen, where the admin can
 * see it was created.
 *
 * Request and response shapes are validated against `@deep-wiki/contracts`
 * — the single source of truth for this route's wire shape, shared with
 * `apps/web`.
 */
import type { PasswordHasher } from '@deep-wiki/core';
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
import { Hono, type Context } from 'hono';
import type postgres from 'postgres';
import type { MailDispatcher } from '../adapters/mail/background-mail-dispatcher';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface InvitationRouteDeps {
  readonly sql: postgres.Sql;
  readonly passwordHasher: PasswordHasher;
  /** A dispatcher, deliberately not a `MailSender`: `dispatch` returns nothing to await. */
  readonly mailDispatcher: MailDispatcher;
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

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Absence and denial of `manage` answer with this exact body, from this one call site. */
function notFound(c: Context): Response {
  return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);
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

    // A non-uuid id would make the cast below throw; it names nothing and
    // gets the same answer as an id that names nothing.
    if (!UUID_SHAPE.test(workspaceId)) return notFound(c);
    const [root] = await deps.sql<{ id: string }[]>`
      SELECT id FROM live_nodes WHERE workspace_id = ${workspaceId} AND type = 'workspace'
    `;
    if (!root) return notFound(c);

    const session = c.get('session');
    const authorized = await can(deps.sql, {
      subjectType: 'user',
      subjectId: session.userId,
      resourceId: root.id,
      action: 'manage',
    });
    if (!authorized) return notFound(c);

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
    deps.mailDispatcher.dispatch('invitation', {
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
