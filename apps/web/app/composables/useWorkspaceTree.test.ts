import { describe, expect, test, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import type { TreeNode } from './useTree';
import { useWorkspaceTree } from './useWorkspaceTree';

const NODES: TreeNode[] = [
  {
    id: 'shelf-1',
    type: 'shelf',
    slug: 'shelf',
    title: 'Engineering',
    position: 0,
    children: [
      {
        id: 'book-1',
        type: 'book',
        slug: 'book',
        title: 'Handbook',
        position: 0,
        children: [{ id: 'page-1', type: 'page', slug: 'one', title: 'First page', position: 0, children: [] }],
      },
    ],
  },
];

/**
 * The sidebar's tree, kept across screens. Every route renders its own
 * `AppShell`, so a tree held in a component ref would be refetched and
 * re-skeletoned on every navigation inside the workspace — the opposite of
 * "the tree is the room's furniture, always at hand" (PRODUCT.md). The
 * loaded nodes, the fold state and the selection live in app state keyed
 * by workspace, and a second mount reads them back before it refreshes.
 */
describe('useWorkspaceTree', () => {
  test('loads through the tree endpoint and exposes the nodes', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: NODES }));
    const tree = useWorkspaceTree(ref<string | null>('ws-load'), { fetchTree });

    expect(tree.status.value).toBe('idle');
    await tree.load();

    expect(tree.status.value).toBe('success');
    expect(tree.nodes.value).toEqual(NODES);
    expect(tree.rootId.value).toBe('root-1');
  });

  test('a second instance for the same workspace starts from the loaded tree, not from nothing', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: NODES }));
    const first = useWorkspaceTree(ref<string | null>('ws-shared'), { fetchTree });
    await first.load();

    const second = useWorkspaceTree(ref<string | null>('ws-shared'), { fetchTree });

    expect(second.status.value).toBe('success');
    expect(second.nodes.value).toEqual(NODES);
  });

  test('folding a container is remembered across instances, and everything starts open', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: NODES }));
    const first = useWorkspaceTree(ref<string | null>('ws-fold'), { fetchTree });
    await first.load();
    expect(first.collapsedIds.value.has('shelf-1')).toBe(false);

    first.toggleCollapsed('shelf-1');
    const second = useWorkspaceTree(ref<string | null>('ws-fold'), { fetchTree });

    expect(second.collapsedIds.value.has('shelf-1')).toBe(true);
  });

  /**
   * "Collapse all" (owner criterion, 2026-09-23) folds many rows at once,
   * so it is one write to the fold set rather than one per row: a fold
   * written per container would be N renders of the tree and N cookie-sized
   * state writes for one press. The ids come from whoever is drawing the
   * tree — the filter, which knows which rows are shown — so this composable
   * stays the place the folds *live* and not a second place that walks them.
   */
  test('collapsing many containers at once is one write, and it keeps the folds already there', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: NODES }));
    const tree = useWorkspaceTree(ref<string | null>('ws-collapse-all'), { fetchTree });
    await tree.load();
    tree.toggleCollapsed('page-1');

    tree.collapseAll(['shelf-1', 'book-1']);

    expect(tree.collapsedIds.value.has('shelf-1')).toBe(true);
    expect(tree.collapsedIds.value.has('book-1')).toBe(true);
    expect(tree.collapsedIds.value.has('page-1'), 'a fold already made is not undone').toBe(true);
  });

  test('revealing a node unfolds every ancestor so the row can be seen', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: NODES }));
    const tree = useWorkspaceTree(ref<string | null>('ws-reveal'), { fetchTree });
    await tree.load();
    tree.toggleCollapsed('shelf-1');
    tree.toggleCollapsed('book-1');

    tree.reveal('page-1');

    expect(tree.collapsedIds.value.has('shelf-1')).toBe(false);
    expect(tree.collapsedIds.value.has('book-1')).toBe(false);
  });

  test('pathTo() names the ancestors of a node in order, and nothing for an unknown id', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: NODES }));
    const tree = useWorkspaceTree(ref<string | null>('ws-path'), { fetchTree });
    await tree.load();

    expect(tree.pathTo('page-1').map((node) => node.title)).toEqual(['Engineering', 'Handbook', 'First page']);
    expect(tree.pathTo('nope')).toEqual([]);
  });

  test('with no workspace there is nothing to load, and the state is idle rather than an error', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: NODES }));
    const tree = useWorkspaceTree(ref<string | null>(null), { fetchTree });

    await tree.load();

    expect(fetchTree).not.toHaveBeenCalled();
    expect(tree.status.value).toBe('idle');
    expect(tree.nodes.value).toEqual([]);
  });

  test('switching the workspace switches the state the refs read from', async () => {
    const fetchTree = vi.fn(async (id: string) => ({ rootId: `root-${id}`, nodes: id === 'ws-a' ? NODES : [] }));
    const workspaceId = ref<string | null>('ws-a');
    const tree = useWorkspaceTree(workspaceId, { fetchTree });
    await tree.load();
    expect(tree.nodes.value).toHaveLength(1);

    workspaceId.value = 'ws-b';
    await nextTick();
    expect(tree.status.value).toBe('idle');
    await tree.load();

    expect(tree.rootId.value).toBe('root-ws-b');
    expect(tree.nodes.value).toEqual([]);
  });

  // ── Optimistic writes, seen through the shared record (2026-09-16) ──
  // The record is what the sidebar draws; a local move that only reached
  // the transport would be invisible until the next full load.

  test('a reorder moves the row in the shared record at once, before the server answers, and never refetches on success', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: TWO_PAGES() }));
    let release!: () => void;
    const reorderFetcher = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => { release = () => resolve({ ok: true }); }));
    const tree = useWorkspaceTree(ref<string | null>('ws-optimistic'), { fetchTree, reorderFetcher });
    await tree.load();

    const pending = tree.reorder('page-2', 'book-1', 0);

    expect(tree.nodes.value[0]!.children.map((node) => node.title)).toEqual(['Second page', 'First page']);
    expect(tree.status.value).toBe('success');
    release();
    await expect(pending).resolves.toBe(true);
    expect(fetchTree).toHaveBeenCalledTimes(1);
    expect(tree.nodes.value[0]!.children.map((node) => node.title)).toEqual(['Second page', 'First page']);
  });

  test('a refused reorder puts the row back in the shared record', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: TWO_PAGES() }));
    const reorderFetcher = vi.fn(async () => { throw { response: { status: 403 } }; });
    const tree = useWorkspaceTree(ref<string | null>('ws-refused'), { fetchTree, reorderFetcher });
    await tree.load();

    await expect(tree.reorder('page-2', 'book-1', 0)).resolves.toBe(false);

    expect(tree.nodes.value[0]!.children.map((node) => node.title)).toEqual(['First page', 'Second page']);
    expect(tree.status.value).toBe('success');
  });

  test('manageable and isOwner reach the shared record, and removeNode() edits it at once with a way back', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: TWO_PAGES(), manageable: ['page-1'], isOwner: false }));
    const tree = useWorkspaceTree(ref<string | null>('ws-removed'), { fetchTree });
    await tree.load();
    expect(tree.manageable.value).toEqual(new Set(['page-1']));
    expect(tree.isOwner.value).toBe(false);

    const second = useWorkspaceTree(ref<string | null>('ws-removed'), { fetchTree });
    const undo = second.removeNode('page-1');
    expect(tree.nodes.value[0]!.children.map((node) => node.title)).toEqual(['Second page']);
    undo();
    expect(tree.nodes.value[0]!.children.map((node) => node.title)).toEqual(['First page', 'Second page']);
  });

  test('a second instance draws a created and a renamed node from the response, and a refresh keeps the rows on screen', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: TWO_PAGES() }));
    const first = useWorkspaceTree(ref<string | null>('ws-created'), { fetchTree });
    await first.load();
    const second = useWorkspaceTree(ref<string | null>('ws-created'), { fetchTree });

    second.applyCreated({ id: 'page-3', parentId: 'book-1', type: 'page', slug: 'third', title: 'Third page', position: 2 });
    second.applyRenamed({ id: 'page-1', slug: 'renamed', title: 'Renamed page' });

    expect(first.nodes.value[0]!.children.map((node) => node.title)).toEqual(['Renamed page', 'Second page', 'Third page']);
    expect(fetchTree).toHaveBeenCalledTimes(1);

    // A refresh from the second instance — whose own transport started
    // empty — keeps the rows up while the answer is on its way.
    let release!: () => void;
    fetchTree.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ rootId: 'root-1', nodes: TWO_PAGES() }); }));
    const refreshing = second.load();
    expect(second.status.value).toBe('success');
    expect(second.nodes.value[0]!.children).toHaveLength(3);
    release();
    await refreshing;
    expect(second.nodes.value[0]!.children).toHaveLength(2);
  });
});

/** book-1 > [page-1, page-2]; a function so no test hands another a mutated copy. */
function TWO_PAGES(): TreeNode[] {
  return [
    {
      id: 'book-1',
      type: 'book',
      slug: 'book',
      title: 'Handbook',
      position: 0,
      children: [
        { id: 'page-1', type: 'page', slug: 'one', title: 'First page', position: 0, children: [] },
        { id: 'page-2', type: 'page', slug: 'two', title: 'Second page', position: 1, children: [] },
      ],
    },
  ];
}
