import { describe, expect, test } from 'bun:test';
import { buildPath, isDescendantPath, isStrictDescendantPath, isWithinPathBound, MAX_PATH_LENGTH, parsePath } from './paths';

const WS = 'a1a1a1a1-1111-1111-1111-111111111111';
const SHELF = 'b2b2b2b2-2222-2222-2222-222222222222';
const BOOK = 'c3c3c3c3-3333-3333-3333-333333333333';

describe('buildPath', () => {
  test('joins ancestor ids with a leading and trailing delimiter', () => {
    expect(buildPath([WS])).toBe(`/${WS}/`);
  });

  test('joins multiple ancestor ids in order', () => {
    expect(buildPath([WS, SHELF, BOOK])).toBe(`/${WS}/${SHELF}/${BOOK}/`);
  });
});

describe('parsePath', () => {
  test('round-trips through buildPath', () => {
    const ids = [WS, SHELF, BOOK];
    expect(parsePath(buildPath(ids))).toEqual(ids);
  });

  test('parses a single-segment path', () => {
    expect(parsePath(`/${WS}/`)).toEqual([WS]);
  });
});

describe('isWithinPathBound', () => {
  test('accepts a path at the 256-char bound', () => {
    const path = `/${'a'.repeat(254)}/`; // 256 chars total
    expect(path.length).toBe(MAX_PATH_LENGTH);
    expect(isWithinPathBound(path)).toBe(true);
  });

  test('rejects a path one character over the 256-char bound', () => {
    const path = `/${'a'.repeat(255)}/`; // 257 chars total
    expect(path.length).toBe(MAX_PATH_LENGTH + 1);
    expect(isWithinPathBound(path)).toBe(false);
  });
});

describe('isDescendantPath (self-inclusive)', () => {
  test('a node is its own descendant', () => {
    const path = buildPath([WS, SHELF]);
    expect(isDescendantPath(path, path)).toBe(true);
  });

  test('a nested path is a descendant of its ancestor prefix', () => {
    const ancestor = buildPath([WS]);
    const nested = buildPath([WS, SHELF, BOOK]);
    expect(isDescendantPath(ancestor, nested)).toBe(true);
  });

  test('a sibling with a colliding string prefix is not a descendant (trailing delimiter guards this)', () => {
    const ancestor = buildPath(['ab']);
    const sibling = buildPath(['abc']);
    expect(isDescendantPath(ancestor, sibling)).toBe(false);
  });

  test('an unrelated path is not a descendant', () => {
    const ancestor = buildPath([WS]);
    const unrelated = buildPath([SHELF]);
    expect(isDescendantPath(ancestor, unrelated)).toBe(false);
  });
});

describe('isStrictDescendantPath (excludes the ancestor itself)', () => {
  test('a node is not its own strict descendant', () => {
    const path = buildPath([WS, SHELF]);
    expect(isStrictDescendantPath(path, path)).toBe(false);
  });

  test('a nested path is still a strict descendant of its ancestor', () => {
    const ancestor = buildPath([WS]);
    const nested = buildPath([WS, SHELF]);
    expect(isStrictDescendantPath(ancestor, nested)).toBe(true);
  });
});
