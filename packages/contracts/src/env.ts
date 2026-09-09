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

const MAIL_REASON =
  'The application always needs a MailSender for invitations and password reset, so there is no "mail disabled" mode.';

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
