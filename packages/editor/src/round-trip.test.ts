import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { roundTrip } from './round-trip';

// GATE-2 (docs/TODO.md): markdown -> doc -> markdown must be byte-identical
// across the full fixture corpus. ProseMirror is not wired yet (Phase 0),
// so this harness exercises the md -> mdast -> md leg only; ProseMirror
// slots into the same corpus in a later phase (WU-7 rewrites this file into
// the real md -> PM doc -> md harness). Only `modelled/` and `verbatim/` are
// expected to be byte-identical here — `refused/` fixtures are deliberately
// non-canonical (WU-7's probe is what asserts they are refused, not this
// placeholder), and `pins/` fixtures belong to the pin coverage/efficacy
// tests in `packages/markdown`, not this corpus.
const CORPUS_DIR = join(import.meta.dir, '..', '..', 'markdown', 'fixtures');
const ROUND_TRIP_BUCKETS = ['modelled', 'verbatim'];

/** Recursively collects every `.md` file under `dir`, corpus subdirectories included. */
function collectMarkdownFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectMarkdownFiles(full, acc);
    } else if (entry.endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('roundTrip', () => {
  const fixtureFiles = ROUND_TRIP_BUCKETS.flatMap((bucket) => collectMarkdownFiles(join(CORPUS_DIR, bucket)));

  test('the fixture corpus is non-empty', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const file of fixtureFiles) {
    test(`${relative(CORPUS_DIR, file)} round-trips byte-identical`, () => {
      const original = readFileSync(file, 'utf8');

      const result = roundTrip(original);

      expect(result).toBe(original);
    });
  }
});
