import { err, ok, type Result } from '@deep-wiki/core';
import { z } from 'zod';

/**
 * The words a `.env` writes a boolean with. `z.coerce.boolean()` is
 * `Boolean(value)`, which reads every non-empty string as `true` — so
 * `SMTP_SECURE=false`, the line `env.example` ships, opened SMTP with TLS
 * against a local Mailpit that does not speak it. A boolean in a `.env` is
 * a word, and only these words are a boolean.
 */
const TRUE_WORDS = ['true', '1'] as const;
const FALSE_WORDS = ['false', '0'] as const;

/**
 * Anything outside those words is refused rather than guessed at. Silently
 * truthy is exactly what caused the defect above: an operator who writes
 * `SMTP_SECURE=off` should be told the word is not one this reads, at boot,
 * not discover it from a TLS handshake. An empty assignment is the one
 * exception — `SMTP_SECURE=` is an operator declining the option, and reads
 * as `false`, matching the blank `SMTP_USER=`/`SMTP_PASSWORD=` lines beside
 * it in `env.example`.
 *
 * Deliberately NOT a `z.boolean()` field with a `z.coerce`: the parse must
 * fail with a real `invalid_enum_value` issue, because that is the one zod
 * issue `describeZodIssue()` re-words into "must be one of: ..." without
 * ever echoing what was typed.
 */
function envBoolean() {
  return z
    .preprocess((raw) => {
      if (typeof raw !== 'string') return raw;
      const word = raw.trim().toLowerCase();
      return word === '' ? 'false' : word;
    }, z.enum([...TRUE_WORDS, ...FALSE_WORDS]))
    .transform((word): boolean => (TRUE_WORDS as readonly string[]).includes(word));
}

/** The highest TCP/UDP port number: a port is a 16-bit unsigned integer. */
const MAX_PORT = 65535;

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
  PORT: z.coerce.number().int().positive().max(MAX_PORT),
  DATABASE_URL: z.string().url(),

  // Public base URL, used to build links embedded in email (invitations,
  // password reset). Defaulted so most tooling never has to set it.
  // The browser-facing origin of apps/web, not the API's own address: it is
  // the CORS allowlist entry and the host of mailed reset/invite links.
  // The default must equal `devServer.port` in apps/web/nuxt.config.ts —
  // `bun run env:check` compares them. It read 4173 until 2026-09-08, which
  // is Vite's preview port and the e2e harness's main-checkout web port, and
  // was never the dev server's: the browser then dropped the session cookie
  // on every login and the user was returned to sign-in.
  APP_URL: z.string().url().default('http://localhost:3001'),

  // Session lifetime (design.md — "Authentication").
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_ABSOLUTE_TIMEOUT_DAYS: z.coerce.number().int().positive().default(30),

  // Token TTLs.
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  INVITATION_TTL_DAYS: z.coerce.number().int().positive().default(7),

  // The page soft lock (content-and-editor design.md "The soft lock,
  // coherent without presence"): a lock is held iff
  // `heartbeat_at > now() - PAGE_LOCK_TTL_SECONDS`, evaluated on read, with
  // no sweeper job and no client clock. The client heartbeats well inside
  // the TTL so an active editor's lock never lapses on its own.
  PAGE_LOCK_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  PAGE_LOCK_HEARTBEAT_SECONDS: z.coerce.number().int().positive().default(20),

  // The implicit changeset grouping window (versioning-and-collaboration
  // design.md Decision 4, changesets spec). Deliberately has NO zod
  // default: the number lives in env.example and nowhere else, so a
  // second copy is not merely discouraged — there is no second place to
  // put it. A missing value fails at boot (`parseEnv`), loudly, rather
  // than falling back to a stale duplicate.
  CHANGESET_WINDOW_MINUTES: z.coerce.number().int().positive(),

  // SMTP (mail-delivery spec). SMTP_HOST and MAIL_FROM are required by
  // `refineEnv()` unconditionally — there is no "mail disabled" mode, the
  // application always needs a MailSender for invitations and password
  // reset — but they stay `.optional()` here so `envSchema` alone (used by
  // tooling that never calls `refineEnv()`, e.g. a future non-server
  // script) does not force every caller to supply them. `env.example`
  // ships non-secret local Mailpit defaults (host/port only; Mailpit needs
  // no auth), so a fresh clone still boots with zero configuration.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(MAX_PORT).optional(),
  SMTP_SECURE: envBoolean().optional(),
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

/**
 * Diagnostics, in the spirit of `packages/db/src/database-url.ts`.
 *
 * zod reports the symptom it can see, which for an environment variable is
 * routinely the wrong story: `z.coerce.number()` turns an *unset* variable
 * into `NaN`, so the reader is told "Expected number, received nan" and goes
 * looking for a bad value that was never typed. The fix for an unset variable
 * is a missing line; the fix for an empty one is a missing value; the fix for
 * a `${...}` placeholder is understanding that a `.env` never interpolates.
 * Those are three different actions, so they get three different sentences.
 *
 * The template of record is the repository root's `env.example` (never
 * `.env.example`), which `scripts/checks/env-example.ts` keeps in step with
 * this schema — so pointing at it is always pointing at a current line.
 *
 * NOTHING here may echo a value. These variables hold `DATABASE_URL`'s
 * password, `SMTP_PASSWORD` and `BLOB_STORE_S3_SECRET_ACCESS_KEY`, and an
 * error message travels into logs and issue reports.
 */
const TEMPLATE = 'env.example at the repository root';

/** `${FOO}` in any case, or a bare `$FOO` in the shouting case a .env uses. */
const UNEXPANDED_REFERENCE = /\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Z_][A-Z0-9_]*/;

/**
 * The recognisable shapes a raw value takes when it is wrong for reasons the
 * schema cannot articulate. Returns `undefined` when the value has no such
 * shape, leaving the caller to say something more specific.
 */
function describeEnvValue(
  variable: string,
  raw: string | undefined,
  expectsNumber: boolean,
): string | undefined {
  if (raw === undefined) {
    return (
      `${variable} is not set: your .env has no line for it. Add one — copy that line from ` +
      `${TEMPLATE}, which is the template of record.`
    );
  }

  const value = raw.trim();

  if (value === '') {
    return (
      `${variable} is present but carries no value: the line is there and the right-hand side ` +
      `is blank — it needs a value, not a new line. ${TEMPLATE} shows the expected form.`
    );
  }

  if (UNEXPANDED_REFERENCE.test(value)) {
    return (
      `${variable} still contains an unexpanded variable reference. A .env does not interpolate: ` +
      `the text reaches the process literally, so the placeholder never becomes a value. Write ` +
      `the value out literally, the way ${TEMPLATE} does.`
    );
  }

  if (expectsNumber && !Number.isFinite(Number(value))) {
    return `${variable} must be a number, and the value your .env gives it is not numeric. ${TEMPLATE} shows the expected form.`;
  }

  return undefined;
}

/** Strips `.default()`/`.optional()`/`.nullable()` down to the field's real type. */
function unwrapField(field: z.ZodTypeAny): z.ZodTypeAny {
  if (field instanceof z.ZodDefault) return unwrapField(field.removeDefault() as z.ZodTypeAny);
  if (field instanceof z.ZodOptional || field instanceof z.ZodNullable) {
    return unwrapField(field.unwrap() as z.ZodTypeAny);
  }
  return field;
}

/** Derived from the schema, so a variable that becomes numeric never needs a second edit here. */
const NUMERIC_VARIABLES: ReadonlySet<string> = new Set(
  Object.entries(envSchema.shape)
    .filter(([, field]) => unwrapField(field as z.ZodTypeAny) instanceof z.ZodNumber)
    .map(([variable]) => variable),
);

/**
 * zod issue codes whose rendered message is built from the *schema* (bounds,
 * expected types, validator names) and therefore cannot contain the value.
 * Anything outside this set — `invalid_enum_value` most of all, which prints
 * `received '<value>'` — is re-worded here rather than passed through.
 */
const VALUE_FREE_ZOD_CODES: ReadonlySet<string> = new Set([
  z.ZodIssueCode.invalid_type,
  z.ZodIssueCode.invalid_string,
  z.ZodIssueCode.invalid_date,
  z.ZodIssueCode.too_small,
  z.ZodIssueCode.too_big,
  z.ZodIssueCode.not_finite,
]);

function describeZodIssue(variable: string, raw: string | undefined, issue: z.ZodIssue): string {
  const shape = describeEnvValue(variable, raw, NUMERIC_VARIABLES.has(variable));
  if (shape !== undefined) return shape;

  if (issue.code === z.ZodIssueCode.invalid_enum_value) {
    return `${variable} must be one of: ${issue.options.join(', ')}. ${TEMPLATE} shows the expected form.`;
  }

  if (VALUE_FREE_ZOD_CODES.has(issue.code)) {
    return `${variable}: ${issue.message}`;
  }

  return `${variable} has a value its schema rejects. ${TEMPLATE} shows the expected form.`;
}

/**
 * A conditionally required variable gets the same shape sentence as a
 * schema-required one, followed by the reason it is required at all — which
 * is the part `envSchema` alone cannot express.
 */
function missingVariableIssue(variable: string, value: string | undefined, reason: string): EnvIssue {
  const shape =
    describeEnvValue(variable, value, NUMERIC_VARIABLES.has(variable)) ??
    `${variable} has no usable value. ${TEMPLATE} shows the expected form.`;

  return { variable, message: `${shape} ${reason}` };
}

const AI_KEK_ENV_REASON =
  'It is required when AI_KEK_DRIVER=env (the default): workspace AI credentials are wrapped under this key.';

const MAIL_REASON =
  'The application always needs a MailSender for invitations and password reset, so there is no "mail disabled" mode.';

const REQUIRED_S3_VARS = [
  'BLOB_STORE_S3_ENDPOINT',
  'BLOB_STORE_S3_BUCKET',
  'BLOB_STORE_S3_ACCESS_KEY_ID',
  'BLOB_STORE_S3_SECRET_ACCESS_KEY',
] as const satisfies readonly (keyof Env)[];

const KEK_LENGTH_BYTES = 32;

export type ParsedKeyring =
  | { readonly ok: true; readonly keys: ReadonlyMap<string, Uint8Array> }
  | { readonly ok: false; readonly message: string };

/**
 * `id:base64key[,id:base64key…]`. Every entry must parse, and every key
 * must decode to exactly 32 bytes — AES-256-GCM's key length
 * (design.md — "Credentials: envelope encryption a self-hoster can
 * operate"). Exported so `apps/api`'s `EnvKeyProvider` adapter (Phase 7)
 * builds its runtime keyring from the same parser `refineEnv()` already
 * validated against at startup, rather than a second implementation.
 */
export function parseKeyring(raw: string): ParsedKeyring {
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
    issues.push(missingVariableIssue('SMTP_HOST', env.SMTP_HOST, MAIL_REASON));
  }
  if (!env.MAIL_FROM) {
    issues.push(missingVariableIssue('MAIL_FROM', env.MAIL_FROM, MAIL_REASON));
  }

  if (env.BLOB_STORE_DRIVER === 's3') {
    for (const variable of REQUIRED_S3_VARS) {
      if (!env[variable]) {
        issues.push(missingVariableIssue(variable, env[variable], 'It is required when BLOB_STORE_DRIVER=s3.'));
      }
    }
  } else if (env.BLOB_STORE_DRIVER === 'filesystem') {
    if (!env.BLOB_STORE_FS_ROOT) {
      issues.push(
        missingVariableIssue(
          'BLOB_STORE_FS_ROOT',
          env.BLOB_STORE_FS_ROOT,
          'It is required when BLOB_STORE_DRIVER=filesystem.',
        ),
      );
    }
  }

  // The page soft lock is held iff `heartbeat_at > now() - PAGE_LOCK_TTL_SECONDS`
  // (packages/db/src/locks/page-lock.ts), evaluated fresh on every read, with
  // no sweeper and no client clock. A heartbeat at or above the TTL can
  // therefore lapse an active editor's lock between beats — and a heartbeat
  // merely *below* the TTL is not enough margin either: the client heartbeats
  // every PAGE_LOCK_HEARTBEAT_SECONDS, and one beat arriving late — ordinary
  // network jitter, a slow event loop, a backgrounded tab waking up — must
  // still land inside the window. Requiring the TTL to be at least twice the
  // heartbeat interval gives a held lock the slack of one entire missed beat
  // before it can expire out from under an editor who is still there.
  if (env.PAGE_LOCK_TTL_SECONDS < env.PAGE_LOCK_HEARTBEAT_SECONDS * 2) {
    issues.push({
      variable: 'PAGE_LOCK_HEARTBEAT_SECONDS',
      message:
        'PAGE_LOCK_HEARTBEAT_SECONDS is too close to PAGE_LOCK_TTL_SECONDS: PAGE_LOCK_TTL_SECONDS must be at ' +
        'least twice PAGE_LOCK_HEARTBEAT_SECONDS, or a single late heartbeat — ordinary network jitter, not a ' +
        `bug — can let an active editor's lock lapse. ${TEMPLATE} shows values that satisfy this.`,
    });
  }

  // Same sentence shape as the SMTP and S3 refinements above: the variable
  // is in the message, because `apps/api`'s boot error prints the message
  // alone. "required when AI_KEK_DRIVER=env" on its own told an operator
  // that something was required and not what (2026-09-15).
  if (env.AI_KEK_DRIVER === 'env') {
    if (!env.AI_KEK_KEYRING) {
      issues.push(missingVariableIssue('AI_KEK_KEYRING', env.AI_KEK_KEYRING, AI_KEK_ENV_REASON));
    } else {
      const parsed = parseKeyring(env.AI_KEK_KEYRING);
      if (!parsed.ok) {
        issues.push({
          variable: 'AI_KEK_KEYRING',
          message: `AI_KEK_KEYRING ${parsed.message}. ${TEMPLATE} shows the expected form.`,
        });
      } else if (!env.AI_KEK_ACTIVE_ID) {
        issues.push(missingVariableIssue('AI_KEK_ACTIVE_ID', env.AI_KEK_ACTIVE_ID, AI_KEK_ENV_REASON));
      } else if (!parsed.keys.has(env.AI_KEK_ACTIVE_ID)) {
        issues.push({
          variable: 'AI_KEK_ACTIVE_ID',
          message:
            `AI_KEK_ACTIVE_ID must name a key id present in AI_KEK_KEYRING (got "${env.AI_KEK_ACTIVE_ID}"). ` +
            `${TEMPLATE} shows the expected form.`,
        });
      }
    }
  } else if (env.AI_KEK_DRIVER === 'kms') {
    if (!env.AI_KEK_KMS_KEY_ID) {
      issues.push(
        missingVariableIssue('AI_KEK_KMS_KEY_ID', env.AI_KEK_KMS_KEY_ID, 'It is required when AI_KEK_DRIVER=kms.'),
      );
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
    const issues: EnvIssue[] = parsed.error.issues.map((issue) => {
      const variable = issue.path.join('.');
      if (variable === '') return { variable: '(root)', message: issue.message };

      return { variable, message: describeZodIssue(variable, raw[variable], issue) };
    });

    return err(issues);
  }

  return refineEnv(parsed.data);
}
