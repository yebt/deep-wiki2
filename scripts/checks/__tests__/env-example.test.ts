import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkEnvExample } from '../env-example';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__');
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

  test('fails when the template file does not exist', () => {
    const result = checkEnvExample(
      join(FIXTURES_DIR, 'env-example-does-not-exist', 'template.env'),
      REQUIRED_KEYS,
    );

    expect(result.ok).toBe(false);
  });
});
