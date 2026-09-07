import { createHash } from 'node:crypto';
import type { BlobStore, CredentialCipher, MailSender, PasswordHasher } from '@deep-wiki/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import postgres from 'postgres';
import { buildKeyProvider } from './adapters/ai/key-provider/build-key-provider';
import { buildCipher } from './adapters/ai/credentials/build-cipher';
import { Argon2idPasswordHasher } from './adapters/crypto/argon2id-password-hasher';
import { createBlobStore } from './adapters/blob';
import { SmtpMailSender } from './adapters/mail/smtp-mail-sender';
import { createVercelAiValidationProbe } from './ai/gateway/validation-probe';
import type { CredentialValidationProbe } from './adapters/ai/credentials/validation-probe';
import { assertKeyringComplete, loadConfig } from './config';
import { createAdminRoutes } from './routes/admin';
import { createAiCredentialRoutes } from './routes/ai-credentials';
import { createAuthRoutes } from './routes/auth';
import { createInvitationRoutes } from './routes/invitations';
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

/**
 * Every adapter `composeApp` mounts routes against. Grouped apart from
 * `AppSettings` below because these carry behaviour (a `sql` connection,
 * a cipher, a probe), not configuration values.
 */
export interface AppAdapters {
  readonly sql: postgres.Sql;
  readonly mailSender: MailSender;
  readonly passwordHasher: PasswordHasher;
  readonly blobStore: BlobStore;
  readonly smtpConfigHash: string;
  readonly cipher: CredentialCipher;
  readonly validationProbe: CredentialValidationProbe;
}

export interface AppSettings {
  readonly appUrl: string;
  readonly sessionIdleTimeoutMinutes: number;
  readonly sessionAbsoluteTimeoutDays: number;
  readonly passwordResetTtlMinutes: number;
  readonly invitationTtlDays: number;
  readonly maxUploadBytes: number;
}

/**
 * The actual composition root: every route module the repository ships
 * gets mounted here, and nowhere else. `apps/api/src/index.test.ts`
 * exercises this function through `app.request()`, not the individual
 * route factories — that is what makes an unmounted route fail a test
 * instead of only `scripts/checks/routes-mounted.ts`'s static "is the
 * factory name mentioned" check (which `admin`, `invitations`, `uploads`
 * and `ai-credentials` all satisfied while being unreachable, per
 * docs/TODO.md's 2026-09-06 Finding).
 */
export function composeApp(adapters: AppAdapters, settings: AppSettings): Hono {
  const app = createApp({ appUrl: settings.appUrl });

  app.route(
    '/',
    createAuthRoutes({
      sql: adapters.sql,
      passwordHasher: adapters.passwordHasher,
      sessionIdleTimeoutMinutes: settings.sessionIdleTimeoutMinutes,
      sessionAbsoluteTimeoutDays: settings.sessionAbsoluteTimeoutDays,
      mailSender: adapters.mailSender,
      passwordResetTtlMinutes: settings.passwordResetTtlMinutes,
      appUrl: settings.appUrl,
    }),
  );

  app.route(
    '/',
    createAdminRoutes({
      sql: adapters.sql,
      passwordHasher: adapters.passwordHasher,
      mailSender: adapters.mailSender,
      smtpConfigHash: adapters.smtpConfigHash,
      sessionIdleTimeoutMinutes: settings.sessionIdleTimeoutMinutes,
    }),
  );

  app.route(
    '/',
    createInvitationRoutes({
      sql: adapters.sql,
      passwordHasher: adapters.passwordHasher,
      mailSender: adapters.mailSender,
      appUrl: settings.appUrl,
      invitationTtlDays: settings.invitationTtlDays,
      sessionIdleTimeoutMinutes: settings.sessionIdleTimeoutMinutes,
    }),
  );

  app.route(
    '/',
    createUploadRoutes({
      sql: adapters.sql,
      blobStore: adapters.blobStore,
      sessionIdleTimeoutMinutes: settings.sessionIdleTimeoutMinutes,
      maxUploadBytes: settings.maxUploadBytes,
    }),
  );

  app.route(
    '/',
    createAiCredentialRoutes({
      sql: adapters.sql,
      cipher: adapters.cipher,
      validationProbe: adapters.validationProbe,
      sessionIdleTimeoutMinutes: settings.sessionIdleTimeoutMinutes,
    }),
  );

  return app;
}

// Config and every real adapter are only constructed (and can only fail
// fast) when this module is run as the actual server entry point — not
// merely imported, e.g. by tests exercising `app`/`composeApp` directly
// against an in-memory request.
if (import.meta.main) {
  const config = loadConfig();
  const sql = postgres(config.DATABASE_URL);

  await assertKeyringComplete(sql, config);

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
  const cipher = buildCipher(buildKeyProvider(config));
  const validationProbe = createVercelAiValidationProbe();

  const app = composeApp(
    { sql, mailSender, passwordHasher, blobStore, smtpConfigHash, cipher, validationProbe },
    {
      appUrl: config.APP_URL,
      sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES,
      sessionAbsoluteTimeoutDays: config.SESSION_ABSOLUTE_TIMEOUT_DAYS,
      passwordResetTtlMinutes: config.PASSWORD_RESET_TTL_MINUTES,
      invitationTtlDays: config.INVITATION_TTL_DAYS,
      maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
    },
  );

  console.log(`apps/api: listening on port ${config.PORT}`);
  Bun.serve({ port: config.PORT, fetch: app.fetch });
}
