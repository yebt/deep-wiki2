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
  const applyCreated = vi.fn();
  const applyRenamed = vi.fn();
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
    applyCreated,
    applyRenamed,
    toggleCollapsed: (id: string) => {
      const next = new Set(collapsed.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      collapsed.value = next;
    },
    reveal,
    pathTo: () => [],
  });
  return { load, reorder, applyCreated, applyRenamed, reveal, selectedId };
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

    /**
     * A pointer drop names a slot in the list as drawn — the dragged row
     * still in it — while the server counts slots once the moved row has
     * left (`packages/db/src/nodes/reorder.ts`). Dropping the first page
     * *after* the second therefore reached the server as index 2 of a
     * one-page list and landed one row further than the pointer said, and
     * dropping it *before* a third page landed after it. Found on
     * 2026-09-16 when the local move started to mirror the server's
     * arithmetic; the keyboard and the menu were never affected, because
     * "move down" already counts from the row's own place.
     */
    test('a drop below the dragged row among its own siblings lands where the pointer was, not one row further', async () => {
      const { reorder } = mockTree({ status: 'success', nodes: NODES });
      const component = await mount();
      const rows = component.findAll('.dw-tree-row');
      const secondPage = rows[3]!;

      // page-1 (index 0) dropped in page-2's (index 1) bottom quarter: the node reports slot 2.
      const rect = { top: 100, height: 40 };
      secondPage.element.getBoundingClientRect = () => ({ ...rect, bottom: 140, left: 0, right: 200, width: 200, x: 0, y: 100, toJSON: () => ({}) });
      await secondPage.trigger('dragover', { clientY: 138 });
      await secondPage.trigger('drop', { dataTransfer: { getData: () => 'page-1' } });

      expect(reorder).toHaveBeenCalledWith('page-1', 'book-1', 1);
    });

    test('a drop above the dragged row is unchanged: the rows before it have not moved', async () => {
      const { reorder } = mockTree({ status: 'success', nodes: NODES });
      const component = await mount();
      const firstPage = component.findAll('.dw-tree-row')[2]!;

      firstPage.element.getBoundingClientRect = () => ({ top: 60, height: 40, bottom: 100, left: 0, right: 200, width: 200, x: 0, y: 60, toJSON: () => ({}) });
      await firstPage.trigger('dragover', { clientY: 62 });
      await firstPage.trigger('drop', { dataTransfer: { getData: () => 'page-2' } });

      expect(reorder).toHaveBeenCalledWith('page-2', 'book-1', 0);
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

    test('a created or renamed node is drawn from the server’s response, never by reloading the tree', async () => {
      const { load, applyCreated, applyRenamed } = mockTree({ status: 'success', nodes: NODES });
      const component = await mount();
      const before = load.mock.calls.length;

      const created = { id: 'page-3', parentId: 'book-1', type: 'page', slug: 'three', title: 'Third page', position: 2 };
      component.findComponent(NavigationTreeActions).vm.$emit('created', created);
      const renamed = { id: 'page-1', slug: 'first', title: 'First page, renamed' };
      component.findComponent(NavigationTreeActions).vm.$emit('renamed', renamed);
      await nextTick();

      expect(applyCreated).toHaveBeenCalledWith(created);
      expect(applyRenamed).toHaveBeenCalledWith(renamed);
      expect(load.mock.calls.length).toBe(before);
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
   * The filter above the tree — VS Code's explorer filter. Hidden until
   * asked for, by the header's button or `Ctrl`/`⌘`+`Shift`+`F` while the
   * sidebar has focus; typing prunes the tree to matches and their
   * ancestors, expanded; Escape clears, hides and hands focus back to the
   * tree; the count is announced; the person's folds come back on clear.
   */
  describe('the filter', () => {
    function filterToggle(component: Awaited<ReturnType<typeof mount>>) {
      return component.get('button[aria-label="Filter tree"]');
    }

    function filterBox(component: Awaited<ReturnType<typeof mount>>) {
      return component.find('input[aria-label="Filter tree by title"]');
    }

    async function openAndType(component: Awaited<ReturnType<typeof mount>>, text: string) {
      await filterToggle(component).trigger('click');
      await nextTick();
      const box = filterBox(component);
      await box.setValue(text);
      await nextTick();
      return box;
    }

    test('is hidden by default, behind a named toggle that says what it controls', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const toggle = filterToggle(component);
      expect(toggle.attributes('aria-expanded')).toBe('false');
      expect(toggle.attributes('aria-controls')).toBeTruthy();
      expect(filterBox(component).exists()).toBe(false);
      expect(component.find(`#${toggle.attributes('aria-controls')}`).exists()).toBe(false);
    });

    test('the toggle shows the box, expanded and focused; the same toggle hides it again', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await filterToggle(component).trigger('click');
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const toggle = filterToggle(component);
      expect(toggle.attributes('aria-expanded')).toBe('true');
      const box = filterBox(component);
      expect(box.exists()).toBe(true);
      expect(component.get(`#${toggle.attributes('aria-controls')}`).element.contains(box.element)).toBe(true);
      expect(document.activeElement).toBe(box.element);

      await toggle.trigger('click');
      await nextTick();
      expect(filterBox(component).exists()).toBe(false);
      expect(filterToggle(component).attributes('aria-expanded')).toBe('false');
    });

    test('typing keeps matches and their ancestors, marks the matched text, and announces the count', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await openAndType(component, 'SECOND');

      const rows = component.findAll('[role="treeitem"]');
      expect(rows.map((row) => row.attributes('data-node-id'))).toEqual(['shelf-1', 'book-1', 'page-2']);
      const mark = component.get('[data-node-id="page-2"] mark');
      expect(mark.text()).toBe('Second');
      // The shelf's own row carries no mark; the mark under it is the page's.
      expect(component.find('[data-node-id="shelf-1"] > [draggable="true"] mark').exists()).toBe(false);
      expect(component.get('[data-testid="tree-filter-status"]').text()).toBe('1 match for “SECOND”.');
      expect(component.get('[data-testid="tree-filter-status"]').attributes('role')).toBe('status');
    });

    test('no match is its own state, distinct from an empty tree, with the way out beside it', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await openAndType(component, 'zzz');

      expect(component.find('[role="tree"]').exists()).toBe(false);
      expect(component.find('[data-testid="tree-empty"]').exists()).toBe(false);
      const empty = component.get('[data-testid="tree-filter-empty"]');
      expect(empty.text()).toMatch(/no .* match “zzz”/i);
      expect(component.get('[data-testid="tree-filter-status"]').text()).toBe('No matches for “zzz”.');

      await empty.get('button').trigger('click');
      await nextTick();
      expect(component.findAll('[role="treeitem"]')).toHaveLength(4);
      // Cleared, not hidden: the box stays for the next attempt.
      expect(filterBox(component).exists()).toBe(true);
    });

    test('Escape in the box clears it, hides it, and puts focus back on the tree', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const box = await openAndType(component, 'first');
      expect(component.findAll('[role="treeitem"]')).toHaveLength(3);

      await box.trigger('keydown', { key: 'Escape' });
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(filterBox(component).exists()).toBe(false);
      expect(component.findAll('[role="treeitem"]')).toHaveLength(4);
      expect(document.activeElement?.getAttribute('role')).toBe('treeitem');
    });

    test('a fold the person made survives a filter and is back when the filter clears', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      // Fold the shelf: one row.
      await component.findAll('[role="treeitem"]')[0]!.trigger('keydown', { key: 'Enter' });
      expect(component.findAll('[role="treeitem"]')).toHaveLength(1);

      // The match inside it is shown anyway, ancestors open.
      await openAndType(component, 'second');
      expect(component.findAll('[role="treeitem"]').map((row) => row.attributes('data-node-id'))).toEqual(['shelf-1', 'book-1', 'page-2']);
      expect(component.get('[data-node-id="shelf-1"]').attributes('aria-expanded')).toBe('true');

      // Cleared: the fold is exactly as it was left.
      await filterBox(component).setValue('');
      await nextTick();
      expect(component.findAll('[role="treeitem"]')).toHaveLength(1);
      expect(component.get('[data-node-id="shelf-1"]').attributes('aria-expanded')).toBe('false');
    });

    test('Ctrl+Shift+F while focus is in the tree opens the box; Ctrl+F is left to the browser', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const row = component.get('[role="treeitem"]');
      (row.element as HTMLElement).focus();

      const plainFind = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
      row.element.dispatchEvent(plainFind);
      await nextTick();
      expect(filterBox(component).exists()).toBe(false);
      expect(plainFind.defaultPrevented).toBe(false);

      row.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(filterBox(component).exists()).toBe(true);
      expect(document.activeElement).toBe(filterBox(component).element);
    });

    test('is not offered while the tree has nothing to filter', async () => {
      mockTree({ status: 'success', nodes: [] });
      const component = await mount();
      expect(component.find('button[aria-label="Filter tree"]').exists()).toBe(false);
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
