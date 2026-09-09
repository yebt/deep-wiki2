import { describe, expect, test } from 'bun:test';
import {
  IllegalParentTypeError,
  LEGAL_PARENT_TYPES,
  legalChildTypes,
  isLegalParentType,
  NODE_TYPES,
  type NodeType,
} from './hierarchy';

/**
 * The hierarchy table is the one fact this repository has already written
 * down twice — `packages/db/src/nodes/move.ts` and `reorder.ts` each
 * carried their own copy, with nothing comparing them. These tests hold
 * the table itself; `packages/db/src/nodes/single-source.test.ts` holds
 * that nobody writes a third copy.
 */
describe('LEGAL_PARENT_TYPES (docs/SPECS.md §3.1)', () => {
  test('every node type has an entry, and only the workspace root is parentless', () => {
    expect(NODE_TYPES).toEqual(['workspace', 'shelf', 'book', 'chapter', 'page']);
    for (const type of NODE_TYPES) {
      expect(LEGAL_PARENT_TYPES[type]).toBeDefined();
    }
    expect(LEGAL_PARENT_TYPES.workspace).toEqual([]);
  });

  test('the chain is Workspace -> Shelf -> Book -> {Chapter -> Page, Page}', () => {
    expect(isLegalParentType('shelf', 'workspace')).toBe(true);
    expect(isLegalParentType('book', 'shelf')).toBe(true);
    expect(isLegalParentType('chapter', 'book')).toBe(true);
    expect(isLegalParentType('page', 'book')).toBe(true);
    expect(isLegalParentType('page', 'chapter')).toBe(true);
  });

  test('a book under a page is refused, and so is a shelf under a book', () => {
    expect(isLegalParentType('book', 'page')).toBe(false);
    expect(isLegalParentType('shelf', 'book')).toBe(false);
    expect(isLegalParentType('chapter', 'chapter')).toBe(false);
    expect(isLegalParentType('workspace', 'workspace')).toBe(false);
  });

  /**
   * `legalChildTypes` is the same table read the other way round, so a
   * client offering a "what can I create here?" menu never has to restate
   * it. Derived, never listed: this test is what makes that true.
   */
  test('legalChildTypes is LEGAL_PARENT_TYPES inverted, not a second list', () => {
    for (const parent of NODE_TYPES) {
      const derived = legalChildTypes(parent);
      const expected = NODE_TYPES.filter((child) => LEGAL_PARENT_TYPES[child].includes(parent));
      expect(derived).toEqual(expected as NodeType[]);
    }
    expect(legalChildTypes('workspace')).toEqual(['shelf']);
    expect(legalChildTypes('book')).toEqual(['chapter', 'page']);
    expect(legalChildTypes('page')).toEqual([]);
  });

  test('the refusal names both types, so a caller can say why', () => {
    const error = new IllegalParentTypeError('book', 'page');
    expect(error.name).toBe('IllegalParentTypeError');
    expect(error.message).toContain('book');
    expect(error.message).toContain('page');
    expect(error.childType).toBe('book');
    expect(error.parentType).toBe('page');
  });
});
