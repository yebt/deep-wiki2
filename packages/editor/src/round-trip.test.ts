import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { roundTrip } from './round-trip';

// GATE-2 (docs/TODO.md): markdown -> doc -> markdown must be byte-identical
// across the full fixture corpus. ProseMirror is not wired yet (Phase 0),
// so this harness exercises the md -> mdast -> md leg only; ProseMirror
// slots into the same corpus in a later phase.
const CORPUS_DIR = join(import.meta.dir, '..', '..', 'markdown', 'fixtures');

describe('roundTrip', () => {
  const fixtureFiles = readdirSync(CORPUS_DIR);

  test('the fixture corpus is non-empty', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const file of fixtureFiles) {
    test(`${file} round-trips byte-identical`, () => {
      const original = readFileSync(join(CORPUS_DIR, file), 'utf8');

      const result = roundTrip(original);

      expect(result).toBe(original);
    });
  }
});
