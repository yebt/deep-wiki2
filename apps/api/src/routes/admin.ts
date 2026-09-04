/**
 * Registration policy: public self-registration and Super-Root-gated
 * instance settings (registration-policy spec; design.md — "Registration
 * mode"). Instance operations are authorised through a Super Root check
 * on the session's own user row, not through `can()` (design.md D11 —
 * "Super Root does not bypass `can()`; instance operations use a separate
 * check").
 *
 * Request and response shapes are validated against `@deep-wiki/contracts`
 * — the single source of truth for this route's wire shape, shared with
 * `apps/web`.
 */
import { normalizeEmail } from '@deep-wiki/core';
import type { MailSender, PasswordHasher } from '@deep-wiki/core';
import {
  ErrorResponseSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
  RegistrationDomainsRequestSchema,
  RegistrationDomainsResponseSchema,
  RegistrationModeRequestSchema,
  RegistrationModeResponseSchema,
  SmtpTestRequestSchema,
  SmtpTestResponseSchema,
} from '@deep-wiki/contracts';
import { findUserByEmail, getInstanceSettings, recordSmtpVerification, setOpenRegistrationDomains, setRegistrationMode } from '@deep-wiki/db';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface Logger {
  info(event: string, fields: Record<string, unknown>): void;
}

const consoleLogger: Logger = {
  info: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
};

export interface AdminRouteDeps {
  readonly sql: postgres.Sql;
  readonly passwordHasher: PasswordHasher;
  readonly mailSender: MailSender;
  readonly smtpConfigHash: string;
  readonly sessionIdleTimeoutMinutes: number;
  readonly logger?: Logger;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function requireSuperRoot(sql: postgres.Sql): MiddlewareHandler<{ Variables: SessionVariables }> {
  return async (c, next) => {
    const session = c.get('session');
    const [row] = await sql<{ is_super_root: boolean }[]>`SELECT is_super_root FROM users WHERE id = ${session.userId}`;
    if (!row?.is_super_root) {
      return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);
    }
    await next();
  };
}

export function createAdminRoutes(deps: AdminRouteDeps): Hono<{ Variables: SessionVariables }> {
  const logger = deps.logger ?? consoleLogger;
  const app = new Hono<{ Variables: SessionVariables }>();

  // Public self-registration — gated by the instance's registration_mode
  // and, when set, its domain allowlist.
  app.post('/auth/register', async (c) => {
    const body = await readJsonBody(c.req.raw);
    const emailField = RegisterRequestSchema.shape.email.safeParse(body.email);
    const passwordField = RegisterRequestSchema.shape.password.safeParse(body.password);
    const email = emailField.success ? normalizeEmail(emailField.data) : '';
    const password = passwordField.success ? passwordField.data : '';

    if (!email || !password) {
      return c.json(ErrorResponseSchema.parse({ error: 'email and password are required' }), 400);
    }

    const settings = await getInstanceSettings(deps.sql, deps.smtpConfigHash);
    if (settings.reverted) {
      logger.info('smtp_verification_reverted', { reason: 'SMTP configuration changed since it was last verified' });
    }

    if (settings.registrationMode === 'closed') {
      return c.json(ErrorResponseSchema.parse({ error: 'registration is closed on this instance' }), 403);
    }
    if (settings.registrationMode === 'invitation_only') {
      return c.json(ErrorResponseSchema.parse({ error: 'this instance requires an invitation to register' }), 403);
    }

    if (settings.openRegistrationDomains.length > 0) {
      const domain = email.split('@')[1] ?? '';
      if (!settings.openRegistrationDomains.includes(domain)) {
        return c.json(
          ErrorResponseSchema.parse({
            error: `registration is restricted to the following domains: ${settings.openRegistrationDomains.join(', ')}`,
          }),
          403,
        );
      }
    }

    const existing = await findUserByEmail(deps.sql, email);
    if (existing) {
      return c.json(ErrorResponseSchema.parse({ error: 'an account already exists for this email address' }), 409);
    }

    const passwordHash = await deps.passwordHasher.hash(password);
    await deps.sql`
      INSERT INTO users (email, password_hash, display_name)
      VALUES (${email}, ${passwordHash}, ${email.split('@')[0] ?? email})
    `;

    return c.json(RegisterResponseSchema.parse({ ok: true }), 201);
  });

  const admin = new Hono<{ Variables: SessionVariables }>();
  admin.use('*', sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes }));
  admin.use('*', requireSuperRoot(deps.sql));

  admin.put('/registration-mode', async (c) => {
    const body = await readJsonBody(c.req.raw);
    const modeField = RegistrationModeRequestSchema.shape.mode.safeParse(body.mode);
    if (!modeField.success) {
      return c.json(ErrorResponseSchema.parse({ error: 'mode must be one of: closed, invitation_only, open' }), 400);
    }

    const result = await setRegistrationMode(deps.sql, modeField.data, deps.smtpConfigHash);
    if (result === 'smtp_not_verified') {
      return c.json(ErrorResponseSchema.parse({ error: 'switching to open mode requires a successful SMTP test send first' }), 400);
    }

    return c.json(RegistrationModeResponseSchema.parse({ ok: true }));
  });

  admin.put('/registration-domains', async (c) => {
    const body = await readJsonBody(c.req.raw);
    const domainsField = RegistrationDomainsRequestSchema.shape.domains.safeParse(body.domains);
    if (!domainsField.success) {
      return c.json(ErrorResponseSchema.parse({ error: 'domains must be an array of strings' }), 400);
    }

    await setOpenRegistrationDomains(deps.sql, domainsField.data);
    return c.json(RegistrationDomainsResponseSchema.parse({ ok: true }));
  });

  admin.post('/smtp-test', async (c) => {
    const body = await readJsonBody(c.req.raw);
    const toField = SmtpTestRequestSchema.shape.to.safeParse(body.to);
    const to = toField.success ? toField.data : '';
    if (!to) {
      return c.json(ErrorResponseSchema.parse({ error: 'to is required' }), 400);
    }

    const result = await deps.mailSender.send({ to, subject: 'deep-wiki SMTP test', body: 'This is a test message from deep-wiki.' });
    if (!result.ok) {
      return c.json(ErrorResponseSchema.parse({ error: 'SMTP test send failed' }), 502);
    }

    await recordSmtpVerification(deps.sql, deps.smtpConfigHash);
    return c.json(SmtpTestResponseSchema.parse({ ok: true }));
  });

  app.route('/admin', admin);

  return app;
}
