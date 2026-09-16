import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test, vi } from 'vitest';
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

// Attached to the document: focus and the menu's focus return are real
// only for a node the document holds, and this file asserts both. Each
// mount is taken down after its test so a menu or dialog it portaled
// into the body is gone before the next one looks there.
let mounted: { unmount: () => void } | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

async function mount(props: { workspaceId: string | null; currentNodeId?: string | null } = { workspaceId: 'ws-1' }) {
  const wrapper = await mountSuspended(
    defineComponent({
      name: 'TreeInApp',
      setup: () => () => h(UApp, null, { default: () => h(NavigationTree, props) }),
    }),
    { attachTo: document.body },
  );
  mounted = wrapper;
  return wrapper;
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
   * Every row carries a context menu: right-click, the `⋯` button at the
   * row's end, `Shift+F10` and the `ContextMenu` key all open the same
   * one. Its items come from `treeRowActions` — the one table in
   * `packages/core`, read backwards — and an item the row cannot take
   * right now stays in the menu, `aria-disabled`, with its reason shown.
   */
  describe('a row’s context menu', () => {
    function menu(): HTMLElement | null {
      return document.body.querySelector<HTMLElement>('[role="menu"]');
    }

    function menuItems(): HTMLElement[] {
      return Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    }

    async function settle(): Promise<void> {
      await nextTick();
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    test('every row, whatever its type, carries a named `⋯` trigger', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const triggers = component.findAll('[role="tree"] button[aria-haspopup="menu"]');
      expect(triggers).toHaveLength(4);
      expect(triggers.map((trigger) => trigger.attributes('aria-label'))).toEqual([
        'Actions for Engineering',
        'Actions for Handbook',
        'Actions for First page',
        'Actions for Second page',
      ]);
    });

    test('the trigger is in the tab order only on the row that holds the tree’s tab stop', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const trigger = component.get('[data-node-id="book-1"] button[aria-haspopup="menu"]');
      expect(trigger.attributes('tabindex')).toBe('-1');

      await component.get('[data-node-id="book-1"]').trigger('focus');
      await nextTick();
      expect(trigger.attributes('tabindex')).toBe('0');
    });

    test('right-click on a page row opens its menu: rename, move, open, history and copy — and no "New", since a page holds nothing', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await component.get('[data-node-id="page-1"] [draggable="true"]').trigger('contextmenu', { clientX: 40, clientY: 40 });
      await settle();

      expect(menu()).not.toBeNull();
      const labels = menuItems().map((item) => item.textContent?.trim().replace(/\s+/g, ' '));
      expect(labels.some((label) => label?.startsWith('New '))).toBe(false);
      expect(labels.some((label) => label?.startsWith('Rename…'))).toBe(true);
      expect(labels.some((label) => label?.startsWith('Open'))).toBe(true);
      expect(labels.some((label) => label?.startsWith('History'))).toBe(true);
      expect(labels.some((label) => label?.startsWith('Copy link'))).toBe(true);
      expect(labels.some((label) => /delete/i.test(label ?? ''))).toBe(false);

      // The first of two siblings: "Move up" stays in the menu, disabled
      // with its reason on show; "Move down" is live.
      const up = menuItems().find((item) => item.textContent?.includes('Move up'))!;
      expect(up.getAttribute('aria-disabled')).toBe('true');
      // The reason is in the item itself, visible the moment the menu is
      // open — not behind a hover (§3, §5).
      expect(up.textContent).toMatch(/already first/i);
      const down = menuItems().find((item) => item.textContent?.includes('Move down'))!;
      expect(down.getAttribute('aria-disabled')).toBeNull();
    });

    test('right-click on a shelf row offers "New book…" and nothing to open', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await component.get('[data-node-id="shelf-1"] [draggable="true"]').trigger('contextmenu', { clientX: 40, clientY: 40 });
      await settle();

      const labels = menuItems().map((item) => item.textContent?.trim() ?? '');
      expect(labels.some((label) => label.startsWith('New book…'))).toBe(true);
      expect(labels.some((label) => label.startsWith('Open'))).toBe(false);
      // Right-clicking a row also picks it, the way every explorer does.
      expect(component.get('[data-node-id="shelf-1"]').attributes('aria-selected')).toBe('true');
    });

    test('"Rename…" from the menu opens the toolbar’s own rename dialog for that row — one path, not a second one', async () => {
      const { selectedId } = mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await component.get('[data-node-id="page-2"] [draggable="true"]').trigger('contextmenu', { clientX: 40, clientY: 40 });
      await settle();
      const rename = menuItems().find((item) => item.textContent?.includes('Rename…'))!;
      rename.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();

      expect(selectedId.value).toBe('page-2');
      const dialog = document.body.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog!.textContent).toContain('Second page');
      expect(document.body.querySelector('[data-testid="tree-rename-title"]')).not.toBeNull();
    });

    test('"Move down" from the menu is the same reorder the keyboard makes', async () => {
      const { reorder } = mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await component.get('[data-node-id="page-1"] [draggable="true"]').trigger('contextmenu', { clientX: 40, clientY: 40 });
      await settle();
      const down = menuItems().find((item) => item.textContent?.includes('Move down'))!;
      down.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();

      expect(reorder).toHaveBeenCalledWith('page-1', 'book-1', 1);
    });

    test('Shift+F10 on a row opens the menu, and Escape closes it and puts focus back on the row', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const row = component.get('[data-node-id="book-1"]');
      (row.element as HTMLElement).focus();
      await row.trigger('keydown', { key: 'F10', shiftKey: true });
      await settle();
      expect(menu()).not.toBeNull();

      menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(row.element);
    });

    test('the `⋯` button opens the same menu', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await component.get('[data-node-id="book-1"] button[aria-haspopup="menu"]').trigger('click');
      await settle();

      expect(menu()).not.toBeNull();
      expect(menuItems().some((item) => item.textContent?.includes('New chapter…'))).toBe(true);
      expect(component.get('[data-node-id="book-1"] button[aria-haspopup="menu"]').attributes('aria-expanded')).toBe('true');
    });
  });
});
