import { describe, expect, test } from 'bun:test';
import { loadConfig } from './config';

function validRawEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'test',
    PORT: '4000',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/deep_wiki',
    SMTP_HOST: 'localhost',
    MAIL_FROM: 'noreply@deep-wiki.local',
    BLOB_STORE_FS_ROOT: './.data/blobs',
    CHANGESET_WINDOW_MINUTES: '30',
    ...overrides,
  };
}

describe('loadConfig', () => {
  test('loads successfully from a valid environment', () => {
    const config = loadConfig(validRawEnv());

    expect(config.PORT).toBe(4000);
    expect(config.DATABASE_URL).toBe('postgres://user:pass@localhost:5432/deep_wiki');
  });

  test('fails fast and names the missing variable', () => {
    expect(() => loadConfig(validRawEnv({ DATABASE_URL: undefined }))).toThrow(/DATABASE_URL/);
  });

  test('fails fast and names the malformed variable', () => {
    expect(() => loadConfig(validRawEnv({ PORT: 'not-a-number' }))).toThrow(/PORT/);
  });

  test('fails fast and names a missing SMTP host', () => {
    expect(() => loadConfig(validRawEnv({ SMTP_HOST: undefined }))).toThrow(/SMTP_HOST/);
  });
});

/**
 * The message the project owner actually reads. A `.env` predating a variable
 * is a missing line; the failure must say so rather than reporting the
 * `Number(undefined)` symptom ("Expected number, received nan") and sending
 * the reader off to debug a value that was never typed.
 */
describe('loadConfig renders a message that names the fix', () => {
  function messageOf(raw: Record<string, string | undefined>): string {
    try {
      loadConfig(raw);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }

    throw new Error('expected loadConfig to throw');
  }

  test('a stale .env missing CHANGESET_WINDOW_MINUTES is told to add the line', () => {
    const message = messageOf(validRawEnv({ CHANGESET_WINDOW_MINUTES: undefined }));

    expect(message).toContain('apps/api: invalid configuration');
    expect(message).toContain('CHANGESET_WINDOW_MINUTES is not set');
    expect(message).toContain('env.example');
    expect(message).not.toContain('received nan');
    expect(message).not.toContain('.env.example');
  });

  test('the variable is named once, not doubled by the renderer', () => {
    const message = messageOf(validRawEnv({ CHANGESET_WINDOW_MINUTES: undefined }));
    const occurrences = message.split('CHANGESET_WINDOW_MINUTES').length - 1;

    expect(occurrences).toBe(1);
  });

  test('the rendered failure never echoes a value, because these variables carry secrets', () => {
    const secret = 'hunter2';
    const message = messageOf(
      validRawEnv({
        DATABASE_URL: `postgres://user:${secret}@localhost:5432`.replace('5432', 'notaport'),
        BLOB_STORE_DRIVER: secret,
        CHANGESET_WINDOW_MINUTES: secret,
      }),
    );

    expect(message).not.toContain(secret);
  });
});
