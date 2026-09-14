import { createHash } from 'node:crypto';
import { guardDatabaseIdentity } from '@deep-wiki/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import postgres from 'postgres';
import { Argon2idPasswordHasher } from './adapters/crypto/argon2id-password-hasher';
import { createBlobStore } from './adapters/blob';
import { BackgroundMailDispatcher } from './adapters/mail/background-mail-dispatcher';
import { SmtpMailSender } from './adapters/mail/smtp-mail-sender';
import { loadConfig } from './config';
import { InMemoryPresenceBroadcaster } from './presence/broadcaster';
import { PresenceStreamRegistry } from './presence/registry';
import { createAdminRoutes } from './routes/admin';
import { createAuthRoutes } from './routes/auth';
import { createCommentRoutes } from './routes/comments';
import { createInvitationRoutes } from './routes/invitations';
import { createLinkRoutes } from './routes/links';
import { createMentionRoutes } from './routes/mentions';
import { createDiffRoutes } from './routes/diff';
import { createPageRoutes } from './routes/pages';
import { createPresenceRoutes } from './routes/presence';
import { createRevisionRoutes } from './routes/revisions';
import { createTagRoutes } from './routes/tags';
import { createTreeRoutes } from './routes/tree';
import { createUploadRoutes } from './routes/uploads';
import { createWorkspaceRoutes } from './routes/workspaces';

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

/** How long a shutdown waits for mail already handed off to leave. */
const SHUTDOWN_MAIL_DRAIN_MS = 2_000;

// Config and every real adapter are only constructed (and can only fail
// fast) when this module is run as the actual server entry point — not
// merely imported, e.g. by tests exercising `app` directly against an
// in-memory request.
if (import.meta.main) {
  const config = loadConfig();
  // The one long-lived application client. Guarded so that the first
  // query establishes this really is deep-wiki's database: on a developer
  // machine the conventional Postgres port is often already published by
  // an unrelated project, and connecting there succeeds — it is the data
  // that comes back wrong. See packages/db/src/database-identity.ts.
  const sql = guardDatabaseIdentity(postgres(config.DATABASE_URL));

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
  // Password reset hands its mail off rather than awaiting it, so the
  // SMTP round trip never lands inside a response that must not disclose
  // whether the account exists (see `background-mail-dispatcher.ts`).
  const mailDispatcher = new BackgroundMailDispatcher(mailSender);
  const passwordHasher = new Argon2idPasswordHasher();
  const blobStore = createBlobStore(config);
  const smtpConfigHash = computeSmtpConfigHash(config);
  // Single process is the assumed topology (design.md Decision 5,
  // "Multiple API processes") — the presence route's own poll fallback is
  // what keeps correctness from depending on that assumption.
  const presenceBroadcaster = new InMemoryPresenceBroadcaster();
  const presenceStreamRegistry = new PresenceStreamRegistry();

  app.route(
    '/',
    createAuthRoutes({
      sql,
      passwordHasher,
      sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES,
      sessionAbsoluteTimeoutDays: config.SESSION_ABSOLUTE_TIMEOUT_DAYS,
      mailDispatcher,
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
      mailDispatcher,
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
      changesetWindowMinutes: config.CHANGESET_WINDOW_MINUTES,
      broadcaster: presenceBroadcaster,
    }),
  );

  app.route('/', createLinkRoutes({ sql, sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES }));
  app.route('/', createTagRoutes({ sql, sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES }));
  app.route('/', createMentionRoutes({ sql, sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES }));
  app.route('/', createWorkspaceRoutes({ sql, sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES }));
  app.route('/', createTreeRoutes({ sql, sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES }));
  app.route(
    '/',
    createCommentRoutes({
      sql,
      mailSender,
      sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES,
      changesetWindowMinutes: config.CHANGESET_WINDOW_MINUTES,
    }),
  );
  app.route(
    '/',
    createPresenceRoutes({
      sql,
      sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES,
      broadcaster: presenceBroadcaster,
      pageLockTtlSeconds: config.PAGE_LOCK_TTL_SECONDS,
      keepAliveSeconds: config.PAGE_LOCK_HEARTBEAT_SECONDS,
      registry: presenceStreamRegistry,
    }),
  );
  app.route('/', createRevisionRoutes({ sql, sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES }));
  app.route('/', createDiffRoutes({ sql, sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES }));

  console.log(`apps/api: listening on port ${config.PORT}`);
  Bun.serve({ port: config.PORT, fetch: app.fetch });

  // Termination (design.md Decision 5): a server shutdown closes every
  // open presence stream deliberately rather than leaving connections to
  // be torn down by the OS.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      presenceStreamRegistry.closeAll();
      // Mail already accepted for delivery is given a bounded moment to
      // leave; a hand-off must not become a silent drop at shutdown, and
      // an unreachable relay must not hold the process open either.
      const drained = mailDispatcher.whenIdle();
      const deadline = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_MAIL_DRAIN_MS));
      void Promise.race([drained, deadline]).then(() => process.exit(0));
    });
  }
}
