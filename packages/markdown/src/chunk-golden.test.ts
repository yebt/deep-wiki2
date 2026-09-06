import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunk } from './chunk';

// markdown-pipeline: Deterministic Chunk Boundaries Carrying Block IDs —
// "a boundary change must produce a visible golden diff in review" (task
// 4.2). One golden file per corpus fixture, generated deterministically
// except for freshly-minted ids, which never occur here since none of these
// fixtures carry an unresolved reference that would need minting.
const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures');
const GOLDEN_DIR = join(import.meta.dir, '..', 'fixtures', '__chunks__');
const MAX_TOKENS = 40;

function listFixtures(bucket: string): string[] {
  return readdirSync(join(FIXTURES_DIR, bucket)).filter((name) => name.endsWith('.md'));
}

// Regenerate with: UPDATE_CHUNK_GOLDENS=1 bun test src/chunk-golden.test.ts
const shouldUpdate = process.env.UPDATE_CHUNK_GOLDENS === '1';

describe('chunk() goldens', () => {
  if (shouldUpdate) mkdirSync(GOLDEN_DIR, { recursive: true });

  for (const bucket of ['modelled', 'verbatim', 'refused']) {
    for (const file of listFixtures(bucket)) {
      const goldenName = `${bucket}__${file}.json`;

      test(`${bucket}/${file} chunks match its golden`, () => {
        const markdown = readFileSync(join(FIXTURES_DIR, bucket, file), 'utf8');
        const result = chunk(markdown, { maxTokens: MAX_TOKENS });
        const goldenPath = join(GOLDEN_DIR, goldenName);

        if (shouldUpdate || !existsSync(goldenPath)) {
          writeFileSync(goldenPath, `${JSON.stringify(result, null, 2)}\n`);
        }

        const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
        expect(result).toEqual(golden);
      });
    }
  }
});
