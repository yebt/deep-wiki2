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
const CORPUS_DIR = join(import.meta.dir, '..', '..', 'markdown', 'fixtures');

function listFixtures(bucket: string): string[] {
  return readdirSync(join(CORPUS_DIR, bucket)).filter((name) => name.endsWith('.md'));
}

describe('GATE-2: modelled/ round-trips byte-identical through the PM doc', () => {
  for (const file of listFixtures('modelled')) {
    test(file, () => {
      const original = readFileSync(join(CORPUS_DIR, 'modelled', file), 'utf8');

      expect(roundTrip(original)).toBe(original);
    });
  }
});

describe('GATE-2: verbatim/ round-trips byte-identical and classify() names the carried type', () => {
  for (const file of listFixtures('verbatim')) {
    test(file, () => {
      const original = readFileSync(join(CORPUS_DIR, 'verbatim', file), 'utf8');

      expect(roundTrip(original)).toBe(original);
    });
  }
});

// `non-canonical-tightDefinitions.md` is excluded here on purpose: a
// `definition` node is carried verbatim (bucket B), so the probe reserialises
// its exact original bytes regardless of spacing between definitions — the
// `tightDefinitions` pin only has an effect when mdast-util-to-markdown
// reconstructs a `definition` from its structured fields, which the editor
// path never does. It is correctly non-canonical at the mdast/save-path
// layer (packages/markdown's own corpus.test.ts asserts exactly that); it is
// simply not one of the constructs edit-mode entry needs to refuse.
const PROBE_ACCEPTS_DESPITE_NON_CANONICAL = new Set(['non-canonical-tightDefinitions.md']);

describe('GATE-2: refused/ fixtures make the probe refuse, never open-and-drop', () => {
  for (const file of listFixtures('refused')) {
    if (PROBE_ACCEPTS_DESPITE_NON_CANONICAL.has(file)) continue;

    test(file, () => {
      const original = readFileSync(join(CORPUS_DIR, 'refused', file), 'utf8');

      const result = probe(original);

      expect(result.ok).toBe(false);
    });
  }

  test('non-canonical-tightDefinitions.md is probe-safe because definitions are verbatim-carried', () => {
    const original = readFileSync(join(CORPUS_DIR, 'refused', 'non-canonical-tightDefinitions.md'), 'utf8');

    expect(probe(original)).toEqual({ ok: true });
  });
});

describe('GATE-2: the probe accepts every modelled/ and verbatim/ fixture', () => {
  for (const bucket of ['modelled', 'verbatim']) {
    for (const file of listFixtures(bucket)) {
      test(`${bucket}/${file}`, () => {
        const original = readFileSync(join(CORPUS_DIR, bucket, file), 'utf8');

        expect(probe(original)).toEqual({ ok: true });
      });
    }
  }
});

describe('GATE-2: a schema-only defect is caught even when the mdast pipeline alone would pass', () => {
  test('removing wikiLink from the schema fails the round trip on a wiki-link fixture, though canonicalise() alone accepts it', () => {
    const markdown = readFileSync(join(CORPUS_DIR, 'modelled', 'wiki-link.md'), 'utf8');

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

describe('GATE-2: pin-removal regression at the PM level', () => {
  test('removing the bullet pin fails pin-bullet.md through the full editor round trip, not only the mdast-level test', () => {
    const markdown = readFileSync(join(CORPUS_DIR, 'pins', 'pin-bullet.md'), 'utf8');

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
