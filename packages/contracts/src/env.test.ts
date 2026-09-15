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
    CHANGESET_WINDOW_MINUTES: '30',
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

/**
 * `z.coerce.boolean()` is `Boolean(value)`, so every non-empty string —
 * `"false"` and `"0"` first among them — coerces to `true`. `env.example`
 * ships `SMTP_SECURE=false`, so under that coercion a fresh clone opened
 * SMTP with TLS against a local Mailpit that does not speak it. A .env
 * writes a boolean as a word; this is the reading of that word.
 */
describe('SMTP_SECURE reads the boolean a .env actually writes', () => {
  function secureFor(value: string | undefined): boolean | undefined {
    const result = parseEnv(validRawEnv({ SMTP_SECURE: value }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.map((issue) => issue.message).join('\n'));

    return result.value.SMTP_SECURE;
  }

  test('"false" is false — the value env.example ships', () => {
    expect(secureFor('false')).toBe(false);
  });

  test('"0" is false, and so is an empty assignment', () => {
    expect(secureFor('0')).toBe(false);
    expect(secureFor('')).toBe(false);
  });

  test('"true" and "1" are true', () => {
    expect(secureFor('true')).toBe(true);
    expect(secureFor('1')).toBe(true);
  });

  test('case and surrounding space do not change the answer', () => {
    expect(secureFor(' FALSE ')).toBe(false);
    expect(secureFor('True')).toBe(true);
  });

  test('an unset SMTP_SECURE stays undefined rather than becoming a silent false', () => {
    expect(secureFor(undefined)).toBeUndefined();
  });

  test('an unrecognised word is refused and the accepted words are named — never read as true', () => {
    const result = parseEnv(validRawEnv({ SMTP_SECURE: 'sometimes' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const message = result.error.find((issue) => issue.variable === 'SMTP_SECURE')?.message ?? '';
    expect(message).toContain('true');
    expect(message).toContain('false');
    expect(message).not.toContain('sometimes');
  });
});

/**
 * A port is a 16-bit number. Without an upper bound `PORT=70000` parses
 * happily and the failure surfaces later, from the socket, as something
 * else entirely.
 */
describe('the port variables are bounded by the highest TCP port', () => {
  test('PORT accepts 65535 and refuses 65536, naming the limit', () => {
    expect(parseEnv(validRawEnv({ PORT: '65535' })).ok).toBe(true);

    const result = parseEnv(validRawEnv({ PORT: '65536' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const message = result.error.find((issue) => issue.variable === 'PORT')?.message ?? '';
    expect(message).toContain('65535');
  });

  test('SMTP_PORT is bounded the same way', () => {
    expect(parseEnv(validRawEnv({ SMTP_PORT: '65535' })).ok).toBe(true);

    const result = parseEnv(validRawEnv({ SMTP_PORT: '65536' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const message = result.error.find((issue) => issue.variable === 'SMTP_PORT')?.message ?? '';
    expect(message).toContain('65535');
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

  // BLOB_STORE_FS_ROOT is cleared deliberately. With `validRawEnv()`'s value
  // left in place this fixture satisfies the filesystem branch as well, so
  // the test says nothing about an s3 deployment that never configures a
  // filesystem root at all — which is every s3 deployment. Dropping
  // refineEnv()'s driver check and requiring the root unconditionally used
  // to leave this green.
  //
  // What it does NOT pin, and cannot: the `else` in refineEnv()'s
  // `else if (BLOB_STORE_DRIVER === 'filesystem')`. BLOB_STORE_DRIVER is a
  // two-value enum, so that branch and the `s3` one above it are mutually
  // exclusive for every possible input and the `else` is redundant by
  // construction. No fixture can tell the two spellings apart.
  test('accepts BLOB_STORE_DRIVER=s3 with all four S3 variables present and no filesystem root', () => {
    const parsed = envSchema.parse(
      validRawEnv({
        BLOB_STORE_DRIVER: 's3',
        BLOB_STORE_S3_ENDPOINT: 'http://localhost:9000',
        BLOB_STORE_S3_BUCKET: 'deep-wiki',
        BLOB_STORE_S3_ACCESS_KEY_ID: 'minioadmin',
        BLOB_STORE_S3_SECRET_ACCESS_KEY: 'minioadmin',
        BLOB_STORE_FS_ROOT: undefined,
      }),
    );

    expect(parsed.BLOB_STORE_FS_ROOT).toBeUndefined();
    expect(refineEnv(parsed).ok).toBe(true);
  });

  test('rejects a missing SMTP host, naming the variable', () => {
    const parsed = envSchema.parse(validRawEnv({ SMTP_HOST: undefined }));
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.variable === 'SMTP_HOST')).toBe(true);
    }
  });

  // Deleting refineEnv()'s MAIL_FROM branch used to leave the whole suite
  // green: nothing anywhere asserted that the address mail is sent *from*
  // is required at all.
  test('rejects a missing MAIL_FROM, naming the variable and why mail cannot be switched off', () => {
    const parsed = envSchema.parse(validRawEnv({ MAIL_FROM: undefined }));
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const message = result.error.find((issue) => issue.variable === 'MAIL_FROM')?.message ?? '';
    expect(message).toContain('is not set');
    expect(message).toContain('MailSender');
  });

  test('an empty MAIL_FROM is refused too — a blank From address is not a configured one', () => {
    const parsed = envSchema.parse(validRawEnv({ MAIL_FROM: '' }));
    const result = refineEnv(parsed);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const message = result.error.find((issue) => issue.variable === 'MAIL_FROM')?.message ?? '';
    expect(message).toContain('no value');
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

  // content-and-editor design.md "The soft lock, coherent without
  // presence": a lock is held iff `heartbeat_at > now() - PAGE_LOCK_TTL_SECONDS`.
  // A heartbeat interval at or above the TTL can lapse an active editor's
  // lock between beats — the client beats every PAGE_LOCK_HEARTBEAT_SECONDS,
  // and a beat merely *below* the TTL leaves no room for the one beat that
  // arrives late from ordinary network jitter or scheduling delay. The
  // margin required here is one full missed beat's worth of slack: the TTL
  // must be at least twice the heartbeat interval.
  describe('the page-lock heartbeat must stay safely inside its own TTL', () => {
    test('rejects a heartbeat equal to the TTL — a lock could lapse between beats', () => {
      const parsed = envSchema.parse(
        validRawEnv({ PAGE_LOCK_TTL_SECONDS: '60', PAGE_LOCK_HEARTBEAT_SECONDS: '60' }),
      );
      const result = refineEnv(parsed);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((issue) => issue.variable === 'PAGE_LOCK_HEARTBEAT_SECONDS')).toBe(true);
      }
    });

    test('rejects a heartbeat above the TTL too', () => {
      const parsed = envSchema.parse(
        validRawEnv({ PAGE_LOCK_TTL_SECONDS: '30', PAGE_LOCK_HEARTBEAT_SECONDS: '45' }),
      );

      expect(refineEnv(parsed).ok).toBe(false);
    });

    test('rejects a heartbeat below the TTL with too little margin for one missed beat', () => {
      // 20s heartbeat, 30s TTL: below the TTL, but a single late beat still
      // has nowhere to land before expiry.
      const parsed = envSchema.parse(
        validRawEnv({ PAGE_LOCK_TTL_SECONDS: '30', PAGE_LOCK_HEARTBEAT_SECONDS: '20' }),
      );

      expect(refineEnv(parsed).ok).toBe(false);
    });

    test('accepts a heartbeat exactly at the required margin (TTL is twice the heartbeat)', () => {
      const parsed = envSchema.parse(
        validRawEnv({ PAGE_LOCK_TTL_SECONDS: '40', PAGE_LOCK_HEARTBEAT_SECONDS: '20' }),
      );

      expect(refineEnv(parsed).ok).toBe(true);
    });

    test('the defaults env.example ships already satisfy the margin', () => {
      const parsed = envSchema.parse(validRawEnv());

      expect(refineEnv(parsed).ok).toBe(true);
    });

    test('never echoes either configured value in the rejection message', () => {
      const parsed = envSchema.parse(
        validRawEnv({ PAGE_LOCK_TTL_SECONDS: '77', PAGE_LOCK_HEARTBEAT_SECONDS: '77' }),
      );
      const result = refineEnv(parsed);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      const message = result.error.find((issue) => issue.variable === 'PAGE_LOCK_HEARTBEAT_SECONDS')?.message ?? '';
      expect(message).not.toContain('77');
      expect(message).toContain('PAGE_LOCK_TTL_SECONDS');
      expect(message).toContain('env.example');
    });
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

  // Every message this module renders starts with the variable name, so
  // naming PORT proves nothing about *which* branch produced it. The
  // discriminating fact is that zod's own bound text survives — a
  // too_small issue is passed through verbatim rather than re-worded into
  // the value-free fallback the unrecognised codes get.
  test('a still-valid numeric bound keeps zod’s own accurate complaint, not the generic fallback', () => {
    const message = messageFor(validRawEnv({ PORT: '-1' }), 'PORT');

    expect(message).toContain('PORT');
    expect(message).toContain('greater than 0');
    expect(message).not.toContain('has a value its schema rejects');
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

  // `apps/api`'s boot error prints `issue.message` alone, as every other
  // refinement here expects (`missingVariableIssue` puts the variable in the
  // sentence). A message reading only "required when AI_KEK_DRIVER=env"
  // left an operator whose `.env` predates these variables knowing that
  // *something* was required and not what — seen on 2026-09-15, first boot
  // after the ai-provider-foundation merge.
  test('every AI_KEK refinement message names its variable and the template, like the rest of refineEnv', () => {
    const cases: Array<[Record<string, string | undefined>, string]> = [
      [{ AI_KEK_KEYRING: undefined, AI_KEK_ACTIVE_ID: 'k1' }, 'AI_KEK_KEYRING'],
      [{ AI_KEK_KEYRING: 'not-a-valid-entry', AI_KEK_ACTIVE_ID: 'k1' }, 'AI_KEK_KEYRING'],
      [{ AI_KEK_KEYRING: `k1:${VALID_KEK}`, AI_KEK_ACTIVE_ID: undefined }, 'AI_KEK_ACTIVE_ID'],
      [{ AI_KEK_KEYRING: `k1:${VALID_KEK}`, AI_KEK_ACTIVE_ID: 'k-does-not-exist' }, 'AI_KEK_ACTIVE_ID'],
      [{ AI_KEK_DRIVER: 'kms', AI_KEK_KMS_KEY_ID: undefined }, 'AI_KEK_KMS_KEY_ID'],
    ];
    for (const [overrides, variable] of cases) {
      const result = refineEnv(envSchema.parse(validRawEnv(overrides)));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const issue = result.error.find((candidate) => candidate.variable === variable);
        expect(issue?.message).toContain(variable);
        expect(issue?.message).toContain('env.example');
      }
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
