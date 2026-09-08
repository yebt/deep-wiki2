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
