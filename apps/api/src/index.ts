import { Hono } from 'hono';
import postgres from 'postgres';
import { Argon2idPasswordHasher } from './adapters/crypto/argon2id-password-hasher';
import { SmtpMailSender } from './adapters/mail/smtp-mail-sender';
import { loadConfig } from './config';
import { createAuthRoutes } from './routes/auth';

export const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));

// Config and every real adapter are only constructed (and can only fail
// fast) when this module is run as the actual server entry point — not
// merely imported, e.g. by tests exercising `app` directly against an
// in-memory request.
if (import.meta.main) {
  const config = loadConfig();
  const sql = postgres(config.DATABASE_URL);

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

  app.route(
    '/',
    createAuthRoutes({
      sql,
      passwordHasher: new Argon2idPasswordHasher(),
      sessionIdleTimeoutMinutes: config.SESSION_IDLE_TIMEOUT_MINUTES,
      sessionAbsoluteTimeoutDays: config.SESSION_ABSOLUTE_TIMEOUT_DAYS,
      mailSender,
      passwordResetTtlMinutes: config.PASSWORD_RESET_TTL_MINUTES,
      appUrl: config.APP_URL,
    }),
  );

  console.log(`apps/api: listening on port ${config.PORT}`);
  Bun.serve({ port: config.PORT, fetch: app.fetch });
}
