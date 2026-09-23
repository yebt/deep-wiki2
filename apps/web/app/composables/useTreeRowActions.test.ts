import { LEGAL_PARENT_TYPES, legalChildTypes, type NodeType } from '@deep-wiki/contracts';
import { describe, expect, test } from 'vitest';
import type { TreeNode } from './useTree';
import { deleteRowAction, newRowChoice, treeRowActions, type TreeRowAction } from './useTreeRowActions';

function node(type: string, id = `${type}-1`, children: TreeNode[] = []): TreeNode {
  return { id, type, slug: id, title: `The ${type}`, position: 0, children };
}

function flat(groups: readonly (readonly TreeRowAction[])[]): TreeRowAction[] {
  return groups.flat();
}

function byKind(groups: readonly (readonly TreeRowAction[])[], kind: TreeRowAction['kind']): TreeRowAction[] {
  return flat(groups).filter((action) => action.kind === kind);
}

const MIDDLE = { index: 1, siblingCount: 3, workspaceSlug: 'acme', manageable: new Set<string>(), isOwner: false };

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
      const first = treeRowActions(node('page'), { ...MIDDLE, index: 0 });
      const up = byKind(first, 'move-up')[0]!;
      expect(up.disabled).toBe(true);
      expect(up.reason).toMatch(/already first/i);
      expect(byKind(first, 'move-down')[0]?.disabled).toBe(false);

      const last = treeRowActions(node('page'), { ...MIDDLE, index: 2 });
      const down = byKind(last, 'move-down')[0]!;
      expect(down.disabled).toBe(true);
      expect(down.reason).toMatch(/already last/i);
      expect(byKind(last, 'move-up')[0]?.disabled).toBe(false);
    });

    test('an only child can move neither way, and both say why', () => {
      const only = treeRowActions(node('shelf'), { ...MIDDLE, index: 0, siblingCount: 1 });
      expect(byKind(only, 'move-up')[0]?.disabled).toBe(true);
      expect(byKind(only, 'move-down')[0]?.disabled).toBe(true);
    });
  });

  describe('destinations', () => {
    test('a page opens and has a history; a book has a history; a shelf and a chapter have neither', () => {
      const page = treeRowActions(node('page', 'p1'), MIDDLE);
      expect(byKind(page, 'open')[0]?.to).toBe('/w/acme/p/p1');
      expect(byKind(page, 'history')[0]?.to).toBe('/w/acme/p/p1/history');

      const book = treeRowActions(node('book', 'b1'), MIDDLE);
      expect(byKind(book, 'open')).toHaveLength(0);
      expect(byKind(book, 'history')[0]?.to).toBe('/w/acme/b/b1/history');

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
      for (const ctx of [{ ...MIDDLE, index: 0, siblingCount: 1 }, MIDDLE]) {
        for (const action of flat(treeRowActions(node(type), ctx))) {
          if (action.disabled) expect(action.reason, `${type} ${action.kind}`).toBeTruthy();
          else expect(action.reason, `${type} ${action.kind}`).toBeUndefined();
        }
      }
    }
  });

  /**
   * Delete (navigation-tree spec, "Delete Row Action Is Available Where
   * Trashing Is Permitted" and "Delete Is Disabled With A Stated Reason
   * For A Non-Empty Container"; design.md Decision 8). Offered on every
   * row, last in the menu; live when the row is in the tree response's
   * `manageable` or the caller is the workspace owner; otherwise disabled
   * with the reason on show. A container with visible children is a
   * non-owner's stop, since only the owner may take pages with it — the
   * client's "non-empty" is a lower bound (unreadable children are
   * invisible), and the server's own answer is what the flow acts on.
   */
  describe('delete', () => {
    const manageable = new Set(['page-1', 'chapter-1', 'shelf-1']);

    test('is offered on every row, last, as "Delete…" with the trash icon', () => {
      for (const type of ['shelf', 'book', 'chapter', 'page']) {
        const groups = treeRowActions(node(type), MIDDLE);
        const lastGroup = groups[groups.length - 1]!;
        expect(lastGroup.map((action) => action.kind), type).toEqual(['delete']);
        const [remove] = byKind(groups, 'delete');
        expect(remove?.label).toBe('Delete…');
        expect(remove?.icon).toBe('i-lucide-trash-2');
      }
    });

    test('is live on a manageable page for a member who is not the owner', () => {
      const [remove] = byKind(treeRowActions(node('page'), { ...MIDDLE, manageable }), 'delete');
      expect(remove?.disabled).toBe(false);
      expect(remove?.reason).toBeUndefined();
    });

    test('is disabled with a reason naming manage access when the row is not manageable and the caller is not the owner', () => {
      const [remove] = byKind(treeRowActions(node('page', 'page-9'), { ...MIDDLE, manageable }), 'delete');
      expect(remove?.disabled).toBe(true);
      expect(remove?.reason).toBe('You need manage access to delete this.');
    });

    test('is live on an unmanageable row for the workspace owner', () => {
      const [remove] = byKind(treeRowActions(node('page', 'page-9'), { ...MIDDLE, isOwner: true }), 'delete');
      expect(remove?.disabled).toBe(false);
    });

    test('is disabled with a reason naming the container and what it holds when it has visible children and the caller is not the owner', () => {
      const chapter = node('chapter', 'chapter-1', [node('page', 'page-1')]);
      const [remove] = byKind(treeRowActions(chapter, { ...MIDDLE, manageable }), 'delete');
      expect(remove?.disabled).toBe(true);
      expect(remove?.reason).toBe('Empty this chapter first — only the workspace owner can delete a chapter with pages in it.');

      const shelf = node('shelf', 'shelf-1', [node('book', 'book-1')]);
      expect(byKind(treeRowActions(shelf, { ...MIDDLE, manageable }), 'delete')[0]?.reason).toBe(
        'Empty this shelf first — only the workspace owner can delete a shelf with books in it.',
      );
    });

    test('is live on the same non-empty container for the owner, and on an empty container for a manager', () => {
      const chapter = node('chapter', 'chapter-1', [node('page', 'page-1')]);
      expect(byKind(treeRowActions(chapter, { ...MIDDLE, isOwner: true }), 'delete')[0]?.disabled).toBe(false);
      expect(byKind(treeRowActions(node('chapter', 'chapter-1'), { ...MIDDLE, manageable }), 'delete')[0]?.disabled).toBe(false);
    });

    test('deleteRowAction() is the same decision the menu makes, for the toolbar', () => {
      const chapter = node('chapter', 'chapter-1', [node('page', 'page-1')]);
      expect(deleteRowAction(chapter, { manageable, isOwner: false })).toEqual(byKind(treeRowActions(chapter, { ...MIDDLE, manageable }), 'delete')[0]);
      expect(deleteRowAction(node('page'), { manageable, isOwner: false }).disabled).toBe(false);
    });
  });
});

/**
 * "Never ask a question with one answer" (owner criterion, 2026-09-23). The
 * header's `New…` asks the hierarchy what may go under the picked row: one
 * answer means create it, several mean pick first. The dialog that shipped
 * before this asked with a `Type` radio group holding a single "Shelf"
 * option, which is the defect the owner named.
 *
 * Every case below is derived from the one `LEGAL_PARENT_TYPES` table, so
 * the last test states the property rather than the answers: a change to
 * the table moves the menu, and no list here has to be edited to match.
 */
describe('newRowChoice', () => {
  test('a workspace admits exactly one kind of child — a shelf — so the top level never asks', () => {
    expect(newRowChoice('workspace')).toEqual({ kind: 'one', type: 'shelf' });
  });

  test('a shelf admits exactly one kind of child, and a chapter does too', () => {
    expect(newRowChoice('shelf')).toEqual({ kind: 'one', type: 'book' });
    expect(newRowChoice('chapter')).toEqual({ kind: 'one', type: 'page' });
  });

  test('a book admits two, so it asks — in the table’s own order', () => {
    expect(newRowChoice('book')).toEqual({ kind: 'many', types: ['chapter', 'page'] });
  });

  test('a page holds nothing, so there is nothing to offer', () => {
    expect(newRowChoice('page')).toEqual({ kind: 'none' });
  });

  test('the decision is the one table read backwards, for every type at once', () => {
    for (const parent of Object.keys(LEGAL_PARENT_TYPES) as NodeType[]) {
      const legal = legalChildTypes(parent);
      const choice = newRowChoice(parent);
      if (legal.length === 0) expect(choice, parent).toEqual({ kind: 'none' });
      else if (legal.length === 1) expect(choice, parent).toEqual({ kind: 'one', type: legal[0] });
      else expect(choice, parent).toEqual({ kind: 'many', types: legal });
    }
  });
});
