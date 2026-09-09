/**
 * Structural check (editing-presence spec: "Presence Has No Write Path
 * Independent Of The Lock Heartbeat"): the only production code path
 * that calls a `PresenceBroadcaster`'s `publish()` is `heartbeatLock`'s
 * own success path in `packages/db/src/locks/page-lock.ts`. A second call
 * site would be a second, independent presence write path — exactly the
 * defect this spec forbids.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, test } from 'bun:test';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const SOURCE_EXTENSIONS = new Set(['.ts']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.nuxt', '.output', '.git', 'drizzle', '__fixtures__']);
const PUBLISH_CALL_PATTERN = /\.publish\s*\(/;
const ALLOWED_FILE = 'packages/db/src/locks/page-lock.ts';

function collectSourceFiles(root: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, acc);
    else if (SOURCE_EXTENSIONS.has(extname(entry)) && !entry.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

describe('PresenceBroadcaster.publish has exactly one call site', () => {
  test('only heartbeatLock (page-lock.ts) publishes — no other production code path does', () => {
    const offenders: string[] = [];
    for (const dir of ['apps/api/src', 'packages/db/src', 'packages/core/src']) {
      for (const file of collectSourceFiles(join(REPO_ROOT, dir))) {
        const rel = relative(REPO_ROOT, file).split('\\').join('/');
        if (rel === ALLOWED_FILE) continue;
        const contents = readFileSync(file, 'utf8');
        if (PUBLISH_CALL_PATTERN.test(contents)) offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });

  test('page-lock.ts itself does call publish — the allowed call site is real, not merely absent everywhere else', () => {
    const contents = readFileSync(join(REPO_ROOT, ALLOWED_FILE), 'utf8');
    expect(PUBLISH_CALL_PATTERN.test(contents)).toBe(true);
  });
});
