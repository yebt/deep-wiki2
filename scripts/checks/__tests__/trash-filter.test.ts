import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { ALLOW_LIST, checkTrashFilter } from '../trash-filter';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__', 'trash-filter');

describe('checkTrashFilter', () => {
  test('passes a fixture that reads only through the live views', () => {
    const result = checkTrashFilter(join(FIXTURES_DIR, 'valid'), {});

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('fails rule 1 when a file reads the base nodes table via SQL text', () => {
    const result = checkTrashFilter(join(FIXTURES_DIR, 'violating-base-table'), {});

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('leaky.ts') && e.includes('rule 1'))).toBe(true);
  });

  test('fails rule 1 when a file reads the base nodes table through the Drizzle builder twin', () => {
    const result = checkTrashFilter(join(FIXTURES_DIR, 'violating-base-table'), {});

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('leaky-drizzle.ts') && e.includes('rule 1'))).toBe(true);
  });

  test('fails rule 2 when a page-keyed table is read without naming a live view', () => {
    const result = checkTrashFilter(join(FIXTURES_DIR, 'violating-page-keyed'), {});

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('changesets/history.ts') && e.includes('rule 2'))).toBe(true);
  });

  test('an ALLOW_LIST entry silences rule 1 for the file it names', () => {
    const result = checkTrashFilter(join(FIXTURES_DIR, 'violating-base-table'), {
      'packages/db/src/nodes/leaky.ts': 'Test-only exemption, not real.',
      'packages/db/src/nodes/leaky-drizzle.ts': 'Test-only exemption, not real.',
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('an ALLOW_LIST entry with an empty reason is an error', () => {
    const result = checkTrashFilter(join(FIXTURES_DIR, 'violating-base-table'), {
      'packages/db/src/nodes/leaky.ts': '',
      'packages/db/src/nodes/leaky-drizzle.ts': 'Test-only exemption, not real.',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('ALLOW_LIST:') && e.includes('leaky.ts') && e.includes('no reason'))).toBe(
      true,
    );
  });

  test('an ALLOW_LIST entry naming a file that does not exist is an error', () => {
    const result = checkTrashFilter(join(FIXTURES_DIR, 'valid'), {
      'packages/db/src/nodes/never-existed.ts': 'Made up for the test.',
    });

    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.startsWith('ALLOW_LIST:') && e.includes('never-existed.ts') && e.includes('no longer exists')),
    ).toBe(true);
  });

  test('a stale ALLOW_LIST entry — the file it names no longer trips either rule — is an error', () => {
    const result = checkTrashFilter(join(FIXTURES_DIR, 'stale-allow-list'), {
      'packages/db/src/nodes/fixed.ts': 'Phase 3/4 pending: task 3.x (now fixed, entry left behind on purpose for this fixture).',
      'packages/db/src/nodes/still-leaky.ts': 'Phase 3/4 pending: task 3.y (still needs its exemption).',
    });

    expect(result.ok).toBe(false);
    const staleErrors = result.errors.filter((e) => e.startsWith('ALLOW_LIST:'));
    expect(staleErrors.some((e) => e.includes('fixed.ts') && e.includes('no longer trips'))).toBe(true);
    expect(staleErrors.some((e) => e.includes('still-leaky.ts'))).toBe(false);
  });

  test('a directory ALLOW_LIST entry is exempt from both the existence and the staleness check', () => {
    const existingDirResult = checkTrashFilter(join(FIXTURES_DIR, 'valid'), {
      'packages/db/src/nodes/': 'Structural exemption for the whole directory.',
    });
    const missingDirResult = checkTrashFilter(join(FIXTURES_DIR, 'valid'), {
      'packages/db/src/trash/': 'Declared ahead of the module it names, which does not exist in this fixture either.',
    });

    expect(existingDirResult.errors.filter((e) => e.startsWith('ALLOW_LIST:'))).toEqual([]);
    expect(missingDirResult.errors.filter((e) => e.startsWith('ALLOW_LIST:'))).toEqual([]);
  });

  test('the real ALLOW_LIST has a reason for every entry', () => {
    for (const [path, reason] of Object.entries(ALLOW_LIST)) {
      expect(reason.trim().length > 0, `${path} has no reason`).toBe(true);
    }
  });
});
