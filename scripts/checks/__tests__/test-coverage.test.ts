import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkMemberCoverage } from '../test-coverage';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__');

describe('checkMemberCoverage', () => {
  test('reports failing coverage for a zero-assertion placeholder test file', () => {
    const result = checkMemberCoverage(join(FIXTURES_DIR, 'placeholder-test'));

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no real assertions/i);
  });

  test('passes for a member with at least one real assertion', () => {
    const result = checkMemberCoverage(join(FIXTURES_DIR, 'covered-test'));

    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('fails for a member with no test files at all', () => {
    const result = checkMemberCoverage(join(FIXTURES_DIR, 'no-tests'));

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no test files/i);
  });
});
