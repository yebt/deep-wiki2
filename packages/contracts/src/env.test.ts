import { describe, expect, test } from 'bun:test';
import { envSchema, parseEnv, refineEnv } from './env';

// A 32-byte key, base64-encoded (Buffer.alloc(32, 7).toString('base64')),
// reused across the base fixture below and the AI_KEK-specific tests.
const DEFAULT_KEK = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';

/**
 * Minimal environment that satisfies every unconditionally required
 * variable (Phase 1 base + Phase 1's auth/mail/blob additions, plus the
 * default AI_KEK_DRIVER=env keyring), so each test below only overrides
 * the field it actually exercises.
 */
function validRawEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'development',
    PORT: '4000',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/deep_wiki',
    SMTP_HOST: 'localhost',
    MAIL_FROM: 'noreply@deep-wiki.local',
    BLOB_STORE_FS_ROOT: './.data/blobs',
    AI_KEK_KEYRING: `k1:${DEFAULT_KEK}`,
    AI_KEK_ACTIVE_ID: 'k1',
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

const VALID_KEK = DEFAULT_KEK;
// A 16-byte key, base64-encoded — the wrong length.
const WRONG_LENGTH_KEK = 'AQEBAQEBAQEBAQEBAQEBAQ==';

describe('refineEnv — AI_KEK envelope master key (environment-config delta)', () => {
  test('accepts a well-formed keyring with the active id present in it', () => {
    const parsed = envSchema.parse(
      validRawEnv({ AI_KEK_DRIVER: 'env', AI_KEK_KEYRING: `k1:${VALID_KEK}`, AI_KEK_ACTIVE_ID: 'k1' }),
    );
    const result = refineEnv(parsed);

    expect(result.ok).toBe(true);
  });

  test('accepts a keyring with multiple keys, naming any of them active', () => {
    const parsed = envSchema.parse(
      validRawEnv({
        AI_KEK_DRIVER: 'env',
        AI_KEK_KEYRING: `k1:${VALID_KEK},k2:${VALID_KEK}`,
        AI_KEK_ACTIVE_ID: 'k2',
      }),
    );
    const result = refineEnv(parsed);

    expect(result.ok).toBe(true);
  });

  test('rejects a missing AI_KEK_KEYRING under the default env driver, naming the variable', () => {
    const parsed = envSchema.parse(validRawEnv({ AI_KEK_KEYRING: undefined, AI_KEK_ACTIVE_ID: 'k1' }));
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.variable === 'AI_KEK_KEYRING')).toBe(true);
    }
  });

  test('rejects a malformed AI_KEK_KEYRING entry (no id:base64key shape)', () => {
    const parsed = envSchema.parse(
      validRawEnv({ AI_KEK_KEYRING: 'not-a-valid-entry', AI_KEK_ACTIVE_ID: 'k1' }),
    );
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.variable === 'AI_KEK_KEYRING')).toBe(true);
    }
  });

  test('rejects a key that does not decode to exactly 32 bytes', () => {
    const parsed = envSchema.parse(
      validRawEnv({ AI_KEK_KEYRING: `k1:${WRONG_LENGTH_KEK}`, AI_KEK_ACTIVE_ID: 'k1' }),
    );
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.variable === 'AI_KEK_KEYRING')).toBe(true);
    }
  });

  test('rejects AI_KEK_ACTIVE_ID absent from the keyring', () => {
    const parsed = envSchema.parse(
      validRawEnv({ AI_KEK_KEYRING: `k1:${VALID_KEK}`, AI_KEK_ACTIVE_ID: 'k-does-not-exist' }),
    );
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.variable === 'AI_KEK_ACTIVE_ID')).toBe(true);
    }
  });

  test('rejects a missing AI_KEK_ACTIVE_ID even when the keyring parses', () => {
    const parsed = envSchema.parse(validRawEnv({ AI_KEK_KEYRING: `k1:${VALID_KEK}`, AI_KEK_ACTIVE_ID: undefined }));
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.variable === 'AI_KEK_ACTIVE_ID')).toBe(true);
    }
  });

  test('rejects a missing AI_KEK_KMS_KEY_ID when AI_KEK_DRIVER=kms', () => {
    const parsed = envSchema.parse(validRawEnv({ AI_KEK_DRIVER: 'kms' }));
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.variable === 'AI_KEK_KMS_KEY_ID')).toBe(true);
    }
  });

  test('accepts AI_KEK_DRIVER=kms with AI_KEK_KMS_KEY_ID present', () => {
    const parsed = envSchema.parse(validRawEnv({ AI_KEK_DRIVER: 'kms', AI_KEK_KMS_KEY_ID: 'projects/x/keyRings/y/cryptoKeys/z' }));
    const result = refineEnv(parsed);

    expect(result.ok).toBe(true);
  });
});
