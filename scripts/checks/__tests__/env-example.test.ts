import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { checkEnvExample, checkTemplateSecrets, isSecretShapedKey, parseTemplateValues } from '../env-example';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__');
const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const REQUIRED_KEYS = ['NODE_ENV', 'PORT', 'DATABASE_URL'];

describe('checkEnvExample', () => {
  test('passes when the template lists every required schema variable', () => {
    const result = checkEnvExample(
      join(FIXTURES_DIR, 'env-example-complete', 'template.env'),
      REQUIRED_KEYS,
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('fails and names the missing variable when the template drifts from the schema', () => {
    const result = checkEnvExample(
      join(FIXTURES_DIR, 'env-example-missing-var', 'template.env'),
      REQUIRED_KEYS,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('DATABASE_URL'))).toBe(true);
  });

  // `ok === false` alone does not distinguish an absent template from a
  // present one that drifted — the case directly above returns `false` too.
  // The distinction matters to whoever reads the failure: one is a missing
  // file, the other a missing line.
  test('fails when the template file does not exist, and says so rather than reporting drift', () => {
    const templatePath = join(FIXTURES_DIR, 'env-example-does-not-exist', 'template.env');
    const result = checkEnvExample(templatePath, REQUIRED_KEYS);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([`${templatePath} does not exist`]);
  });
});

// versioning-and-collaboration: a schema key carrying `.default()` must
// agree with the value env.example assigns it — today's checkEnvExample has
// no such comparison at all, so a fixture where they disagree would
// silently pass, exactly like PAGE_LOCK_TTL_SECONDS=120 agreeing with
// `.default(120)` in packages/contracts/src/env.ts today by accident,
// with nothing comparing them.
const DEFAULTS_SCHEMA = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().url(),
  SAMPLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
});

describe('checkEnvExample — defaults agreement', () => {
  test('fails when a .default() value disagrees with env.example\'s assigned value', () => {
    const result = checkEnvExample(
      join(FIXTURES_DIR, 'env-example-defaults-mismatch', 'template.env'),
      REQUIRED_KEYS,
      DEFAULTS_SCHEMA,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('SAMPLE_TIMEOUT_MINUTES'))).toBe(true);
    expect(result.errors.some((e) => e.includes('30'))).toBe(true);
    expect(result.errors.some((e) => e.includes('99'))).toBe(true);
  });

  test('passes when a .default() value agrees with env.example\'s assigned value', () => {
    const result = checkEnvExample(
      join(FIXTURES_DIR, 'env-example-defaults-agree', 'template.env'),
      REQUIRED_KEYS,
      DEFAULTS_SCHEMA,
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// CLAUDE.md: env.example "must never contain a secret". Until now that
// sentence had no mechanism behind it at all — nothing in this file
// distinguished the intended placeholder `POSTGRES_PASSWORD=deepwiki` from a
// pasted production credential. The rule below is a convention check, not a
// secret detector; see the module header for exactly what it cannot see.
describe('checkEnvExample — no secret in the committed template', () => {
  test('fails a secret-shaped key holding a value that is not an obvious placeholder', () => {
    const result = checkEnvExample(
      join(FIXTURES_DIR, 'env-example-pasted-secret', 'template.env'),
      REQUIRED_KEYS,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('POSTGRES_PASSWORD'))).toBe(true);
  });

  test('fails a credential embedded in a URL, whose key name gives nothing away', () => {
    const result = checkEnvExample(
      join(FIXTURES_DIR, 'env-example-secret-in-url', 'template.env'),
      REQUIRED_KEYS,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('DATABASE_URL'))).toBe(true);
  });

  test('fails a value shaped like a known credential under any key name', () => {
    const result = checkEnvExample(
      join(FIXTURES_DIR, 'env-example-credential-shape', 'template.env'),
      REQUIRED_KEYS,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('AI_PROVIDER_CONFIG'))).toBe(true);
  });

  test('passes every placeholder shape the real env.example uses', () => {
    const result = checkEnvExample(
      join(FIXTURES_DIR, 'env-example-placeholders', 'template.env'),
      REQUIRED_KEYS,
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('checkTemplateSecrets — the committed env.example', () => {
  test('the real env.example satisfies the placeholder convention', () => {
    const content = readFileSync(join(REPO_ROOT, 'env.example'), 'utf8');

    expect(checkTemplateSecrets(parseTemplateValues(content))).toEqual([]);
  });
});

// The line that made a match-anywhere rule wrong: PASSWORD_RESET_TTL_MINUTES
// holds the number 30, and the real env.example has held it all along.
describe('isSecretShapedKey', () => {
  test('a key whose last segment is a secret word holds a credential', () => {
    expect(isSecretShapedKey('POSTGRES_PASSWORD')).toBe(true);
    expect(isSecretShapedKey('BLOB_STORE_S3_SECRET_ACCESS_KEY')).toBe(true);
    expect(isSecretShapedKey('BLOB_STORE_S3_ACCESS_KEY_ID')).toBe(true);
  });

  test('a key that merely mentions credentials does not', () => {
    expect(isSecretShapedKey('PASSWORD_RESET_TTL_MINUTES')).toBe(false);
    expect(isSecretShapedKey('MINIO_ROOT_USER')).toBe(false);
    expect(isSecretShapedKey('MONKEY_PATCH')).toBe(false);
  });
});
