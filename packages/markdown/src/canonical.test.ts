import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { canonicalise, parse, PINNED_OPTIONS } from './index';

const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures');
const PINS_DIR = join(FIXTURES_DIR, 'pins');

/** Recursively collects every `.md` file under `dir`. */
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

describe('canonicalise()', () => {
  const fixtureFiles = collectMarkdownFiles(FIXTURES_DIR);

  test('the corpus is non-empty', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  // markdown-round-trip: Pinned Serialiser Options Are Test-Enforced (D6) —
  // canonicalise(canonicalise(x)) === canonicalise(x) must hold for every
  // fixture, including ones that are deliberately not already canonical
  // (the `refused/` bucket grown in a later work unit).
  for (const file of fixtureFiles) {
    test(`${file.replace(`${FIXTURES_DIR}/`, '')} is a fixed point after one canonicalisation`, () => {
      const original = readFileSync(file, 'utf8');

      const once = canonicalise(original);
      const twice = canonicalise(once);

      expect(twice).toBe(once);
    });
  }
});

describe('PINNED_OPTIONS coverage', () => {
  // design.md "The pinned-options rule, made mechanical" — a fixture must
  // exist for every key in PINNED_OPTIONS. Reads the object's own keys so a
  // newly added pinned option without a fixture fails this test rather than
  // silently shipping uncovered.
  const keys = Object.keys(PINNED_OPTIONS);

  test('PINNED_OPTIONS declares at least one key', () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  for (const key of keys) {
    test(`fixtures/pins/pin-${key}.md exists`, () => {
      const path = join(PINS_DIR, `pin-${key}.md`);
      expect(() => readFileSync(path, 'utf8')).not.toThrow();
    });
  }
});

describe('pin efficacy: bullet', () => {
  // markdown-round-trip: "Removing a pin fails a named fixture" — this test
  // reproduces what happens if the `bullet` key were dropped from
  // PINNED_OPTIONS, by stringifying with every pinned option except it, and
  // asserts that the named fixture (pin-bullet.md) diverges from its own
  // canonical bytes. If this test ever stops failing on pin removal, the
  // fixture is not doing its job.
  test('pin-bullet.md diverges from its canonical form without the bullet pin', () => {
    const path = join(PINS_DIR, 'pin-bullet.md');
    const canonical = readFileSync(path, 'utf8');

    const withoutBulletPin: Record<string, unknown> = { ...PINNED_OPTIONS };
    delete withoutBulletPin.bullet;
    const naiveStringify = unified().use(remarkStringify, withoutBulletPin);

    const naiveOutput = naiveStringify.stringify(parse(canonical));

    expect(naiveOutput).not.toBe(canonical);
  });
});
