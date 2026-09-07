import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import TreePage from './tree.vue';

const { useTreeMock, useRouteMock, navigateToMock } = vi.hoisted(() => ({
  useTreeMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { workspaceId: 'ws-1' } })),
  // `navigateTo`, not `useRouter`: mocking the router replaces the instance
  // Nuxt's own plugins call `afterEach`/`beforeResolve` on, and the suite
  // dies before a single assertion runs.
  navigateToMock: vi.fn(async () => {}),
}));

mockNuxtImport('useTree', () => useTreeMock);
mockNuxtImport('useRoute', () => useRouteMock);
mockNuxtImport('navigateTo', () => navigateToMock);

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(TreePage) }),
});

function mockTree(overrides: { status?: string; nodes?: unknown[]; message?: string } = {}) {
  navigateToMock.mockClear();
  const load = vi.fn(async () => {});
  const reorder = vi.fn(async () => true);
  useTreeMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    nodes: ref(overrides.nodes ?? []),
    rootId: ref('root-1'),
    message: ref(overrides.message ?? ''),
    load,
    reorder,
  });
  return { load, reorder };
}

describe('navigation tree page', () => {
  test('renders the loading skeleton while the tree is being requested', async () => {
    mockTree({ status: 'loading' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('[data-testid="tree-skeleton"]').exists()).toBe(true);
  });

  test('renders the first-run empty state, naming shelves by their product vocabulary', async () => {
    mockTree({ status: 'success', nodes: [] });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/no shelves yet/i);
  });

  test('renders only readable nodes as tree items, hiding an unreadable chapter entirely', async () => {
    mockTree({
      status: 'success',
      nodes: [
        {
          id: 'shelf-1',
          type: 'shelf',
          slug: 'shelf',
          title: 'Engineering',
          position: 0,
          children: [{ id: 'book-1', type: 'book', slug: 'book', title: 'Handbook', position: 0, children: [] }],
        },
      ],
    });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toContain('Engineering');
    expect(component.text()).toContain('Handbook');
    expect(component.find('[role="tree"]').exists()).toBe(true);
    expect(component.findAll('[role="treeitem"]')).toHaveLength(2);
  });

  test('renders a permission-denied state for the whole workspace', async () => {
    mockTree({ status: 'forbidden' });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/don't have access to this workspace/i);
  });

  /*
   * The keyboard contract. `NavigationTreeNode` is a hand-rolled exception
   * to docs/UI-CHECKLIST.md §4.1 because `UTree` cannot drag-reorder, and
   * the first version of it shipped with none of the keyboard handling
   * `UTree` would have brought: measured on 2026-09-07, the whole tree was
   * zero tab stops, so a keyboard user could neither open a page nor move
   * one (§5, automatic fail). These three tests are what stops that
   * returning silently.
   */
  describe('keyboard', () => {
    const NODES = [
      {
        id: 'shelf-1',
        type: 'shelf',
        slug: 'shelf',
        title: 'Engineering',
        position: 0,
        children: [
          { id: 'page-1', type: 'page', slug: 'one', title: 'First page', position: 0, children: [] },
          { id: 'page-2', type: 'page', slug: 'two', title: 'Second page', position: 1, children: [] },
        ],
      },
    ];

    test('the tree is exactly one tab stop, and it is the first row', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mountSuspended(PageInApp);

      const items = component.findAll('[role="treeitem"]');
      expect(items.length).toBe(3);
      expect(items.filter((item) => item.attributes('tabindex') === '0')).toHaveLength(1);
      expect(items[0]!.attributes('tabindex')).toBe('0');
      // Position in the set is announced, not left to be counted.
      expect(items[0]!.attributes('aria-level')).toBe('1');
      expect(items[1]!.attributes('aria-level')).toBe('2');
      expect(items[1]!.attributes('aria-posinset')).toBe('1');
      expect(items[1]!.attributes('aria-setsize')).toBe('2');
    });

    test('Enter on a page row opens it, and on a shelf row does nothing', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mountSuspended(PageInApp);
      const items = component.findAll('[role="treeitem"]');

      await items[0]!.trigger('keydown', { key: 'Enter' });
      expect(navigateToMock).not.toHaveBeenCalled();

      await items[1]!.trigger('keydown', { key: 'Enter' });
      expect(navigateToMock).toHaveBeenCalledWith('/pages/page-1');
    });

    test('Alt with an arrow key reorders among siblings, the keyboard equivalent of a drag', async () => {
      const { reorder } = mockTree({ status: 'success', nodes: NODES });
      const component = await mountSuspended(PageInApp);
      const items = component.findAll('[role="treeitem"]');

      // The first child cannot move up; the second can.
      await items[1]!.trigger('keydown', { key: 'ArrowUp', altKey: true });
      expect(reorder).not.toHaveBeenCalled();

      await items[1]!.trigger('keydown', { key: 'ArrowDown', altKey: true });
      expect(reorder).toHaveBeenCalledWith('page-1', 'shelf-1', 1);
    });
  });
});
