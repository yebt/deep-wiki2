import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { httpStatusOf, responseBodyOf, serverResponded } from './fetch-error';

/**
 * ── The trap these tests exist to close ────────────────────────────────
 *
 * An error built as `new Error('boom')`, or as `{ response: { status:
 * 500 } }`, does not exercise this module's reason for existing. Both are
 * classified correctly even by a guard that only asks `'response' in
 * error`. The failure mode that broke four screens needs ofetch's real
 * shape: the key **present** and the value **`undefined`**, which is what
 * ofetch leaves behind when the request never got a reply.
 *
 * `unreachableApi()` is that shape and nothing else may stand in for it.
 */
function unreachableApi(): Error & { readonly response: undefined } {
  return Object.assign(new Error('fetch failed'), { response: undefined });
}

/** What ofetch throws when the server did reply, with a non-2xx status. */
function responded(status: number, data: unknown = undefined) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status }, data });
}

describe('serverResponded', () => {
  test('is false when ofetch defines response as undefined because nothing arrived', () => {
    const error = unreachableApi();

    // The fixture must carry the real shape, or this test proves nothing.
    expect('response' in error).toBe(true);
    expect(error.response).toBeUndefined();

    expect(serverResponded(error)).toBe(false);
  });

  test('is false for a plain error, a string, null and undefined', () => {
    expect(serverResponded(new Error('Failed to fetch'))).toBe(false);
    expect(serverResponded('nope')).toBe(false);
    expect(serverResponded(null)).toBe(false);
    expect(serverResponded(undefined)).toBe(false);
  });

  test('is true whenever a response came back, even one carrying no status', () => {
    expect(serverResponded(responded(500))).toBe(true);
    expect(serverResponded({ response: {} })).toBe(true);
  });
});

describe('httpStatusOf', () => {
  test('is undefined when no response arrived, so callers fall through to their network state', () => {
    expect(httpStatusOf(unreachableApi())).toBeUndefined();
    expect(httpStatusOf(new Error('Failed to fetch'))).toBeUndefined();
  });

  test('reads the status the server replied with', () => {
    expect(httpStatusOf(responded(401))).toBe(401);
    expect(httpStatusOf(responded(403))).toBe(403);
    expect(httpStatusOf(responded(409))).toBe(409);
  });

  test('is undefined for a response with no usable status, never a coerced one', () => {
    expect(httpStatusOf({ response: {} })).toBeUndefined();
    expect(httpStatusOf({ response: { status: '404' } })).toBeUndefined();
  });
});

describe('responseBodyOf', () => {
  test('returns the parsed error body of a response that arrived', () => {
    expect(responseBodyOf(responded(409, { reason: 'locked' }))).toEqual({ reason: 'locked' });
  });

  test('is undefined when no response arrived', () => {
    expect(responseBodyOf(unreachableApi())).toBeUndefined();
    expect(responseBodyOf(new Error('Failed to fetch'))).toBeUndefined();
  });
});

/**
 * ── One guard, not eleven ──────────────────────────────────────────────
 *
 * The defect this module closes was not one composable getting one
 * expression wrong. It was the same fact about ofetch written out by hand
 * ten times with nothing comparing the copies, so four of them could be
 * wrong for as long as nobody looked. Fixing the four and leaving the
 * shape open is a fix with a five-in-ten chance of coming back.
 *
 * So this is mechanical: nothing under `app/` may reach into a fetch
 * error's own `response`/`data` shape except this module. A new
 * composable that hand-rolls the guard fails here, by name and line,
 * before it can hang a screen.
 */
/**
 * Vitest runs with `apps/web` as its root (see vitest.config.ts), and the
 * Nuxt test environment rewrites `import.meta.url` to an http URL, so the
 * cwd is the one handle onto the real directory. The second test below
 * proves the scan found the tree rather than silently reading nothing.
 */
const APP_DIR = resolve(process.cwd(), 'app');
const CANONICAL = join(APP_DIR, 'utils', 'fetch-error.ts');

/** Each needle is a way of reaching into the ofetch error shape by hand. */
const HAND_ROLLED_GUARD = [
  "'response' in",
  '"response" in',
  '.response.status',
  '.response?.',
  'interface ResponseError',
  'error.data',
] as const;

function sourceFilesUnderApp(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFilesUnderApp(full);
    }
    if (!/\.(ts|vue)$/.test(entry.name) || /\.test\.ts$/.test(entry.name)) {
      return [];
    }
    return full === CANONICAL ? [] : [full];
  });
}

describe('the ofetch error shape is read in exactly one place', () => {
  test('no file under app/ hand-rolls its own response guard', () => {
    const offenders = sourceFilesUnderApp(APP_DIR).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return HAND_ROLLED_GUARD.filter((needle) => source.includes(needle)).map(
        (needle) => `${relative(APP_DIR, file)} contains ${needle}`,
      );
    });

    expect(offenders).toEqual([]);
  });

  test('the scan actually reads files, so an empty result means checked, not skipped', () => {
    const files = sourceFilesUnderApp(APP_DIR);

    expect(files.length).toBeGreaterThan(10);
    expect(files.some((file) => file.endsWith('useWorkspaces.ts'))).toBe(true);
    expect(files).not.toContain(CANONICAL);
  });
});
