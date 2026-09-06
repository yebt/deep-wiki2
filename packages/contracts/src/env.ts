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
  // The browser-facing origin of apps/web, not the API's own address: it is
  // the CORS allowlist entry and the host of mailed reset/invite links.
  APP_URL: z.string().url().default('http://localhost:4173'),

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

  // Envelope-encryption key provider (environment-config delta —
  // "Envelope Master Key Validated at Startup"; ai-provider-foundation
  // design.md — "Credentials: envelope encryption a self-hoster can
  // operate"). `env` is the default adapter: an operator-supplied
  // keyring read from the environment. `AI_KEK_KEYRING` is
  // `id:base64key[,id:base64key…]` — two static variable names rather
  // than one per key, so `scripts/checks/env-example.ts` (which reads
  // `Object.keys(envSchema.shape)`) still catches drift. `refineEnv()`
  // requires the keyring to parse, every key to decode to exactly 32
  // bytes, and `AI_KEK_ACTIVE_ID` to name a key present in it. `kms`
  // swaps only wrap/unwrap and requires `AI_KEK_KMS_KEY_ID` instead.
  AI_KEK_DRIVER: z.enum(['env', 'kms']).default('env'),
  AI_KEK_KEYRING: z.string().optional(),
  AI_KEK_ACTIVE_ID: z.string().optional(),
  AI_KEK_KMS_KEY_ID: z.string().optional(),
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

const KEK_LENGTH_BYTES = 32;

type ParsedKeyring = { readonly ok: true; readonly keys: ReadonlyMap<string, Uint8Array> } | { readonly ok: false; readonly message: string };

/**
 * `id:base64key[,id:base64key…]`. Every entry must parse, and every key
 * must decode to exactly 32 bytes — AES-256-GCM's key length
 * (design.md — "Credentials: envelope encryption a self-hoster can
 * operate").
 */
function parseKeyring(raw: string): ParsedKeyring {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    return { ok: false, message: 'must contain at least one id:base64key entry' };
  }

  const keys = new Map<string, Uint8Array>();

  for (const entry of entries) {
    const separatorIndex = entry.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      return { ok: false, message: `entry "${entry}" is malformed — expected id:base64key` };
    }

    const id = entry.slice(0, separatorIndex);
    const base64Key = entry.slice(separatorIndex + 1);

    let decoded: Buffer;
    try {
      decoded = Buffer.from(base64Key, 'base64');
    } catch {
      return { ok: false, message: `key "${id}" is not valid base64` };
    }

    if (decoded.length !== KEK_LENGTH_BYTES) {
      return { ok: false, message: `key "${id}" must decode to exactly ${KEK_LENGTH_BYTES} bytes, got ${decoded.length}` };
    }

    keys.set(id, decoded);
  }

  return { ok: true, keys };
}

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

  if (env.AI_KEK_DRIVER === 'env') {
    if (!env.AI_KEK_KEYRING) {
      issues.push({ variable: 'AI_KEK_KEYRING', message: 'required when AI_KEK_DRIVER=env' });
    } else {
      const parsed = parseKeyring(env.AI_KEK_KEYRING);
      if (!parsed.ok) {
        issues.push({ variable: 'AI_KEK_KEYRING', message: parsed.message });
      } else if (!env.AI_KEK_ACTIVE_ID) {
        issues.push({ variable: 'AI_KEK_ACTIVE_ID', message: 'required when AI_KEK_DRIVER=env' });
      } else if (!parsed.keys.has(env.AI_KEK_ACTIVE_ID)) {
        issues.push({
          variable: 'AI_KEK_ACTIVE_ID',
          message: `must name a key id present in AI_KEK_KEYRING (got "${env.AI_KEK_ACTIVE_ID}")`,
        });
      }
    }
  } else if (env.AI_KEK_DRIVER === 'kms') {
    if (!env.AI_KEK_KMS_KEY_ID) {
      issues.push({ variable: 'AI_KEK_KMS_KEY_ID', message: 'required when AI_KEK_DRIVER=kms' });
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
