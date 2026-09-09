import { Schema } from 'prosemirror-model';
import { canonicalise, PINNED_OPTIONS } from '@deep-wiki/markdown';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromMarkdown } from './from-markdown';
import { probe } from './probe';
import { roundTrip } from './round-trip';
import { schema } from './schema';
import { toMdast } from './to-markdown';

// GATE-2 (docs/TODO.md; markdown-round-trip spec). This is the real
// md -> ProseMirror doc -> md harness: every fixture passes through
// `packages/editor`'s schema functions, not only `packages/markdown`'s
// mdast-level `parse`/`stringify`.
//
// **What the case count means.** GATE-2's claim is "markdown is the source
// of truth and round-tripping must not alter it", so a case only counts
// towards that claim when it actually compares bytes. Every `describe`
// below is therefore tagged with what it measures, and the tags are the
// only honest way to read the total:
//
//   [byte identity]  `roundTrip(x) === x` on a fixture that must survive
//                    the ProseMirror document unchanged.
//   [byte inequality] `roundTrip(x) !== x` on a fixture edit mode must
//                    refuse — the refusal is proven by the same byte
//                    comparison, not merely by `ok: false`.
//   [invariant]      a property asserted across the whole corpus.
//   [probe accept]   `probe()` reports the fixture openable. Byte identity
//                    is what makes it openable, but this describe is about
//                    the probe's verdict, not about the bytes.
//   [regression]     a deliberately-broken pipeline must fail the gate.
//   [corpus shape]   the corpus itself is fully claimed by the cases above.
const CORPUS_DIR = join(import.meta.dir, '..', '..', 'markdown', 'fixtures');

/**
 * Buckets whose every fixture is canonical Markdown and MUST come back
 * byte-identical through the ProseMirror document. `pins/` belongs here
 * for the same reason `modelled/` does: each `pin-<key>.md` is the
 * canonical spelling that `PINNED_OPTIONS[<key>]` produces, so a pin that
 * stops taking effect — or an editor conversion that reconstructs the
 * construct in some other spelling — changes these bytes.
 */
const BYTE_IDENTITY_BUCKETS = ['modelled', 'verbatim', 'pins'] as const;
/** Buckets whose every fixture is non-canonical and MUST be refused rather than opened-and-normalised. */
const REFUSED_BUCKETS = ['refused'] as const;

function listFixtures(bucket: string): string[] {
  return readdirSync(join(CORPUS_DIR, bucket)).filter((name) => name.endsWith('.md')).sort();
}

function read(bucket: string, file: string): string {
  return readFileSync(join(CORPUS_DIR, bucket, file), 'utf8');
}

for (const bucket of BYTE_IDENTITY_BUCKETS) {
  describe(`GATE-2 [byte identity]: ${bucket}/ round-trips unchanged through the PM doc`, () => {
    for (const file of listFixtures(bucket)) {
      test(`${bucket}/${file}`, () => {
        const original = read(bucket, file);

        expect(roundTrip(original)).toBe(original);
      });
    }
  });
}

for (const bucket of REFUSED_BUCKETS) {
  describe(`GATE-2 [byte inequality]: ${bucket}/ is refused because its bytes change, not merely rejected`, () => {
    for (const file of listFixtures(bucket)) {
      test(`${bucket}/${file}`, () => {
        const original = read(bucket, file);

        // The refusal must be provable by the same byte comparison the
        // [byte identity] cases make — otherwise a fixture could "pass"
        // this describe by throwing for an unrelated reason.
        expect(roundTrip(original)).not.toBe(original);
        expect(probe(original)).toMatchObject({ ok: false, reason: 'not_byte_identical' });
      });
    }
  });
}

describe('GATE-2 [invariant]: edit mode never opens a document the save path would rewrite', () => {
  // `probe()` gates entry into edit mode; `canonicalise()` is what
  // `savePage()` writes back. If the probe ever accepts a document that
  // canonicalisation would change, opening and saving it without touching
  // a character rewrites the user's file — the exact failure
  // markdown-round-trip's "Unrepresentable Content Fails Closed" forbids.
  for (const bucket of [...BYTE_IDENTITY_BUCKETS, ...REFUSED_BUCKETS]) {
    for (const file of listFixtures(bucket)) {
      test(`${bucket}/${file}`, () => {
        const original = read(bucket, file);
        const openable = probe(original).ok;
        const alreadyCanonical = canonicalise(original) === original;

        // Asserted as the forbidden COMBINATION rather than as a
        // conditional `expect`, so every case in this describe really runs
        // an assertion instead of quietly passing on a false branch.
        expect(openable && !alreadyCanonical).toBe(false);
      });
    }
  }
});

describe('GATE-2 [probe accept]: every byte-identity fixture is openable in edit mode', () => {
  for (const bucket of BYTE_IDENTITY_BUCKETS) {
    for (const file of listFixtures(bucket)) {
      test(`${bucket}/${file}`, () => {
        expect(probe(read(bucket, file))).toEqual({ ok: true });
      });
    }
  }
});

describe('GATE-2 [corpus shape]: no fixture bucket escapes the gate', () => {
  test('every fixture directory is claimed by either the byte-identity set or the refused set', () => {
    const buckets = readdirSync(CORPUS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('__'))
      .map((entry) => entry.name)
      .sort();

    expect(buckets).toEqual([...BYTE_IDENTITY_BUCKETS, ...REFUSED_BUCKETS].sort());
  });

  test('every claimed bucket is non-empty, so an emptied bucket cannot silently pass as covered', () => {
    for (const bucket of [...BYTE_IDENTITY_BUCKETS, ...REFUSED_BUCKETS]) {
      expect(listFixtures(bucket).length).toBeGreaterThan(0);
    }
  });
});

describe('GATE-2 [regression]: a schema-only defect is caught even when the mdast pipeline alone would pass', () => {
  test('removing wikiLink from the schema fails the round trip on a wiki-link fixture, though canonicalise() alone accepts it', () => {
    const markdown = read('modelled', 'wiki-link.md');

    // The mdast-only pipeline (packages/markdown alone) has no opinion on
    // ProseMirror schema membership — it passes.
    expect(canonicalise(markdown)).toBe(markdown);

    // A schema that does not model wikiLink must fail the PM-level round
    // trip on this exact fixture, proving GATE-2 exercises the schema and
    // not only packages/markdown's own pipeline.
    const { wikiLink: _removed, ...restNodes } = schema.spec.nodes.toObject() as Record<string, unknown>;
    const reducedSchema = new Schema({ nodes: restNodes as never, marks: schema.spec.marks.toObject() as never });

    expect(() => fromMarkdown(markdown, { schema: reducedSchema })).toThrow(/wikiLink/);
  });
});

describe('GATE-2 [regression]: pin removal is caught at the PM level', () => {
  test('removing the bullet pin fails pin-bullet.md through the full editor round trip, not only the mdast-level test', () => {
    const markdown = read('pins', 'pin-bullet.md');

    // The full editor pipeline accepts the fixture with the pin intact.
    expect(roundTrip(markdown)).toBe(markdown);

    // Reproduce what removing `bullet` from PINNED_OPTIONS would do, but on
    // the exact mdast tree the editor's OWN fromMarkdown -> toMdast
    // conversion produces — not a tree built directly by
    // packages/markdown's parse(). This is what makes it a PM-level
    // regression rather than a repeat of WU-1's canonical.test.ts.
    const doc = fromMarkdown(markdown);
    const treeFromEditor = toMdast(doc);

    const withoutBulletPin: Record<string, unknown> = { ...PINNED_OPTIONS };
    delete withoutBulletPin.bullet;
    const naiveStringify = unified().use(remarkStringify, withoutBulletPin);

    expect(naiveStringify.stringify(treeFromEditor)).not.toBe(markdown);
  });
});
