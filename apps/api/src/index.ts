import { createHash } from 'node:crypto';
import type { BlobStore, CredentialCipher, MailSender, PasswordHasher, PresenceBroadcaster } from '@deep-wiki/core';
import { guardDatabaseIdentity } from '@deep-wiki/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import postgres from 'postgres';
import { buildKeyProvider } from './adapters/ai/key-provider/build-key-provider';
import { buildCipher } from './adapters/ai/credentials/build-cipher';
import type { CredentialValidationProbe } from './adapters/ai/credentials/validation-probe';
import { Argon2idPasswordHasher } from './adapters/crypto/argon2id-password-hasher';
import { createBlobStore } from './adapters/blob';
import { BackgroundMailDispatcher, type MailDispatcher } from './adapters/mail/background-mail-dispatcher';
import { SmtpMailSender } from './adapters/mail/smtp-mail-sender';
import { createVercelAiValidationProbe } from './ai/gateway/validation-probe';
import { assertKeyringComplete, loadConfig } from './config';
import { InMemoryPresenceBroadcaster } from './presence/broadcaster';
import { PresenceStreamRegistry } from './presence/registry';
import { createActivityRoutes } from './routes/activity';
import { createAdminRoutes } from './routes/admin';
import { createAiCredentialRoutes } from './routes/ai-credentials';
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
      // PATCH is what the lock heartbeat, node rename/reorder and thread
      // resolution use; a preflight answered without it blocks every one
      // of them in a real browser while `app.request()` tests stay green
      // (index.test.ts holds the preflight).
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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

/**
 * Every adapter `composeApp` mounts routes against. Grouped apart from
 * `AppSettings` below because these carry behaviour (a `sql` connection,
 * a cipher, a probe, a broadcaster), not configuration values.
 */
export interface AppAdapters {
  readonly sql: postgres.Sql;
  readonly mailSender: MailSender;
  readonly mailDispatcher: MailDispatcher;
  readonly passwordHasher: PasswordHasher;
  readonly blobStore: BlobStore;
  readonly smtpConfigHash: string;
  readonly presenceBroadcaster: PresenceBroadcaster;
  readonly presenceStreamRegistry: PresenceStreamRegistry;
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
  readonly pageLockTtlSeconds: number;
  readonly pageLockHeartbeatSeconds: number;
  readonly changesetWindowMinutes: number;
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
  const { sql, mailSender, mailDispatcher, passwordHasher, blobStore, smtpConfigHash } = adapters;
  const { presenceBroadcaster, presenceStreamRegistry, cipher, validationProbe } = adapters;
  const { sessionIdleTimeoutMinutes, changesetWindowMinutes } = settings;

  app.route(
    '/',
    createAuthRoutes({
      sql,
      passwordHasher,
      sessionIdleTimeoutMinutes,
      sessionAbsoluteTimeoutDays: settings.sessionAbsoluteTimeoutDays,
      mailDispatcher,
      passwordResetTtlMinutes: settings.passwordResetTtlMinutes,
      appUrl: settings.appUrl,
    }),
  );

  app.route(
    '/',
    createAdminRoutes({
      sql,
      passwordHasher,
      mailSender,
      smtpConfigHash,
      sessionIdleTimeoutMinutes,
    }),
  );

  app.route(
    '/',
    createInvitationRoutes({
      sql,
      passwordHasher,
      mailDispatcher,
      appUrl: settings.appUrl,
      invitationTtlDays: settings.invitationTtlDays,
      sessionIdleTimeoutMinutes,
    }),
  );

  app.route(
    '/',
    createUploadRoutes({
      sql,
      blobStore,
      sessionIdleTimeoutMinutes,
      maxUploadBytes: settings.maxUploadBytes,
    }),
  );

  app.route(
    '/',
    createPageRoutes({
      sql,
      sessionIdleTimeoutMinutes,
      pageLockTtlSeconds: settings.pageLockTtlSeconds,
      changesetWindowMinutes,
      broadcaster: presenceBroadcaster,
    }),
  );

  app.route('/', createLinkRoutes({ sql, sessionIdleTimeoutMinutes }));
  app.route('/', createTagRoutes({ sql, sessionIdleTimeoutMinutes }));
  app.route('/', createMentionRoutes({ sql, sessionIdleTimeoutMinutes }));
  app.route('/', createWorkspaceRoutes({ sql, sessionIdleTimeoutMinutes }));
  app.route('/', createTreeRoutes({ sql, sessionIdleTimeoutMinutes }));
  app.route(
    '/',
    createCommentRoutes({
      sql,
      mailSender,
      sessionIdleTimeoutMinutes,
      changesetWindowMinutes,
    }),
  );
  app.route(
    '/',
    createPresenceRoutes({
      sql,
      sessionIdleTimeoutMinutes,
      broadcaster: presenceBroadcaster,
      pageLockTtlSeconds: settings.pageLockTtlSeconds,
      keepAliveSeconds: settings.pageLockHeartbeatSeconds,
      registry: presenceStreamRegistry,
    }),
  );
  app.route('/', createRevisionRoutes({ sql, sessionIdleTimeoutMinutes }));
  app.route('/', createActivityRoutes({ sql, sessionIdleTimeoutMinutes }));
  app.route('/', createDiffRoutes({ sql, sessionIdleTimeoutMinutes }));

  app.route(
    '/',
    createAiCredentialRoutes({
      sql,
      cipher,
      validationProbe,
      sessionIdleTimeoutMinutes,
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
  // The one long-lived application client. Guarded so that the first
  // query establishes this really is deep-wiki's database: on a developer
  // machine the conventional Postgres port is often already published by
  // an unrelated project, and connecting there succeeds — it is the data
  // that comes back wrong. See packages/db/src/database-identity.ts.
  const sql = guardDatabaseIdentity(postgres(config.DATABASE_URL));

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
  const cipher = buildCipher(buildKeyProvider(config));
  const validationProbe = createVercelAiValidationProbe();

  const app = composeApp(
    {
      sql,
      mailSender,
      mailDispatcher,
      passwordHasher,
      blobStore,
      smtpConfigHash,
      presenceBroadcaster,
      presenceStreamRegistry,
      cipher,
      validationProbe,
    },
    {
      appUrl: config.APP_URL,
      sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES,
      sessionAbsoluteTimeoutDays: config.SESSION_ABSOLUTE_TIMEOUT_DAYS,
      passwordResetTtlMinutes: config.PASSWORD_RESET_TTL_MINUTES,
      invitationTtlDays: config.INVITATION_TTL_DAYS,
      maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
      pageLockTtlSeconds: config.PAGE_LOCK_TTL_SECONDS,
      pageLockHeartbeatSeconds: config.PAGE_LOCK_HEARTBEAT_SECONDS,
      changesetWindowMinutes: config.CHANGESET_WINDOW_MINUTES,
    },
  );

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
