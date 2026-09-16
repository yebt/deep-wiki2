import { describe, expect, test } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import type { TreeNode } from './useTree';
import { filterTree, highlightSegments, useTreeFilter } from './useTreeFilter';

function node(id: string, type: string, title: string, children: TreeNode[] = []): TreeNode {
  return { id, type, slug: id, title, position: 0, children };
}

const TREE: readonly TreeNode[] = [
  node('shelf-eng', 'shelf', 'Engineering', [
    node('book-hand', 'book', 'Handbook', [
      node('page-auth', 'page', 'Authentication'),
      node('page-deploy', 'page', 'Deploying'),
      node('ch-ops', 'chapter', 'Operations', [node('page-oncall', 'page', 'On-call rota')]),
    ]),
    node('book-auth', 'book', 'Auth service', [node('page-tokens', 'page', 'Tokens')]),
  ]),
  node('shelf-design', 'shelf', 'Design', [node('book-brand', 'book', 'Brand')]),
];

function ids(list: readonly TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const n of nodes) {
      out.push(n.id);
      walk(n.children);
    }
  };
  walk(list);
  return out;
}

describe('filterTree', () => {
  test('an empty or blank query is no filter: the tree is returned as is, with nothing counted as a match', () => {
    for (const query of ['', '   ']) {
      const result = filterTree(TREE, query);
      expect(result.nodes).toBe(TREE);
      expect(result.matchCount).toBe(0);
      expect(result.matchIds.size).toBe(0);
    }
  });

  test('matches by title, case-insensitively, on a substring', () => {
    const result = filterTree(TREE, 'AUTH');
    expect([...result.matchIds].sort()).toEqual(['book-auth', 'page-auth']);
    expect(result.matchCount).toBe(2);
  });

  test('keeps every ancestor of a match and drops everything else', () => {
    const result = filterTree(TREE, 'on-call');
    expect(ids(result.nodes)).toEqual(['shelf-eng', 'book-hand', 'ch-ops', 'page-oncall']);
    // The ancestors are kept, not matched: the count is the matches alone.
    expect(result.matchCount).toBe(1);
  });

  test('a matching container keeps its whole subtree, so what sits under a hit stays reachable', () => {
    const result = filterTree(TREE, 'handbook');
    expect(ids(result.nodes)).toEqual(['shelf-eng', 'book-hand', 'page-auth', 'page-deploy', 'ch-ops', 'page-oncall']);
    expect(result.matchCount).toBe(1);
  });

  test('sibling order survives the pruning', () => {
    const result = filterTree(TREE, 'd');
    // "Handbook", "Deploying", "Design", "Brand" — in tree order.
    expect(ids(result.nodes)).toEqual(['shelf-eng', 'book-hand', 'page-auth', 'page-deploy', 'ch-ops', 'page-oncall', 'shelf-design', 'book-brand']);
  });

  test('nothing matching is an empty list with a zero count, never a throw', () => {
    const result = filterTree(TREE, 'zzz');
    expect(result.nodes).toEqual([]);
    expect(result.matchCount).toBe(0);
  });
});

describe('highlightSegments', () => {
  test('splits a title around the first case-insensitive occurrence, keeping the title’s own casing', () => {
    expect(highlightSegments('Authentication', 'AUTH')).toEqual([{ text: 'Auth', match: true }, { text: 'entication', match: false }]);
    expect(highlightSegments('On-call rota', 'call')).toEqual([
      { text: 'On-', match: false },
      { text: 'call', match: true },
      { text: ' rota', match: false },
    ]);
  });

  test('a title without the query, or an empty query, is one unmarked segment', () => {
    expect(highlightSegments('Brand', 'auth')).toEqual([{ text: 'Brand', match: false }]);
    expect(highlightSegments('Brand', '')).toEqual([{ text: 'Brand', match: false }]);
  });
});

describe('useTreeFilter', () => {
  function setup() {
    const nodes = ref<readonly TreeNode[]>(TREE);
    const folds = ref(new Set<string>(['shelf-design']));
    const collapsedIds = computed<ReadonlySet<string>>(() => folds.value);
    const toggleCollapsed = (id: string): void => {
      const next = new Set(folds.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      folds.value = next;
    };
    const filter = useTreeFilter(nodes, collapsedIds, toggleCollapsed);
    return { folds, filter };
  }

  test('starts hidden and inactive, showing the tree as it is with the person’s own folds', () => {
    const { filter } = setup();
    expect(filter.open.value).toBe(false);
    expect(filter.active.value).toBe(false);
    expect(filter.shownNodes.value).toEqual(TREE);
    expect(filter.effectiveCollapsedIds.value.has('shelf-design')).toBe(true);
    expect(filter.announcement.value).toBe('');
  });

  test('typing filters and auto-expands: while a query is active no ancestor of a match is folded', async () => {
    const { filter } = setup();
    filter.show();
    filter.query.value = 'brand';
    await nextTick();

    expect(filter.active.value).toBe(true);
    expect(ids(filter.shownNodes.value)).toEqual(['shelf-design', 'book-brand']);
    // The person had folded "Design"; the match inside it is shown anyway.
    expect(filter.effectiveCollapsedIds.value.has('shelf-design')).toBe(false);
    expect(filter.matchCount.value).toBe(1);
    expect(filter.announcement.value).toBe('1 match for “brand”.');
  });

  test('the count announces plural and none', async () => {
    const { filter } = setup();
    filter.show();
    filter.query.value = 'auth';
    await nextTick();
    expect(filter.announcement.value).toBe('2 matches for “auth”.');
    filter.query.value = 'nothing here';
    await nextTick();
    expect(filter.announcement.value).toBe('No matches for “nothing here”.');
    expect(filter.shownNodes.value).toEqual([]);
  });

  test('clearing the filter restores the folds exactly as they were, untouched by the auto-expand', async () => {
    const { folds, filter } = setup();
    filter.show();
    filter.query.value = 'brand';
    await nextTick();
    expect(filter.effectiveCollapsedIds.value.has('shelf-design')).toBe(false);

    filter.clear();
    await nextTick();

    expect(filter.active.value).toBe(false);
    expect(filter.shownNodes.value).toEqual(TREE);
    expect(filter.effectiveCollapsedIds.value.has('shelf-design')).toBe(true);
    expect([...folds.value]).toEqual(['shelf-design']);
  });

  test('a fold made while filtering holds for that query and never leaks into the person’s own folds', async () => {
    const { folds, filter } = setup();
    filter.show();
    filter.query.value = 'auth';
    await nextTick();

    filter.toggleCollapsed('shelf-eng');
    expect(filter.effectiveCollapsedIds.value.has('shelf-eng')).toBe(true);
    expect(folds.value.has('shelf-eng')).toBe(false);

    // A new query starts expanded again.
    filter.query.value = 'auth s';
    await nextTick();
    expect(filter.effectiveCollapsedIds.value.has('shelf-eng')).toBe(false);

    filter.hide();
    await nextTick();
    expect(filter.open.value).toBe(false);
    expect(filter.query.value).toBe('');
    expect(folds.value.has('shelf-eng')).toBe(false);
    expect(filter.effectiveCollapsedIds.value.has('shelf-design')).toBe(true);
  });

  test('a fold made while the box is open but empty is the person’s own', () => {
    const { folds, filter } = setup();
    filter.show();
    filter.toggleCollapsed('shelf-eng');
    expect(folds.value.has('shelf-eng')).toBe(true);
  });
});
