import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkCompose, COMPOSE_FILES, resolveInterpolatedValue } from '../compose';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__');
const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

describe('checkCompose', () => {
  test('passes for a fixture with a labelled bind mount, spec-only keys, and ports >= 1024', () => {
    const result = checkCompose(join(FIXTURES_DIR, 'compose-valid.yaml'));

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('fails when a bind mount is missing its SELinux :z label', () => {
    const result = checkCompose(join(FIXTURES_DIR, 'compose-missing-label.yaml'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes(':z') && e.includes('docker-entrypoint-initdb.d'))).toBe(true);
  });

  test('fails when a service publishes a host port below 1024', () => {
    const result = checkCompose(join(FIXTURES_DIR, 'compose-low-port.yaml'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('80') && e.includes('below 1024'))).toBe(true);
  });

  test('fails when a service declares a non-portable key such as container_name', () => {
    const result = checkCompose(join(FIXTURES_DIR, 'compose-non-spec-key.yaml'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('container_name'))).toBe(true);
  });
});

describe('resolveInterpolatedValue', () => {
  test('leaves a plain literal alone', () => {
    expect(resolveInterpolatedValue('55432')).toBe('55432');
  });

  test('reads the default out of the ${VAR:-default} and ${VAR-default} forms', () => {
    expect(resolveInterpolatedValue('${DEEPWIKI_TEST_PG_PORT:-55432}')).toBe('55432');
    expect(resolveInterpolatedValue('${DEEPWIKI_TEST_PG_PORT-55432}')).toBe('55432');
  });

  test('reports a reference with no default as unresolvable rather than guessing', () => {
    expect(resolveInterpolatedValue('${DEEPWIKI_TEST_PG_PORT}')).toBeUndefined();
    expect(resolveInterpolatedValue('$DEEPWIKI_TEST_PG_PORT')).toBeUndefined();
  });
});

describe('checkCompose — interpolated host ports', () => {
  test('checks the default behind an interpolated port instead of skipping it', () => {
    const result = checkCompose(join(FIXTURES_DIR, 'compose-interpolated-port.yaml'));

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('still catches a below-1024 port hidden behind an interpolation default', () => {
    const result = checkCompose(join(FIXTURES_DIR, 'compose-interpolated-low-port.yaml'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('80') && e.includes('below 1024'))).toBe(true);
  });

  test('refuses an interpolated port with no default, which nothing could verify', () => {
    const result = checkCompose(join(FIXTURES_DIR, 'compose-interpolated-no-default.yaml'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('FIXTURE_API_PORT') && e.includes('default'))).toBe(true);
  });
});

describe('COMPOSE_FILES', () => {
  test('covers the test-harness compose files as well as the dev stack', () => {
    expect(COMPOSE_FILES).toEqual([
      'compose.yaml',
      'packages/db/testing/compose.yaml',
      'apps/api/testing/compose.yaml',
    ]);
  });

  test('every compose file in the repository passes the check', () => {
    for (const file of COMPOSE_FILES) {
      const result = checkCompose(join(REPO_ROOT, file));
      expect({ file, ...result }).toEqual({ file, ok: true, errors: [] });
    }
  });
});
