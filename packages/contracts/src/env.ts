import { err, ok, type Result } from '@deep-wiki/core';
import { z } from 'zod';

/**
 * Single source of truth for server-side environment variables. Every
 * variable declared here MUST also appear in the repository root's
 * `env.example` (enforced by `scripts/checks/env-example.ts`), which is
 * copied to `.env` for local use.
 *
 * `envSchema` MUST stay a plain `ZodObject`. Wrapping it in
 * `.superRefine()`/`.refine()` turns it into a `ZodEffects`, which has no
 * `.shape` — `scripts/checks/env-example.ts` reads
 * `Object.keys(envSchema.shape)` directly, so that would silently break
 * the drift check. Conditional validation lives in `refineEnv()` below,
 * called by `parseEnv()` *after* the object parse. Any future task adding
 * conditional env validation MUST follow this same pattern.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().url(),

  // Public base URL, used to build links embedded in email (invitations,
  // password reset). Defaulted so most tooling never has to set it.
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Session lifetime (design.md — "Authentication").
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_ABSOLUTE_TIMEOUT_DAYS: z.coerce.number().int().positive().default(30),

  // Token TTLs.
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  INVITATION_TTL_DAYS: z.coerce.number().int().positive().default(7),

  // SMTP (mail-delivery spec). SMTP_HOST and MAIL_FROM are required by
  // `refineEnv()` unconditionally — there is no "mail disabled" mode, the
  // application always needs a MailSender for invitations and password
  // reset — but they stay `.optional()` here so `envSchema` alone (used by
  // tooling that never calls `refineEnv()`, e.g. a future non-server
  // script) does not force every caller to supply them. `env.example`
  // ships non-secret local Mailpit defaults (host/port only; Mailpit needs
  // no auth), so a fresh clone still boots with zero configuration.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z.coerce.boolean().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  // BlobStore selection (blob-storage spec). Filesystem is the default so
  // a self-hoster who never touches these variables still boots; the S3
  // variables stay fully optional and are required by `refineEnv()` only
  // when `BLOB_STORE_DRIVER=s3` is explicitly selected.
  BLOB_STORE_DRIVER: z.enum(['s3', 'filesystem']).default('filesystem'),
  BLOB_STORE_S3_ENDPOINT: z.string().optional(),
  BLOB_STORE_S3_REGION: z.string().default('us-east-1'),
  BLOB_STORE_S3_BUCKET: z.string().optional(),
  BLOB_STORE_S3_ACCESS_KEY_ID: z.string().optional(),
  BLOB_STORE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  BLOB_STORE_FS_ROOT: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export interface EnvIssue {
  readonly variable: string;
  readonly message: string;
}

const REQUIRED_S3_VARS = [
  'BLOB_STORE_S3_ENDPOINT',
  'BLOB_STORE_S3_BUCKET',
  'BLOB_STORE_S3_ACCESS_KEY_ID',
  'BLOB_STORE_S3_SECRET_ACCESS_KEY',
] as const satisfies readonly (keyof Env)[];

/**
 * Conditional validation that cannot live on `envSchema` itself (see the
 * module doc comment). Runs after a successful `envSchema` parse.
 */
export function refineEnv(env: Env): Result<Env, EnvIssue[]> {
  const issues: EnvIssue[] = [];

  if (!env.SMTP_HOST) {
    issues.push({ variable: 'SMTP_HOST', message: 'required — the application always needs a MailSender' });
  }
  if (!env.MAIL_FROM) {
    issues.push({ variable: 'MAIL_FROM', message: 'required — the application always needs a MailSender' });
  }

  if (env.BLOB_STORE_DRIVER === 's3') {
    for (const variable of REQUIRED_S3_VARS) {
      if (!env[variable]) {
        issues.push({ variable, message: 'required when BLOB_STORE_DRIVER=s3' });
      }
    }
  } else if (env.BLOB_STORE_DRIVER === 'filesystem') {
    if (!env.BLOB_STORE_FS_ROOT) {
      issues.push({ variable: 'BLOB_STORE_FS_ROOT', message: 'required when BLOB_STORE_DRIVER=filesystem' });
    }
  }

  if (issues.length > 0) {
    return err(issues);
  }

  return ok(env);
}

export function parseEnv(raw: Record<string, string | undefined>): Result<Env, EnvIssue[]> {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const issues: EnvIssue[] = parsed.error.issues.map((issue) => ({
      variable: issue.path.join('.') || '(root)',
      message: issue.message,
    }));

    return err(issues);
  }

  return refineEnv(parsed.data);
}
