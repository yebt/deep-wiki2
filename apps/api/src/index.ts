import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import postgres from 'postgres';
import { Argon2idPasswordHasher } from './adapters/crypto/argon2id-password-hasher';
import { createBlobStore } from './adapters/blob';
import { SmtpMailSender } from './adapters/mail/smtp-mail-sender';
import { loadConfig } from './config';
import { createAdminRoutes } from './routes/admin';
import { createAuthRoutes } from './routes/auth';
import { createInvitationRoutes } from './routes/invitations';
import { createPageRoutes } from './routes/pages';
import { createUploadRoutes } from './routes/uploads';

/**
 * Builds the application with CORS installed **before** any route.
 *
 * Hono applies `app.use()` middleware only to routes registered after it.
 * `/health` used to be registered at module scope while the CORS middleware
 * was installed later inside the entry-point block, so `/health` answered
 * 200 with no `Access-Control-Allow-Origin` and the browser refused to read
 * it — while every other route, registered after the middleware, worked.
 * Building the app in one place makes that ordering impossible to get wrong
 * silently, and testable: see index.test.ts.
 *
 * apps/web and apps/api are served from different origins in every
 * environment (different ports in dev, different hosts in production). A
 * session cookie only reaches the browser's request if the API opts that
 * exact origin into CORS with credentials — a wildcard origin cannot carry
 * `Access-Control-Allow-Credentials`.
 */
export function createApp(options: { readonly appUrl: string }): Hono {
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: options.appUrl,
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

  app.get('/health', (c) => c.json({ status: 'ok' }));

  return app;
}

/** Reconciliation key for `instance_settings.smtp_config_hash` — changing
 * any of these values must revert a previously-verified `open` mode
 * (registration-policy spec; design.md — "Registration mode"). Never
 * logged or exposed: it is a hash of configuration, including the SMTP
 * password, never the values themselves. */
function computeSmtpConfigHash(env: {
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: boolean;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify([env.SMTP_HOST, env.SMTP_PORT, env.SMTP_SECURE, env.SMTP_USER, env.SMTP_PASSWORD]))
    .digest('hex');
}

const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Config and every real adapter are only constructed (and can only fail
// fast) when this module is run as the actual server entry point — not
// merely imported, e.g. by tests exercising `app` directly against an
// in-memory request.
if (import.meta.main) {
  const config = loadConfig();
  const sql = postgres(config.DATABASE_URL);

  const app = createApp({ appUrl: config.APP_URL });

  // `refineEnv()` (packages/contracts) already guarantees these are set —
  // `loadConfig()` above would have thrown otherwise.
  const mailSender = new SmtpMailSender({
    host: config.SMTP_HOST!,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    user: config.SMTP_USER,
    password: config.SMTP_PASSWORD,
    from: config.MAIL_FROM!,
  });
  const passwordHasher = new Argon2idPasswordHasher();
  const blobStore = createBlobStore(config);
  const smtpConfigHash = computeSmtpConfigHash(config);

  app.route(
    '/',
    createAuthRoutes({
      sql,
      passwordHasher,
      sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES,
      sessionAbsoluteTimeoutDays: config.SESSION_ABSOLUTE_TIMEOUT_DAYS,
      mailSender,
      passwordResetTtlMinutes: config.PASSWORD_RESET_TTL_MINUTES,
      appUrl: config.APP_URL,
    }),
  );

  app.route(
    '/',
    createAdminRoutes({
      sql,
      passwordHasher,
      mailSender,
      smtpConfigHash,
      sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES,
    }),
  );

  app.route(
    '/',
    createInvitationRoutes({
      sql,
      passwordHasher,
      mailSender,
      appUrl: config.APP_URL,
      invitationTtlDays: config.INVITATION_TTL_DAYS,
      sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES,
    }),
  );

  app.route(
    '/',
    createUploadRoutes({
      sql,
      blobStore,
      sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES,
      maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
    }),
  );

  app.route(
    '/',
    createPageRoutes({
      sql,
      sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES,
      pageLockTtlSeconds: config.PAGE_LOCK_TTL_SECONDS,
    }),
  );

  console.log(`apps/api: listening on port ${config.PORT}`);
  Bun.serve({ port: config.PORT, fetch: app.fetch });
}
