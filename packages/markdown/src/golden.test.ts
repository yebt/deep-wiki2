import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findStaleGoldens,
  isRegenerating,
  pruneStaleGoldens,
  readGolden,
  REGENERATE_COMMAND,
  REGENERATE_ENV,
  writeGolden,
} from './golden';

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'deep-wiki-golden-'));
}

const REGENERATING = { [REGENERATE_ENV]: '1' };
const ORDINARY = {};

describe('readGolden()', () => {
  // The defect this file exists to prevent: a golden that the test suite
  // writes for itself can never fail the first time it runs, so "the output
  // changed" silently becomes "the output is whatever the code just
  // produced". A missing golden is a human's decision to make, never a side
  // effect of running the suite.
  test('a missing golden is an error, not a write', () => {
    const dir = scratchDir();

    expect(() => readGolden(dir, 'absent.json')).toThrow();
    expect(existsSync(join(dir, 'absent.json'))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  test('the missing-golden error names the fixture and how to regenerate', () => {
    const dir = scratchDir();

    expect(() => readGolden(dir, 'absent.json')).toThrow(/absent\.json/);
    expect(() => readGolden(dir, 'absent.json')).toThrow(REGENERATE_COMMAND);
  });

  test('a missing golden is still an error while regenerating', () => {
    // Regeneration writes first and reads back; reading is never the path
    // that creates a file, in any mode. `readGolden` takes no environment at
    // all, so this asserts against the real process env, restored after.
    const dir = scratchDir();
    const previous = process.env[REGENERATE_ENV];
    process.env[REGENERATE_ENV] = '1';
    try {
      expect(() => readGolden(dir, 'absent.json')).toThrow();
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env[REGENERATE_ENV];
      else process.env[REGENERATE_ENV] = previous;
    }
  });

  test('an existing golden is parsed and returned', () => {
    const dir = scratchDir();
    writeFileSync(join(dir, 'present.json'), '[{"ordinal":0}]\n');

    expect(readGolden(dir, 'present.json')).toEqual([{ ordinal: 0 }]);
  });
});

describe('writeGolden()', () => {
  // The env gate lives inside the writer rather than at its call site, so
  // "the ordinary test run never writes a golden" is a property of this
  // module and not of every caller remembering to check first.
  test('refuses to write unless regeneration was asked for explicitly', () => {
    const dir = scratchDir();

    expect(() => writeGolden(dir, 'new.json', [], ORDINARY)).toThrow(REGENERATE_COMMAND);
    expect(readdirSync(dir)).toEqual([]);
  });

  test('writes a golden readable by readGolden when regenerating', () => {
    const dir = scratchDir();

    writeGolden(dir, 'new.json', [{ ordinal: 0 }], REGENERATING);

    expect(readGolden(dir, 'new.json')).toEqual([{ ordinal: 0 }]);
  });

  test('writes pretty-printed JSON with a trailing newline, so a diff is readable', () => {
    const dir = scratchDir();

    writeGolden(dir, 'new.json', [{ ordinal: 0 }], REGENERATING);

    expect(Bun.file(join(dir, 'new.json')).text()).resolves.toBe(
      '[\n  {\n    "ordinal": 0\n  }\n]\n',
    );
  });

  test('creates the golden directory when regenerating into a fresh tree', () => {
    const dir = join(scratchDir(), 'nested', '__chunks__');

    writeGolden(dir, 'new.json', [], REGENERATING);

    expect(existsSync(join(dir, 'new.json'))).toBe(true);
  });
});

describe('findStaleGoldens()', () => {
  // The same hole in the other direction: a golden whose fixture was renamed
  // or deleted keeps passing review as tracked, reviewed content while
  // nothing exercises it any more.
  test('reports a golden no fixture accounts for', () => {
    const dir = scratchDir();
    writeFileSync(join(dir, 'kept.json'), '[]\n');
    writeFileSync(join(dir, 'orphan.json'), '[]\n');

    expect(findStaleGoldens(dir, ['kept.json'])).toEqual(['orphan.json']);
  });

  test('reports nothing when every golden is accounted for', () => {
    const dir = scratchDir();
    writeFileSync(join(dir, 'kept.json'), '[]\n');

    expect(findStaleGoldens(dir, ['kept.json', 'not-yet-generated.json'])).toEqual([]);
  });

  test('ignores files that are not goldens', () => {
    const dir = scratchDir();
    writeFileSync(join(dir, 'README.md'), 'not a golden\n');

    expect(findStaleGoldens(dir, [])).toEqual([]);
  });

  test('a missing golden directory holds nothing stale', () => {
    expect(findStaleGoldens(join(scratchDir(), 'absent'), [])).toEqual([]);
  });
});

describe('pruneStaleGoldens()', () => {
  test('refuses to delete unless regeneration was asked for explicitly', () => {
    const dir = scratchDir();
    writeFileSync(join(dir, 'orphan.json'), '[]\n');

    expect(() => pruneStaleGoldens(dir, [], ORDINARY)).toThrow(REGENERATE_COMMAND);
    expect(existsSync(join(dir, 'orphan.json'))).toBe(true);
  });

  test('deletes exactly the stale goldens when regenerating', () => {
    const dir = scratchDir();
    writeFileSync(join(dir, 'kept.json'), '[]\n');
    writeFileSync(join(dir, 'orphan.json'), '[]\n');

    expect(pruneStaleGoldens(dir, ['kept.json'], REGENERATING)).toEqual(['orphan.json']);
    expect(readdirSync(dir)).toEqual(['kept.json']);
  });
});

describe('isRegenerating()', () => {
  test('is false unless the env var is exactly "1"', () => {
    expect(isRegenerating({})).toBe(false);
    expect(isRegenerating({ [REGENERATE_ENV]: '' })).toBe(false);
    expect(isRegenerating({ [REGENERATE_ENV]: '0' })).toBe(false);
    expect(isRegenerating({ [REGENERATE_ENV]: 'true' })).toBe(false);
  });

  test('is true when the env var is exactly "1"', () => {
    expect(isRegenerating(REGENERATING)).toBe(true);
  });
});
