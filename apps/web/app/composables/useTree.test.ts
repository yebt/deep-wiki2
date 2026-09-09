import { describe, expect, test, vi } from 'vitest';
import { useTree } from './useTree';

function responseError(status: number) {
  return { response: { status } };
}

describe('useTree', () => {
  test('starts idle and loads a nested tree on success', async () => {
    const nodes = [{ id: 'shelf-1', type: 'shelf', slug: 's', title: 'Shelf', position: 0, children: [] }];
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes }));
    const { status, nodes: treeNodes, load } = useTree('ws-1', { fetchTree });

    expect(status.value).toBe('idle');
    await load();

    expect(status.value).toBe('success');
    expect(treeNodes.value).toEqual(nodes);
  });

  test('an empty tree is a distinct success state with zero nodes', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: [] }));
    const { status, nodes: treeNodes, load } = useTree('ws-1', { fetchTree });

    await load();

    expect(status.value).toBe('success');
    expect(treeNodes.value).toEqual([]);
  });

  test('403/404 map to distinct states', async () => {
    const forbidden = useTree('ws-1', { fetchTree: vi.fn(async () => { throw responseError(403); }) });
    await forbidden.load();
    expect(forbidden.status.value).toBe('forbidden');

    const notFound = useTree('ws-1', { fetchTree: vi.fn(async () => { throw responseError(404); }) });
    await notFound.load();
    expect(notFound.status.value).toBe('not-found');
  });

  test('reorder() calls the position endpoint and reloads the tree on success', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: [] }));
    const reorderFetcher = vi.fn(async () => ({ ok: true }));
    const { reorder } = useTree('ws-1', { fetchTree, reorderFetcher });

    const result = await reorder('node-1', 'parent-1', 2);

    expect(reorderFetcher).toHaveBeenCalledWith('node-1', 'parent-1', 2);
    expect(result).toBe(true);
    expect(fetchTree).toHaveBeenCalled();
  });

  test('reorder() reports failure without touching the loaded tree state on a 403', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: [{ id: 'a', type: 'page', slug: 'a', title: 'A', position: 0, children: [] }] }));
    const reorderFetcher = vi.fn(async () => { throw responseError(403); });
    const { load, reorder, nodes } = useTree('ws-1', { fetchTree, reorderFetcher });
    await load();

    const result = await reorder('a', 'root', 0);

    expect(result).toBe(false);
    expect(nodes.value).toHaveLength(1);
  });
});
