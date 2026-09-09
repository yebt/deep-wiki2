import { describe, expect, test } from 'bun:test';
import { decide } from './decide';
import { decideMany } from './decide-many';
import type { ResolvedGrant } from './types';

/**
 * Differential test against Phase 1's `decide()` (design.md D17 — "Phase
 * 1's D7 ... is preserved verbatim"). `decideMany()` must fold each origin
 * exactly as `decide()` folds that same origin's own grant set in
 * isolation — it is the identical rule, just applied per group.
 */
describe('decideMany()', () => {
  test('folds each group exactly as decide() folds one, for identical inputs', () => {
    const groups = new Map<string, readonly ResolvedGrant[]>([
      ['no-grants', []],
      ['single-allow', [{ depth: 0, effect: 'allow' }]],
      ['single-deny', [{ depth: 0, effect: 'deny' }]],
      [
        'inherited-allow-overridden-by-closer-deny',
        [
          { depth: 0, effect: 'deny' },
          { depth: 2, effect: 'allow' },
        ],
      ],
      [
        'deny-at-min-depth-beats-allow-at-same-depth',
        [
          { depth: 1, effect: 'allow' },
          { depth: 1, effect: 'deny' },
        ],
      ],
    ]);

    const result = decideMany(groups);

    for (const [origin, grants] of groups) {
      expect(result.get(origin)).toBe(decide(grants));
    }
  });

  test('returns a map with exactly the input origins, no extras and no omissions', () => {
    const groups = new Map<string, readonly ResolvedGrant[]>([
      ['a', []],
      ['b', [{ depth: 0, effect: 'allow' }]],
    ]);

    const result = decideMany(groups);

    expect([...result.keys()].sort()).toEqual(['a', 'b']);
  });
});
