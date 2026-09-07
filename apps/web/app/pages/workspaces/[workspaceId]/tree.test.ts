import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import TreePage from './tree.vue';

const { useTreeMock, useRouteMock } = vi.hoisted(() => ({
  useTreeMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { workspaceId: 'ws-1' } })),
}));

mockNuxtImport('useTree', () => useTreeMock);
mockNuxtImport('useRoute', () => useRouteMock);

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(TreePage) }),
});

function mockTree(overrides: { status?: string; nodes?: unknown[]; message?: string } = {}) {
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
});
