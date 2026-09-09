import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { isLegalParentType, LEGAL_PARENT_TYPES, NODE_TYPES, type NodeType } from '@deep-wiki/core';
import { legalParentTypesUsedBy } from './legal-parent-types';

/**
 * `LEGAL_PARENT_TYPES` was written down twice before it was written down
 * once: `move.ts` and `reorder.ts` each carried a private,
 * character-identical copy with nothing in the repository comparing them.
 * That is docs/TODO.md's own named recurring defect — *the same fact in
 * two places with nothing comparing them* — and creation would have been
 * the third copy.
 *
 * Two guards, because a comment is not one:
 *
 * 1. **Nobody declares another table.** A textual scan of this directory:
 *    the moment someone types `LEGAL_PARENT_TYPES = {` or a bare
 *    `'workspace' | 'shelf' | 'book' | 'chapter' | 'page'` union outside
 *    the one module that re-exports the core table, this fails and names
 *    the file.
 * 2. **The move, reorder and create paths all read the same object.**
 *    A scan proves nothing about what runs; `legalParentTypesUsedBy()` is
 *    the accessor each of them actually calls, and its identity is
 *    compared against core's export here.
 */
const NODES_DIR = import.meta.dir;

function sourceFiles(): { name: string; source: string }[] {
  return readdirSync(NODES_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ name, source: readFileSync(join(NODES_DIR, name), 'utf8') }));
}

describe('the node hierarchy is a single source', () => {
  test('no module under nodes/ declares its own parent table', () => {
    const offenders = sourceFiles()
      .filter((file) => file.name !== 'legal-parent-types.ts')
      .filter((file) => /LEGAL_PARENT_TYPES\s*(:[^=]*)?=\s*\{/.test(file.source))
      .map((file) => file.name);

    expect(offenders).toEqual([]);
  });

  test('no module under nodes/ re-declares the node-type union', () => {
    const offenders = sourceFiles()
      .filter((file) => file.name !== 'legal-parent-types.ts')
      .filter((file) => /type\s+NodeType\s*=\s*'workspace'/.test(file.source))
      .map((file) => file.name);

    expect(offenders).toEqual([]);
  });

  test('the accessor every writer calls is core’s table itself, not a copy of it', () => {
    expect(legalParentTypesUsedBy()).toBe(LEGAL_PARENT_TYPES);
    for (const child of NODE_TYPES) {
      for (const parent of NODE_TYPES) {
        expect(legalParentTypesUsedBy()[child as NodeType].includes(parent)).toBe(isLegalParentType(child, parent));
      }
    }
  });
});
