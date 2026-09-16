import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import NavigationTreeActions from '~/components/NavigationTreeActions.vue';
import NavigationTree from './NavigationTree.vue';

/**
 * The navigation tree, housed in the sidebar. This file carries what
 * `pages/workspaces/[workspaceId]/tree.test.ts` carried until the tree
 * stopped being a screen: the keyboard contract, the write toolbar's
 * placement, the four request states — plus what the housing added, the
 * book row's context action and the current page's marking.
 */
const { useWorkspaceTreeMock, navigateToMock } = vi.hoisted(() => ({
  useWorkspaceTreeMock: vi.fn(),
  navigateToMock: vi.fn(async () => {}),
}));

mockNuxtImport('useWorkspaceTree', () => useWorkspaceTreeMock);
mockNuxtImport('navigateTo', () => navigateToMock);

function mockTree(overrides: { status?: string; nodes?: unknown[]; message?: string } = {}) {
  navigateToMock.mockClear();
  const load = vi.fn(async () => {});
  const reorder = vi.fn(async () => true);
  const collapsed = ref(new Set<string>());
  const selectedId = ref<string | null>(null);
  const nodes = ref(overrides.nodes ?? []);
  const reveal = vi.fn();
  useWorkspaceTreeMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    nodes,
    rootId: ref('root-1'),
    message: ref(overrides.message ?? ''),
    collapsedIds: computed(() => collapsed.value),
    selectedId,
    load,
    reorder,
    toggleCollapsed: (id: string) => {
      const next = new Set(collapsed.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      collapsed.value = next;
    },
    reveal,
    pathTo: () => [],
  });
  return { load, reorder, reveal, selectedId };
}

function mount(props: { workspaceId: string | null; currentNodeId?: string | null } = { workspaceId: 'ws-1' }) {
  return mountSuspended(
    defineComponent({
      name: 'TreeInApp',
      setup: () => () => h(UApp, null, { default: () => h(NavigationTree, props) }),
    }),
  );
}

const NODES = [
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
        slug: 'handbook',
        title: 'Handbook',
        position: 0,
        children: [
          { id: 'page-1', type: 'page', slug: 'one', title: 'First page', position: 0, children: [] },
          { id: 'page-2', type: 'page', slug: 'two', title: 'Second page', position: 1, children: [] },
        ],
      },
    ],
  },
];

describe('NavigationTree', () => {
  describe('states', () => {
    test('loads the workspace on mount', async () => {
      const { load } = mockTree({ status: 'loading' });
      await mount();
      expect(load).toHaveBeenCalled();
    });

    test('renders the loading skeleton while the tree is being requested', async () => {
      mockTree({ status: 'loading' });
      const component = await mount();
      expect(component.find('[data-testid="tree-skeleton"]').exists()).toBe(true);
    });

    test('renders the first-run empty state in the product’s vocabulary, with the way to the first shelf', async () => {
      mockTree({ status: 'success', nodes: [] });
      const component = await mount();
      expect(component.text()).toMatch(/no shelves yet/i);
      expect(component.findComponent(NavigationTreeActions).exists()).toBe(true);
    });

    test('renders only readable nodes as tree items', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();
      expect(component.find('[role="tree"]').exists()).toBe(true);
      expect(component.findAll('[role="treeitem"]')).toHaveLength(4);
    });

    test('denied and missing are plain states, never alerts; a dead connection is an alert with a retry', async () => {
      mockTree({ status: 'forbidden' });
      const forbidden = await mount();
      expect(forbidden.text()).toMatch(/don't have access to this workspace/i);
      expect(forbidden.find('[role="alert"]').exists()).toBe(false);

      mockTree({ status: 'network-error', message: 'Cannot reach the server.' });
      const failed = await mount();
      expect(failed.find('[role="alert"]').text()).toContain('Cannot reach the server.');
      expect(failed.find('[role="alert"] button').text()).toBe('Retry');
    });

    test('no write affordance is offered while the tree is unknown or refused', async () => {
      for (const status of ['loading', 'forbidden', 'not-found', 'network-error']) {
        mockTree({ status });
        const component = await mount();
        expect(component.findComponent(NavigationTreeActions).exists(), status).toBe(false);
      }
    });

    // The tree is the frame's own request, made on every screen inside a
    // workspace, so it is the frame's own signed-out state: the one rule —
    // leave for sign-in and come back — applies here as on the screen.
    test('a signed-out visitor is sent to sign in, and the pane shows no error', async () => {
      mockTree({ status: 'unauthenticated' });
      const component = await mount();
      expect(navigateToMock).toHaveBeenCalledWith(expect.stringMatching(/^\/login(\?next=|$)/), { replace: true });
      expect(component.find('[role="alert"]').exists()).toBe(false);
    });

    test('with no workspace, nothing is requested', async () => {
      const { load } = mockTree({ status: 'idle' });
      await mount({ workspaceId: null });
      expect(load).not.toHaveBeenCalled();
    });
  });

  describe('the header row', () => {
    // The paragraph of keyboard help that stood above the old screen is now
    // a `?` tooltip on the header row — and the same sentence stays in the
    // DOM as the tree's description, so it is not hover-only (§5).
    test('offers keyboard help from a named control, and the tree is described by the same sentence', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const help = component.get('button[aria-label="Keyboard help"]');
      expect(help.attributes('type')).toBe('button');
      const tree = component.get('[role="tree"]');
      const describedBy = tree.attributes('aria-describedby')!;
      expect(component.get(`#${describedBy}`).text()).toMatch(/Alt with the arrow keys/);
      expect(component.get(`#${tree.attributes('aria-labelledby')}`).text()).toBe('Contents');
    });
  });

  describe('keyboard', () => {
    test('the tree is exactly one tab stop, and it is the first row', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const items = component.findAll('[role="treeitem"]');
      expect(items.filter((item) => item.attributes('tabindex') === '0')).toHaveLength(1);
      expect(items[0]!.attributes('tabindex')).toBe('0');
      expect(items[1]!.attributes('aria-level')).toBe('2');
      expect(items[2]!.attributes('aria-posinset')).toBe('1');
      expect(items[2]!.attributes('aria-setsize')).toBe('2');
    });

    test('Enter on a page row opens it', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await component.findAll('[role="treeitem"]')[2]!.trigger('keydown', { key: 'Enter' });
      expect(navigateToMock).toHaveBeenCalledWith('/pages/page-1');
    });

    test('Enter on a shelf row folds it and Enter again unfolds it', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await component.findAll('[role="treeitem"]')[0]!.trigger('keydown', { key: 'Enter' });
      expect(navigateToMock).not.toHaveBeenCalled();
      expect(component.findAll('[role="treeitem"]')).toHaveLength(1);
      expect(component.get('[role="treeitem"]').attributes('aria-expanded')).toBe('false');

      await component.get('[role="treeitem"]').trigger('keydown', { key: 'Enter' });
      expect(component.findAll('[role="treeitem"]')).toHaveLength(4);
    });

    test('ArrowLeft folds an open container and ArrowRight unfolds a folded one', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await component.findAll('[role="treeitem"]')[0]!.trigger('keydown', { key: 'ArrowLeft' });
      expect(component.findAll('[role="treeitem"]')).toHaveLength(1);
      await component.get('[role="treeitem"]').trigger('keydown', { key: 'ArrowRight' });
      expect(component.findAll('[role="treeitem"]')).toHaveLength(4);
      expect(component.findAll('[role="treeitem"]')[0]!.attributes('tabindex')).toBe('0');
    });

    test('an arrow key from a nested row moves one row, not back to where it started', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();
      const items = component.findAll('[role="treeitem"]');

      await items[2]!.trigger('keydown', { key: 'ArrowDown' });

      expect(items[3]!.attributes('tabindex')).toBe('0');
      expect(items.filter((item) => item.attributes('tabindex') === '0')).toHaveLength(1);
    });

    test('Alt with an arrow key reorders among siblings, the keyboard equivalent of a drag', async () => {
      const { reorder } = mockTree({ status: 'success', nodes: NODES });
      const component = await mount();
      const items = component.findAll('[role="treeitem"]');

      await items[2]!.trigger('keydown', { key: 'ArrowUp', altKey: true });
      expect(reorder).not.toHaveBeenCalled();

      await items[2]!.trigger('keydown', { key: 'ArrowDown', altKey: true });
      expect(reorder).toHaveBeenCalledWith('page-1', 'book-1', 1);
    });
  });

  describe('creating and renaming', () => {
    test('the toolbar renders with the loaded tree, outside the tree itself', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const actions = component.findComponent(NavigationTreeActions);
      expect(actions.exists()).toBe(true);
      expect(component.find('[role="tree"]').element.contains(actions.element)).toBe(false);
    });

    test('a write reloads the tree, so the new node is the server’s answer and not a guess', async () => {
      const { load } = mockTree({ status: 'success', nodes: NODES });
      const component = await mount();
      const before = load.mock.calls.length;

      component.findComponent(NavigationTreeActions).vm.$emit('changed');
      await nextTick();

      expect(load.mock.calls.length).toBe(before + 1);
    });

    test('the toolbar has no selection until the user picks a row; picking one hands it over and marks it', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const actions = component.findComponent(NavigationTreeActions);
      expect(actions.props('selectedId')).toBeNull();
      expect(component.findAll('[aria-selected="true"]')).toHaveLength(0);

      await component.findAll('[role="treeitem"]')[0]!.trigger('focus');
      await nextTick();

      expect(actions.props('selectedId')).toBe('shelf-1');
      expect(component.findAll('[aria-selected="true"]')[0]!.attributes('data-node-id')).toBe('shelf-1');
    });
  });

  describe('the open page', () => {
    test('is marked current, selected, and its ancestors are revealed', async () => {
      const { reveal, selectedId } = mockTree({ status: 'success', nodes: NODES });
      const component = await mount({ workspaceId: 'ws-1', currentNodeId: 'page-2' });

      expect(component.get('[aria-current="page"]').attributes('data-node-id')).toBe('page-2');
      expect(selectedId.value).toBe('page-2');
      expect(reveal).toHaveBeenCalledWith('page-2');
    });
  });

  /*
   * A book's history used to be a strip of "Book history: A B C" links in
   * the app bar. It is a context action on the book's own row now — a menu
   * at the row's end, named for the book, present on book rows alone.
   */
  describe('a book row’s context action', () => {
    test('every book row, and only a book row, carries a named menu trigger', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const triggers = component.findAll('[role="tree"] button[aria-haspopup="menu"]');
      expect(triggers).toHaveLength(1);
      expect(triggers[0]!.attributes('aria-label')).toBe('Actions for Handbook');
      expect(component.get('[data-node-id="book-1"]').element.contains(triggers[0]!.element)).toBe(true);
    });

    test('the trigger is in the tab order only on the row that holds the tree’s tab stop', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const trigger = component.get('[role="tree"] button[aria-haspopup="menu"]');
      expect(trigger.attributes('tabindex')).toBe('-1');

      await component.get('[data-node-id="book-1"]').trigger('focus');
      await nextTick();
      expect(trigger.attributes('tabindex')).toBe('0');
    });
  });
});
