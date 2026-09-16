import { LEGAL_PARENT_TYPES, legalChildTypes, type NodeType } from '@deep-wiki/contracts';
import { describe, expect, test } from 'vitest';
import type { TreeNode } from './useTree';
import { treeRowActions, type TreeRowAction } from './useTreeRowActions';

function node(type: string, id = `${type}-1`, children: TreeNode[] = []): TreeNode {
  return { id, type, slug: id, title: `The ${type}`, position: 0, children };
}

function flat(groups: readonly (readonly TreeRowAction[])[]): TreeRowAction[] {
  return groups.flat();
}

function byKind(groups: readonly (readonly TreeRowAction[])[], kind: TreeRowAction['kind']): TreeRowAction[] {
  return flat(groups).filter((action) => action.kind === kind);
}

const MIDDLE = { index: 1, siblingCount: 3 };

describe('treeRowActions', () => {
  describe('"New <child>…" comes from the one LEGAL_PARENT_TYPES table', () => {
    for (const type of ['shelf', 'book', 'chapter', 'page'] as const) {
      test(`a ${type} row offers exactly the children the table allows under it`, () => {
        const creates = byKind(treeRowActions(node(type), MIDDLE), 'create');
        const expected = legalChildTypes(type);
        expect(creates.map((action) => action.childType)).toEqual(expected);
        for (const action of creates) {
          expect(action.disabled).toBe(false);
          expect(action.label).toMatch(/^New [a-z]+…$/);
        }
      });
    }

    test('the derivation is the table read backwards, so a table change moves the menu without a second list', () => {
      const parents = Object.keys(LEGAL_PARENT_TYPES) as NodeType[];
      for (const parent of parents) {
        if (parent === 'workspace') continue;
        const offered = byKind(treeRowActions(node(parent), MIDDLE), 'create').map((action) => action.childType);
        const fromTable = parents.filter((child) => LEGAL_PARENT_TYPES[child].includes(parent));
        expect(offered).toEqual(fromTable);
      }
    });
  });

  describe('rename and reorder', () => {
    test('every row can be renamed', () => {
      for (const type of ['shelf', 'book', 'chapter', 'page']) {
        const [rename] = byKind(treeRowActions(node(type), MIDDLE), 'rename');
        expect(rename?.disabled, type).toBe(false);
      }
    });

    test('a row in the middle of its siblings can move both ways', () => {
      const groups = treeRowActions(node('page'), MIDDLE);
      expect(byKind(groups, 'move-up')[0]?.disabled).toBe(false);
      expect(byKind(groups, 'move-down')[0]?.disabled).toBe(false);
    });

    test('the first row keeps "Move up" in the menu, disabled with a reason; the last keeps "Move down"', () => {
      const first = treeRowActions(node('page'), { index: 0, siblingCount: 3 });
      const up = byKind(first, 'move-up')[0]!;
      expect(up.disabled).toBe(true);
      expect(up.reason).toMatch(/already first/i);
      expect(byKind(first, 'move-down')[0]?.disabled).toBe(false);

      const last = treeRowActions(node('page'), { index: 2, siblingCount: 3 });
      const down = byKind(last, 'move-down')[0]!;
      expect(down.disabled).toBe(true);
      expect(down.reason).toMatch(/already last/i);
      expect(byKind(last, 'move-up')[0]?.disabled).toBe(false);
    });

    test('an only child can move neither way, and both say why', () => {
      const only = treeRowActions(node('shelf'), { index: 0, siblingCount: 1 });
      expect(byKind(only, 'move-up')[0]?.disabled).toBe(true);
      expect(byKind(only, 'move-down')[0]?.disabled).toBe(true);
    });
  });

  describe('destinations', () => {
    test('a page opens and has a history; a book has a history; a shelf and a chapter have neither', () => {
      const page = treeRowActions(node('page', 'p1'), MIDDLE);
      expect(byKind(page, 'open')[0]?.to).toBe('/pages/p1');
      expect(byKind(page, 'history')[0]?.to).toBe('/pages/p1/history');

      const book = treeRowActions(node('book', 'b1'), MIDDLE);
      expect(byKind(book, 'open')).toHaveLength(0);
      expect(byKind(book, 'history')[0]?.to).toBe('/books/b1/history');

      for (const type of ['shelf', 'chapter']) {
        const groups = treeRowActions(node(type), MIDDLE);
        expect(byKind(groups, 'open'), type).toHaveLength(0);
        expect(byKind(groups, 'history'), type).toHaveLength(0);
      }
    });

    test('the history item names what it is the history of — "Page history", "Book history" — never a bare "History"', () => {
      // A screen-reader user hears the menu item, not the row it belongs
      // to (docs/UI-CHECKLIST.md §5: an accessible name is specific enough
      // out of context); and the visible label is the accessible name, so
      // the sighted reader hears the same words (§4.3).
      const [pageHistory] = byKind(treeRowActions(node('page', 'p1'), MIDDLE), 'history');
      expect(pageHistory?.label).toBe('Page history');
      const [bookHistory] = byKind(treeRowActions(node('book', 'b1'), MIDDLE), 'history');
      expect(bookHistory?.label).toBe('Book history');
    });

    test('"Copy link" is on every row: live on a page, disabled with a reason elsewhere', () => {
      for (const type of ['shelf', 'book', 'chapter', 'page']) {
        const [copy] = byKind(treeRowActions(node(type), MIDDLE), 'copy-link');
        expect(copy, type).toBeDefined();
        if (type === 'page') {
          expect(copy!.disabled).toBe(false);
        } else {
          expect(copy!.disabled).toBe(true);
          expect(copy!.reason).toMatch(/only a page/i);
        }
      }
    });
  });

  test('every disabled action carries a reason, and no enabled one does', () => {
    for (const type of ['shelf', 'book', 'chapter', 'page']) {
      for (const ctx of [{ index: 0, siblingCount: 1 }, MIDDLE]) {
        for (const action of flat(treeRowActions(node(type), ctx))) {
          if (action.disabled) expect(action.reason, `${type} ${action.kind}`).toBeTruthy();
          else expect(action.reason, `${type} ${action.kind}`).toBeUndefined();
        }
      }
    }
  });

  test('delete is not offered — three open questions in docs/TODO.md', () => {
    for (const type of ['shelf', 'book', 'chapter', 'page']) {
      expect(flat(treeRowActions(node(type), MIDDLE)).some((action) => /delete|remove/i.test(action.label))).toBe(false);
    }
  });
});
