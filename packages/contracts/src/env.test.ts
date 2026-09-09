import { describe, expect, test } from 'bun:test';
import { envSchema, parseEnv, refineEnv } from './env';

/**
 * Minimal environment that satisfies every unconditionally required
 * variable (Phase 1 base + Phase 1's auth/mail/blob additions), so each
 * test below only overrides the field it actually exercises.
 */
function validRawEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'development',
    PORT: '4000',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/deep_wiki',
    SMTP_HOST: 'localhost',
    MAIL_FROM: 'noreply@deep-wiki.local',
    BLOB_STORE_FS_ROOT: './.data/blobs',
    CHANGESET_WINDOW_MINUTES: '30',
    ...overrides,
  };
}

describe('parseEnv', () => {
  test('parses a valid environment into a typed object', () => {
    const result = parseEnv(validRawEnv());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.NODE_ENV).toBe('development');
      expect(result.value.PORT).toBe(4000);
      expect(result.value.DATABASE_URL).toBe('postgres://user:pass@localhost:5432/deep_wiki');
    }
  });

  test('rejects and names a missing required variable', () => {
    const result = parseEnv(validRawEnv({ DATABASE_URL: undefined }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.variable === 'DATABASE_URL')).toBe(true);
    }
  });

  test('rejects and names a malformed variable (non-numeric port)', () => {
    const result = parseEnv(validRawEnv({ PORT: 'not-a-number' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.variable === 'PORT')).toBe(true);
    }
  });

  test('defaults NODE_ENV to development when omitted', () => {
    const result = parseEnv(validRawEnv({ NODE_ENV: undefined }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.NODE_ENV).toBe('development');
    }
  });

  // document-modes: Edit Mode Acquires A Soft Lock On Entry; Heartbeat Keeps
  // The Lock Alive (design.md "The soft lock, coherent without presence").
  test('PAGE_LOCK_TTL_SECONDS and PAGE_LOCK_HEARTBEAT_SECONDS default to sane values when omitted', () => {
    const result = parseEnv(validRawEnv());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.PAGE_LOCK_TTL_SECONDS).toBe(120);
      expect(result.value.PAGE_LOCK_HEARTBEAT_SECONDS).toBe(20);
    }
  });

  test('PAGE_LOCK_TTL_SECONDS and PAGE_LOCK_HEARTBEAT_SECONDS parse an explicit override', () => {
    const result = parseEnv(validRawEnv({ PAGE_LOCK_TTL_SECONDS: '60', PAGE_LOCK_HEARTBEAT_SECONDS: '10' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.PAGE_LOCK_TTL_SECONDS).toBe(60);
      expect(result.value.PAGE_LOCK_HEARTBEAT_SECONDS).toBe(10);
    }
  });

  // changesets spec: "The Grouping Window Is One Named Constant" — no
  // `.default()` on this key, deliberately: a missing value must fail at
  // boot rather than silently falling back to a second copy of the number.
  test('CHANGESET_WINDOW_MINUTES has no default and fails fast when omitted', () => {
    const result = parseEnv(validRawEnv({ CHANGESET_WINDOW_MINUTES: undefined }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.variable === 'CHANGESET_WINDOW_MINUTES')).toBe(true);
    }
  });

  test('CHANGESET_WINDOW_MINUTES parses an explicit value', () => {
    const result = parseEnv(validRawEnv({ CHANGESET_WINDOW_MINUTES: '45' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.CHANGESET_WINDOW_MINUTES).toBe(45);
    }
  });
});

describe('envSchema stays a plain ZodObject', () => {
  test('Object.keys(envSchema.shape) keeps working (env-example.ts drift check reads it directly)', () => {
    // A `.superRefine()`/`.refine()` wrapper turns a ZodObject into a
    // ZodEffects with no `.shape`, which would make this throw instead of
    // returning an array — silently breaking scripts/checks/env-example.ts.
    const keys = Object.keys(envSchema.shape);

    expect(Array.isArray(keys)).toBe(true);
    expect(keys).toContain('DATABASE_URL');
    expect(keys).toContain('SMTP_HOST');
    expect(keys).toContain('BLOB_STORE_DRIVER');
  });
});

describe('refineEnv', () => {
  test('accepts a filesystem-driver environment with BLOB_STORE_FS_ROOT set', () => {
    const parsed = envSchema.parse(validRawEnv());
    const result = refineEnv(parsed);

    expect(result.ok).toBe(true);
  });

  test('rejects BLOB_STORE_DRIVER=s3 missing all four S3 variables', () => {
    const parsed = envSchema.parse(validRawEnv({ BLOB_STORE_DRIVER: 's3' }));
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const names = result.error.map((issue) => issue.variable);
      expect(names).toContain('BLOB_STORE_S3_ENDPOINT');
      expect(names).toContain('BLOB_STORE_S3_BUCKET');
      expect(names).toContain('BLOB_STORE_S3_ACCESS_KEY_ID');
      expect(names).toContain('BLOB_STORE_S3_SECRET_ACCESS_KEY');
    }
  });

  test('accepts BLOB_STORE_DRIVER=s3 with all four S3 variables present', () => {
    const parsed = envSchema.parse(
      validRawEnv({
        BLOB_STORE_DRIVER: 's3',
        BLOB_STORE_S3_ENDPOINT: 'http://localhost:9000',
        BLOB_STORE_S3_BUCKET: 'deep-wiki',
        BLOB_STORE_S3_ACCESS_KEY_ID: 'minioadmin',
        BLOB_STORE_S3_SECRET_ACCESS_KEY: 'minioadmin',
      }),
    );
    const result = refineEnv(parsed);

    expect(result.ok).toBe(true);
  });

  test('rejects a missing SMTP host, naming the variable', () => {
    const parsed = envSchema.parse(validRawEnv({ SMTP_HOST: undefined }));
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.variable === 'SMTP_HOST')).toBe(true);
    }
  });

  test('rejects a missing BLOB_STORE_FS_ROOT when the filesystem driver is selected, naming the variable', () => {
    const parsed = envSchema.parse(validRawEnv({ BLOB_STORE_FS_ROOT: undefined }));
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.variable === 'BLOB_STORE_FS_ROOT')).toBe(true);
    }
  });

  test('mail and S3 variables beyond the required floor stay optional (a fresh clone boots without them)', () => {
    const parsed = envSchema.parse(validRawEnv());

    expect(parsed.SMTP_PORT).toBeUndefined();
    expect(parsed.SMTP_USER).toBeUndefined();
    expect(parsed.SMTP_PASSWORD).toBeUndefined();
    expect(parsed.BLOB_STORE_S3_ENDPOINT).toBeUndefined();
  });
});

/**
 * Diagnostics, not validation. A stale `.env` that predates a variable is a
 * missing *line*, and zod's own text ("Expected number, received nan", from
 * `Number(undefined)`) sends the reader hunting for a bad value instead.
 * `packages/db/src/database-url.ts` already paid for this lesson once; these
 * hold `parseEnv` to the same standard.
 */
describe('parseEnv names the shape of the problem, not the symptom', () => {
  function messageFor(raw: Record<string, string | undefined>, variable: string): string {
    const result = parseEnv(raw);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');

    const issue = result.error.find((candidate) => candidate.variable === variable);
    expect(issue).toBeDefined();

    return issue?.message ?? '';
  }

  test('an unset number reports as unset and points at env.example — not at a type', () => {
    const message = messageFor(validRawEnv({ CHANGESET_WINDOW_MINUTES: undefined }), 'CHANGESET_WINDOW_MINUTES');

    expect(message).toContain('CHANGESET_WINDOW_MINUTES');
    expect(message).toContain('is not set');
    expect(message).toContain('env.example');
    expect(message).not.toContain('nan');
    expect(message).not.toContain('Expected number');
  });

  test('the env.example it names is the template of record, never .env.example', () => {
    const message = messageFor(validRawEnv({ CHANGESET_WINDOW_MINUTES: undefined }), 'CHANGESET_WINDOW_MINUTES');

    expect(message).not.toContain('.env.example');
  });

  test('an unset string reports as unset too, not as zod’s bare "Required"', () => {
    const message = messageFor(validRawEnv({ DATABASE_URL: undefined }), 'DATABASE_URL');

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('is not set');
    expect(message).toContain('env.example');
  });

  test('an empty assignment is distinguished from an unset one — the fix differs', () => {
    const message = messageFor(validRawEnv({ CHANGESET_WINDOW_MINUTES: '' }), 'CHANGESET_WINDOW_MINUTES');

    expect(message).toContain('no value');
    expect(message).not.toContain('is not set');
    expect(message).not.toContain('greater than 0');
  });

  test('an empty string variable is empty, not invalid', () => {
    const message = messageFor(validRawEnv({ DATABASE_URL: '' }), 'DATABASE_URL');

    expect(message).toContain('no value');
    expect(message).not.toContain('Invalid url');
  });

  test('a non-numeric value where a number is required says exactly that', () => {
    const message = messageFor(validRawEnv({ PORT: 'not-a-number' }), 'PORT');

    expect(message).toContain('PORT');
    expect(message).toContain('not numeric');
    expect(message).not.toContain('nan');
  });

  test('an unexpanded ${VAR} is named as the cause — a .env does not interpolate', () => {
    const message = messageFor(
      validRawEnv({ CHANGESET_WINDOW_MINUTES: '${CHANGESET_WINDOW}' }),
      'CHANGESET_WINDOW_MINUTES',
    );

    expect(message).toContain('interpolate');
    expect(message).not.toContain('nan');
  });

  test('a bare $VAR reference is caught too', () => {
    const message = messageFor(validRawEnv({ DATABASE_URL: '$DATABASE_URL' }), 'DATABASE_URL');

    expect(message).toContain('interpolate');
  });

  test('a value outside an enum lists the accepted values without echoing what was typed', () => {
    const message = messageFor(validRawEnv({ BLOB_STORE_DRIVER: 'minio' }), 'BLOB_STORE_DRIVER');

    expect(message).toContain('filesystem');
    expect(message).toContain('s3');
    expect(message).not.toContain('minio');
  });

  test('a still-valid numeric bound keeps zod’s own accurate complaint', () => {
    const message = messageFor(validRawEnv({ PORT: '-1' }), 'PORT');

    expect(message).toContain('PORT');
    expect(message.length).toBeGreaterThan(0);
  });

  // The mirror of database-url.test.ts's "never echoes the url, because it
  // carries a password". These variables hold credentials too.
  test('no rendered message ever echoes a value — these variables carry secrets', () => {
    const secret = 'hunter2';
    const cases: Record<string, string | undefined>[] = [
      { CHANGESET_WINDOW_MINUTES: secret },
      { CHANGESET_WINDOW_MINUTES: `\${${secret}}` },
      { DATABASE_URL: secret },
      { DATABASE_URL: `postgres://user:${secret}@localhost:notaport/db` },
      { PORT: secret },
      { BLOB_STORE_DRIVER: secret },
      { NODE_ENV: secret },
      { APP_URL: secret },
    ];

    for (const override of cases) {
      const result = parseEnv(validRawEnv(override));

      expect(result.ok).toBe(false);
      if (result.ok) continue;

      const rendered = result.error.map((issue) => `${issue.variable}: ${issue.message}`).join('\n');
      expect(rendered).not.toContain(secret);
    }
  });
});

describe('refineEnv distinguishes unset from empty as well', () => {
  test('an unset SMTP_HOST reads as unset, and still explains why it is required', () => {
    const parsed = envSchema.parse(validRawEnv({ SMTP_HOST: undefined }));
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const message = result.error.find((issue) => issue.variable === 'SMTP_HOST')?.message ?? '';
    expect(message).toContain('is not set');
    expect(message).toContain('env.example');
    expect(message).toContain('MailSender');
  });

  test('an empty SMTP_HOST reads as empty, not as unset', () => {
    const parsed = envSchema.parse(validRawEnv({ SMTP_HOST: '' }));
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const message = result.error.find((issue) => issue.variable === 'SMTP_HOST')?.message ?? '';
    expect(message).toContain('no value');
    expect(message).not.toContain('is not set');
  });

  test('a conditionally required S3 variable still names the condition', () => {
    const parsed = envSchema.parse(validRawEnv({ BLOB_STORE_DRIVER: 's3' }));
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const message = result.error.find((issue) => issue.variable === 'BLOB_STORE_S3_BUCKET')?.message ?? '';
    expect(message).toContain('is not set');
    expect(message).toContain('BLOB_STORE_DRIVER=s3');
  });
});
