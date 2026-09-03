import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkCompose } from '../compose';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__');

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
