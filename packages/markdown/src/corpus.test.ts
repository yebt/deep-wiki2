import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalise } from './index';

const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures');

function listFixtures(bucket: string): string[] {
  return readdirSync(join(FIXTURES_DIR, bucket)).filter((name) => name.endsWith('.md'));
}

// markdown-round-trip: this is the mdast-level regression named by task 2.7
// — "canonicalise is a fixed point" across the grown corpus. It is
// superseded by WU-7's ProseMirror-level suite (which additionally proves
// the schema, not only the pipeline) but catches a pipeline-only regression
// earlier, before the schema exists at all.
describe('corpus: modelled/ and verbatim/ fixtures are already canonical', () => {
  for (const bucket of ['modelled', 'verbatim']) {
    for (const file of listFixtures(bucket)) {
      test(`${bucket}/${file} is byte-identical to its own canonicalisation`, () => {
        const original = readFileSync(join(FIXTURES_DIR, bucket, file), 'utf8');

        expect(canonicalise(original)).toBe(original);
      });
    }
  }
});

describe('corpus: refused/ fixtures are deliberately non-canonical', () => {
  for (const file of listFixtures('refused')) {
    test(`${file} is normalised away by canonicalisation`, () => {
      const original = readFileSync(join(FIXTURES_DIR, 'refused', file), 'utf8');

      expect(canonicalise(original)).not.toBe(original);
    });
  }
});
