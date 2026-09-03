import { describe, expect, test } from 'bun:test';
import { loadConfig } from './config';

describe('loadConfig', () => {
  test('loads successfully from a valid environment', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PORT: '4000',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/deep_wiki',
    });

    expect(config.PORT).toBe(4000);
    expect(config.DATABASE_URL).toBe('postgres://user:pass@localhost:5432/deep_wiki');
  });

  test('fails fast and names the missing variable', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        PORT: '4000',
        // DATABASE_URL intentionally missing
      }),
    ).toThrow(/DATABASE_URL/);
  });

  test('fails fast and names the malformed variable', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        PORT: 'not-a-number',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/deep_wiki',
      }),
    ).toThrow(/PORT/);
  });
});
