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

  // A 401 is neither denial nor a dead connection: the person is signed
  // out, and the screen's next move is sign-in (`useSignInRedirect`), not
  // a retry that would 401 again. Before 2026-09-16 it fell through to
  // network-error and the screen said "Cannot reach the server".
  test('a 401 resolves to unauthenticated, not to a network error', async () => {
    const { status, load } = useTree('ws-1', { fetchTree: vi.fn(async () => { throw responseError(401); }) });
    await load();
    expect(status.value).toBe('unauthenticated');
  });

  test('403/404 map to distinct states', async () => {
    const forbidden = useTree('ws-1', { fetchTree: vi.fn(async () => { throw responseError(403); }) });
    await forbidden.load();
    expect(forbidden.status.value).toBe('forbidden');

    const notFound = useTree('ws-1', { fetchTree: vi.fn(async () => { throw responseError(404); }) });
    await notFound.load();
    expect(notFound.status.value).toBe('not-found');
  });

  // ── Optimistic writes (2026-09-16) ────────────────────────────────
  // Until then every write waited for the server and then reloaded the
  // whole tree: a dragged row snapped back to where it started until two
  // round trips had landed, and a created row appeared on the second
  // (perf-report §3, docs/TODO.md Findings 2026-09-16). The local tree now
  // moves first and the request follows; only a refusal puts things back.

  test('reorder() moves the node locally at once and does not refetch on success', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: SIBLINGS() }));
    let release!: () => void;
    const reorderFetcher = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => { release = () => resolve({ ok: true }); }));
    const { load, reorder, nodes } = useTree('ws-1', { fetchTree, reorderFetcher });
    await load();

    const pending = reorder('a', 'root-1', 1);

    // Before the server has answered: the row is already where it was dropped.
    expect(titles(nodes.value)).toEqual(['B', 'A', 'C']);
    release();
    await expect(pending).resolves.toBe(true);
    expect(titles(nodes.value)).toEqual(['B', 'A', 'C']);
    expect(reorderFetcher).toHaveBeenCalledWith('a', 'root-1', 1);
    expect(fetchTree).toHaveBeenCalledTimes(1);
  });

  test('a rejected reorder restores the order it had before the drag', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: SIBLINGS() }));
    const reorderFetcher = vi.fn(async () => { throw responseError(403); });
    const { load, reorder, nodes } = useTree('ws-1', { fetchTree, reorderFetcher });
    await load();

    const result = await reorder('c', 'root-1', 0);

    expect(result).toBe(false);
    expect(titles(nodes.value)).toEqual(['A', 'B', 'C']);
    expect(fetchTree).toHaveBeenCalledTimes(1);
  });

  test('reorder() counts the index the way the server does: among the siblings once the moved node has left', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: SIBLINGS() }));
    const { load, reorder, nodes } = useTree('ws-1', { fetchTree, reorderFetcher: vi.fn(async () => ({ ok: true })) });
    await load();

    // Past the end is clamped to the end, as `reorderNode` clamps it.
    await reorder('a', 'root-1', 9);
    expect(titles(nodes.value)).toEqual(['B', 'C', 'A']);
    // Positions follow the new order, so anything that sorts by them agrees with the array.
    expect(nodes.value.map((node) => node.position)).toEqual([0, 1, 2]);
  });

  test('reorder() can move a node under another parent, appended where asked', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: NESTED() }));
    const { load, reorder, nodes } = useTree('ws-1', { fetchTree, reorderFetcher: vi.fn(async () => ({ ok: true })) });
    await load();

    await reorder('page-1', 'chapter-1', 0);

    expect(titles(nodes.value[0]!.children)).toEqual(['Chapter']);
    expect(titles(nodes.value[0]!.children[0]!.children)).toEqual(['First page', 'Deep page']);
  });

  test('applyCreated() appends the server\'s new node under its parent — the top level for the root — without a refetch', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: NESTED() }));
    const { load, applyCreated, nodes } = useTree('ws-1', { fetchTree });
    await load();

    applyCreated({ id: 'page-2', parentId: 'book-1', type: 'page', slug: 'second', title: 'Second page', position: 2 });
    applyCreated({ id: 'shelf-2', parentId: 'root-1', type: 'shelf', slug: 'design', title: 'Design', position: 1 });

    expect(titles(nodes.value)).toEqual(['Handbook', 'Design']);
    expect(titles(nodes.value[0]!.children)).toEqual(['Chapter', 'First page', 'Second page']);
    expect(nodes.value[0]!.children[2]).toEqual({ id: 'page-2', type: 'page', slug: 'second', title: 'Second page', position: 2, children: [] });
    expect(fetchTree).toHaveBeenCalledTimes(1);
  });

  test('applyRenamed() patches the one node\'s title and slug in place', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: NESTED() }));
    const { load, applyRenamed, nodes } = useTree('ws-1', { fetchTree });
    await load();

    applyRenamed({ id: 'deep-1', slug: 'deeper', title: 'Deeper page' });

    const deep = nodes.value[0]!.children[0]!.children[0]!;
    expect(deep).toMatchObject({ id: 'deep-1', slug: 'deeper', title: 'Deeper page' });
    expect(titles(nodes.value[0]!.children)).toEqual(['Chapter', 'First page']);
    expect(fetchTree).toHaveBeenCalledTimes(1);
  });
});

/** Three siblings at the top level. A function, so no test can hand another a mutated copy. */
function SIBLINGS() {
  return [
    { id: 'a', type: 'shelf', slug: 'a', title: 'A', position: 0, children: [] },
    { id: 'b', type: 'shelf', slug: 'b', title: 'B', position: 1, children: [] },
    { id: 'c', type: 'shelf', slug: 'c', title: 'C', position: 2, children: [] },
  ];
}

/** book-1 > [chapter-1 > [deep-1], page-1]. */
function NESTED() {
  return [
    {
      id: 'book-1',
      type: 'book',
      slug: 'handbook',
      title: 'Handbook',
      position: 0,
      children: [
        {
          id: 'chapter-1',
          type: 'chapter',
          slug: 'chapter',
          title: 'Chapter',
          position: 0,
          children: [{ id: 'deep-1', type: 'page', slug: 'deep', title: 'Deep page', position: 0, children: [] }],
        },
        { id: 'page-1', type: 'page', slug: 'first', title: 'First page', position: 1, children: [] },
      ],
    },
  ];
}

function titles(nodes: readonly { title: string }[]): string[] {
  return nodes.map((node) => node.title);
}

/**
 * ── The trap this bug hides behind ─────────────────────────────────────
 *
 * A mock that rejects with a plain `new Error('fetch failed')`, or with
 * `{ response: { status: 500 } }`, does NOT reproduce the defect: both
 * classify correctly even against the broken guard. It only appears with
 * ofetch's real shape — `response` present as an own key and set to
 * `undefined`, because no response ever arrived — which makes
 * `'response' in error` true and lets `error.response.status` throw
 * *inside the catch block*, before any status is assigned.
 *
 * These therefore assert that the composable SETTLES, not only how it
 * classifies: a status that never leaves `loading` is the blank screen.
 */
function unreachableApi(): Error & { readonly response: undefined } {
  return Object.assign(new Error('fetch failed'), { response: undefined });
}

describe('useTree when the API never responded', () => {
  test('the fixture carries ofetch real shape, not a convenient mock', () => {
    const error = unreachableApi();

    expect('response' in error).toBe(true);
    expect(error.response).toBeUndefined();
  });

  test('load() settles into network-error instead of hanging on the loading skeleton', async () => {
    const { status, message, load } = useTree('ws-1', {
      fetchTree: vi.fn(async () => {
        throw unreachableApi();
      }),
    });

    const settled = await load().then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );

    expect(status.value).not.toBe('loading');
    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/try again/i);
    expect(settled).toBe('resolved');
  });

  test('reorder() reports failure rather than throwing when the API never responded', async () => {
    const fetchTree = vi.fn(async () => ({ rootId: 'root-1', nodes: [] }));
    const { reorder } = useTree('ws-1', {
      fetchTree,
      reorderFetcher: vi.fn(async () => {
        throw unreachableApi();
      }),
    });

    await expect(reorder('a', 'root', 0)).resolves.toBe(false);
  });
});
