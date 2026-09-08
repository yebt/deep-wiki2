import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunk } from './chunk';
import {
  findStaleGoldens,
  isRegenerating,
  pruneStaleGoldens,
  readGolden,
  writeGolden,
} from './golden';

// markdown-pipeline: Deterministic Chunk Boundaries Carrying Block IDs —
// "a boundary change must produce a visible golden diff in review" (task
// 4.2). One golden file per corpus fixture, generated deterministically
// except for freshly-minted ids, which never occur here since none of these
// fixtures carry an unresolved reference that would need minting.
//
// Regeneration is a deliberate human act, never a side effect of running the
// suite: `golden.ts` refuses every write and delete unless
// `UPDATE_CHUNK_GOLDENS=1` is set, which is what
// `bun run -F @deep-wiki/markdown goldens:update` does.
// On the ordinary `bun test` path a fixture without a reviewed golden fails,
// and a golden whose fixture is gone fails too.
const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures');
const GOLDEN_DIR = join(FIXTURES_DIR, '__chunks__');
const BUCKETS = ['modelled', 'verbatim', 'refused'];
const MAX_TOKENS = 40;

function listFixtures(bucket: string): string[] {
  return readdirSync(join(FIXTURES_DIR, bucket))
    .filter((name) => name.endsWith('.md'))
    .sort();
}

const CASES = BUCKETS.flatMap((bucket) =>
  listFixtures(bucket).map((file) => ({
    bucket,
    file,
    goldenName: `${bucket}__${file}.json`,
  })),
);

const EXPECTED_GOLDENS = CASES.map((entry) => entry.goldenName);

// Regenerating rewrites the whole set, so leftovers from a renamed or deleted
// fixture go with it — otherwise the stale-golden test below would still fail
// straight after a regeneration run meant to fix exactly that.
if (isRegenerating()) pruneStaleGoldens(GOLDEN_DIR, EXPECTED_GOLDENS);

describe('chunk() goldens', () => {
  test('the corpus produces at least one golden case', () => {
    expect(CASES.length).toBeGreaterThan(0);
  });

  for (const { bucket, file, goldenName } of CASES) {
    test(`${bucket}/${file} chunks match its golden`, () => {
      const markdown = readFileSync(join(FIXTURES_DIR, bucket, file), 'utf8');
      const result = chunk(markdown, { maxTokens: MAX_TOKENS });

      if (isRegenerating()) writeGolden(GOLDEN_DIR, goldenName, result);

      expect(result).toEqual(readGolden(GOLDEN_DIR, goldenName) as typeof result);
    });
  }

  // The missing-golden hole in the other direction: a golden left behind by a
  // renamed or deleted fixture reads as reviewed, tracked evidence while
  // nothing exercises it any more.
  test('no golden outlives the fixture that produced it', () => {
    expect(findStaleGoldens(GOLDEN_DIR, EXPECTED_GOLDENS)).toEqual([]);
  });
});
