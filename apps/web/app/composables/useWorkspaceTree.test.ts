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
});
