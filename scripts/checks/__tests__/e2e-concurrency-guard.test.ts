/**
 * Two concurrency defects, each closed by a preflight run at the point
 * that can see it honestly:
 *
 * - e2e/global-setup.ts used to trust that a healthy `/health` response
 *   meant *its own* apps/api had come up. It does not: a second
 *   `bun run e2e` in the same checkout finds the derived API port already
 *   held by the first run, `waitForHealth` happily observes the FIRST
 *   run's server, and the second run overwrites `e2e/.auth-fixtures.json`
 *   and later drops its own (in-flight) seed at teardown — poisoning the
 *   run that was already going. `assertPortFree` closes this from inside
 *   `globalSetup`, before it spawns its own apps/api.
 * - `apps/web`'s dev server has the same shape of problem, but cannot be
 *   checked from `globalSetup`: Nuxt's lock is keyed by `apps/web/.nuxt`
 *   (per checkout, not per port), and Playwright starts `webServer`
 *   independently of `globalSetup` — early enough that the lock
 *   `globalSetup` would see may already be *this exact run's own*
 *   legitimate `nuxt dev`. `scripts/e2e.ts`'s `checkNuxtLock` runs before
 *   Playwright is invoked at all, the only point a live lock found there
 *   can only belong to a genuinely separate run.
 *
 * These are the pure decision functions behind both preflights, exercised
 * here with fakes so the guard itself needs neither a real socket nor a
 * real Nuxt lock file.
 */
import { describe, expect, test } from 'bun:test';
import { assertPortFree } from '../../../e2e/global-setup';
import { checkNuxtLock, isNuxtLockHeld, readNuxtLock } from '../../e2e';

describe('assertPortFree', () => {
  test('resolves without throwing when the port is free', async () => {
    await expect(assertPortFree(4321, 'apps/api', async () => true)).resolves.toBeUndefined();
  });

  test('names the port and DEEPWIKI_TEST_SLOT when the port is held', async () => {
    await expect(assertPortFree(4321, 'apps/api', async () => false)).rejects.toThrow(/4321/);
    await expect(assertPortFree(4321, 'apps/api', async () => false)).rejects.toThrow(/DEEPWIKI_TEST_SLOT/);
  });
});

describe('isNuxtLockHeld', () => {
  test('is false when there is no lock file at all', () => {
    expect(isNuxtLockHeld(undefined, Date.now(), () => true)).toBe(false);
  });

  test('is false when the recorded pid is no longer alive (a stale lock)', () => {
    expect(isNuxtLockHeld({ pid: 999_999, startedAt: Date.now() }, Date.now(), () => false)).toBe(false);
  });

  test('is false once the lock is older than 24 hours, matching Nuxt’s own staleness rule', () => {
    const twentyFiveHoursMs = 25 * 60 * 60 * 1000;
    expect(isNuxtLockHeld({ pid: 123, startedAt: Date.now() - twentyFiveHoursMs }, Date.now(), () => true)).toBe(false);
  });

  test('is true for a live, recent lock owned by another process', () => {
    expect(isNuxtLockHeld({ pid: 123, startedAt: Date.now() }, Date.now(), () => true)).toBe(true);
  });
});

describe('checkNuxtLock', () => {
  test('fails naming the pid, and says DEEPWIKI_TEST_SLOT will not help', () => {
    const result = checkNuxtLock({ pid: 555, startedAt: Date.now() }, Date.now(), () => true);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('555');
    expect(result.message).toContain('DEEPWIKI_TEST_SLOT');
  });

  test('is ok when the lock is absent', () => {
    expect(checkNuxtLock(undefined, Date.now(), () => true)).toEqual({ ok: true });
  });
});

describe('readNuxtLock', () => {
  test('parses a well-formed lock file', () => {
    expect(readNuxtLock('/fake/nuxt.lock', () => JSON.stringify({ pid: 42, startedAt: 1 }))).toEqual({
      pid: 42,
      startedAt: 1,
    });
  });

  test('returns undefined when the file is missing or unreadable', () => {
    expect(
      readNuxtLock('/fake/nuxt.lock', () => {
        throw new Error('ENOENT');
      }),
    ).toBeUndefined();
  });
});
