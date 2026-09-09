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

/**
 * One pinned `remark-stringify` option, and everything needed to prove the
 * pin is load-bearing rather than decorative.
 */
interface PinCase {
  /** The value `PINNED_OPTIONS` freezes for this key. */
  readonly pinned: unknown;
  /**
   * A different *legal* value for the same option. `fixtures/pins/pin-<key>.md`
   * must serialise differently under it — that is what proves the fixture
   * actually contains a construct this option governs. A fixture that comes
   * out identical is decorative and must be strengthened, never excused.
   */
  readonly alternative: unknown;
  /**
   * Whether deleting the key outright changes the bytes — i.e. whether the
   * pinned value differs from `remark-stringify`'s own default (pipeline.ts
   * calls these *efficacious* pins) or merely restates it (*defensive* pins,
   * pinned so a future remark upgrade cannot move the default underneath the
   * fixture). Asserted in both directions: a remark release that moves one of
   * those defaults flips this flag and fails the named test, which is exactly
   * the drift the defensive pins exist to catch.
   */
  readonly differsWhenRemoved: boolean;
}

const PIN_CASES: Readonly<Record<string, PinCase>> = {
  bullet: { pinned: '-', alternative: '*', differsWhenRemoved: true },
  bulletOrdered: { pinned: '.', alternative: ')', differsWhenRemoved: false },
  emphasis: { pinned: '_', alternative: '*', differsWhenRemoved: true },
  fence: { pinned: '`', alternative: '~', differsWhenRemoved: false },
  fences: { pinned: true, alternative: false, differsWhenRemoved: false },
  listItemIndent: { pinned: 'one', alternative: 'tab', differsWhenRemoved: false },
  resourceLink: { pinned: true, alternative: false, differsWhenRemoved: true },
  rule: { pinned: '*', alternative: '-', differsWhenRemoved: false },
  setext: { pinned: false, alternative: true, differsWhenRemoved: false },
  strong: { pinned: '_', alternative: '*', differsWhenRemoved: true },
  tightDefinitions: { pinned: true, alternative: false, differsWhenRemoved: true },
};

/**
 * Serialises `source` through a bare `remark-stringify` under `options`.
 * Deliberately bare: this is the pipeline's spelling layer isolated from its
 * syntax extensions, so a difference between two runs can only come from the
 * option that was changed between them. Every pin fixture is plain Markdown,
 * and the "pinned output === fixture bytes" assertion below is what keeps
 * that true — a pin fixture that ever needs GFM or a custom node fails it
 * loudly instead of drifting away from the real pipeline in silence.
 */
function serialiseWith(options: Record<string, unknown>, source: string): string {
  return unified().use(remarkStringify, options).stringify(parse(source));
}

function optionsWithout(key: string): Record<string, unknown> {
  const options: Record<string, unknown> = { ...PINNED_OPTIONS };
  delete options[key];
  return options;
}

describe('PINNED_OPTIONS coverage', () => {
  // design.md "The pinned-options rule, made mechanical" — every pinned key
  // must have an efficacy case (and therefore a fixture) below. Read from the
  // object's own keys so a newly added pin without a case fails here rather
  // than silently shipping uncovered, and a case left behind by a removed pin
  // fails here too.
  test('every pinned key has an efficacy case, and no case outlives its pin', () => {
    expect(Object.keys(PIN_CASES).sort()).toEqual(Object.keys(PINNED_OPTIONS).sort());
  });

  test('PINNED_OPTIONS declares at least one key', () => {
    expect(Object.keys(PINNED_OPTIONS).length).toBeGreaterThan(0);
  });
});

// markdown-round-trip: "Removing a pin fails a named fixture". Three named,
// individually failing assertions per key, so a failure says which pin broke:
//
//  1. the pin is present, holds its frozen value, and reproduces the fixture's
//     canonical bytes — deleting the key from PINNED_OPTIONS fails this one for
//     every key, including the pins whose value merely restates a remark
//     default and so could never be caught by an output diff alone;
//  2. the fixture diverges under a different legal value for that option —
//     proof the fixture exercises the option instead of decorating it;
//  3. dropping the key changes (or provably does not change) the bytes, which
//     pins the pin against remark's own default moving.
describe('pin efficacy', () => {
  for (const [key, pinCase] of Object.entries(PIN_CASES)) {
    const fixturePath = join(PINS_DIR, `pin-${key}.md`);

    test(`${key}: pin-${key}.md is what the pinned options serialise`, () => {
      const fixture = readFileSync(fixturePath, 'utf8');

      expect(PINNED_OPTIONS).toHaveProperty(key, pinCase.pinned);
      expect(serialiseWith({ ...PINNED_OPTIONS }, fixture)).toBe(fixture);
    });

    test(`${key}: pin-${key}.md diverges when ${key} is ${JSON.stringify(pinCase.alternative)}`, () => {
      const fixture = readFileSync(fixturePath, 'utf8');

      const pinned = serialiseWith({ ...PINNED_OPTIONS }, fixture);
      const alternative = serialiseWith(
        { ...PINNED_OPTIONS, [key]: pinCase.alternative },
        fixture,
      );

      expect(alternative).not.toBe(pinned);
    });

    test(`${key}: dropping the pin ${pinCase.differsWhenRemoved ? 'changes' : 'leaves'} pin-${key}.md${pinCase.differsWhenRemoved ? '' : ' alone, because the pin restates remark’s default'}`, () => {
      const fixture = readFileSync(fixturePath, 'utf8');

      const pinned = serialiseWith({ ...PINNED_OPTIONS }, fixture);
      const dropped = serialiseWith(optionsWithout(key), fixture);

      if (pinCase.differsWhenRemoved) {
        expect(dropped).not.toBe(pinned);
      } else {
        expect(dropped).toBe(pinned);
      }
    });
  }
});
