import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import NavigationTreeActions from '~/components/NavigationTreeActions.vue';
import type { TreeNode } from '~/composables/useTree';
import type { ForceDeleteFetcher, TrashFetcher } from '~/composables/useTrash';
import type { CreateNodeFetcher, RenameNodeFetcher } from '~/composables/useTreeRowEditor';
import NavigationTree from './NavigationTree.vue';

/**
 * The navigation tree, housed in the sidebar. This file carries what
 * `pages/workspaces/[workspaceId]/tree.test.ts` carried until the tree
 * stopped being a screen: the keyboard contract, the write toolbar's
 * placement, the four request states — plus what the housing added, the
 * book row's context action and the current page's marking.
 */
const { useWorkspaceTreeMock, navigateToMock, preloadRouteComponentsMock } = vi.hoisted(() => ({
  useWorkspaceTreeMock: vi.fn(),
  navigateToMock: vi.fn(async () => {}),
  preloadRouteComponentsMock: vi.fn(async () => {}),
}));

mockNuxtImport('useWorkspaceTree', () => useWorkspaceTreeMock);
mockNuxtImport('navigateTo', () => navigateToMock);
// A page row warms its route on focus (`NavigationTreeNode`); the real
// preload imports the read screen's module here, which is not what these
// tests are about and slowed the menu's focus return past its wait under
// load. `NavigationTreeNode.test.ts` holds the warming itself.
mockNuxtImport('preloadRouteComponents', () => preloadRouteComponentsMock);

function mockTree(overrides: { status?: string; nodes?: unknown[]; message?: string; manageable?: string[]; isOwner?: boolean } = {}) {
  navigateToMock.mockClear();
  const load = vi.fn(async () => {});
  const reorder = vi.fn(async () => true);
  const applyCreated = vi.fn();
  const applyRenamed = vi.fn();
  const collapsed = ref(new Set<string>());
  const selectedId = ref<string | null>(null);
  const nodes = ref(overrides.nodes ?? []);
  const reveal = vi.fn();
  // The real `removeNode`: the row leaves the (mocked) shared record at once, and the undo puts the exact tree back.
  const removeNode = vi.fn((id: string) => {
    const before = nodes.value;
    const prune = (list: TreeNode[]): TreeNode[] => list.filter((node) => node.id !== id).map((node) => ({ ...node, children: prune(node.children as TreeNode[]) }));
    nodes.value = prune(before as TreeNode[]);
    return () => {
      nodes.value = before;
    };
  });
  useWorkspaceTreeMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    nodes,
    rootId: ref('root-1'),
    message: ref(overrides.message ?? ''),
    manageable: computed(() => new Set(overrides.manageable ?? [])),
    isOwner: computed(() => overrides.isOwner ?? false),
    collapsedIds: computed(() => collapsed.value),
    selectedId,
    load,
    reorder,
    applyCreated,
    applyRenamed,
    removeNode,
    toggleCollapsed: (id: string) => {
      const next = new Set(collapsed.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      collapsed.value = next;
    },
    collapseAll: (ids: readonly string[]) => {
      collapsed.value = new Set([...collapsed.value, ...ids]);
    },
    reveal,
    // The real walk, not a stub: the inline editor reads it for the draft
    // row's indent and for the name of the place the new node went, so a
    // `() => []` here would hide both.
    pathTo: (nodeId: string) => {
      const walk = (list: TreeNode[], trail: TreeNode[]): TreeNode[] | null => {
        for (const node of list) {
          if (node.id === nodeId) return [...trail, node];
          const found = walk(node.children as TreeNode[], [...trail, node]);
          if (found) return found;
        }
        return null;
      };
      return walk(nodes.value as TreeNode[], []) ?? [];
    },
  });
  return { load, reorder, applyCreated, applyRenamed, reveal, selectedId, removeNode, nodes, collapsed };
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

async function mount(
  given: {
    workspaceId: string | null;
    workspaceSlug?: string | null;
    currentNodeId?: string | null;
    trashFetcher?: TrashFetcher;
    forceDeleteFetcher?: ForceDeleteFetcher;
    createFetcher?: CreateNodeFetcher;
    renameFetcher?: RenameNodeFetcher;
  } = { workspaceId: 'ws-1' },
) {
  const props = { workspaceSlug: given.workspaceId ? 'acme' : null, ...given };
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
      expect(navigateToMock).toHaveBeenCalledWith('/w/acme/p/page-1');
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

  /*
   * Creating and renaming, in the row (owner criterion, 2026-09-23). The
   * dialogs are gone: `New…` puts a draft row under the target parent with
   * its name editable, `F2` and the menu's "Rename…" replace a row's title
   * with the same field, Enter confirms and Escape cancels.
   */
  describe('naming a row, in the row', () => {
    /** The field the draft or the rename is typed into. */
    function editorField(component: Awaited<ReturnType<typeof mount>>) {
      return component.find('[data-row-editor] input');
    }

    test('the header renders with the loaded tree, outside the tree itself', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const actions = component.findComponent(NavigationTreeActions);
      expect(actions.exists()).toBe(true);
      expect(component.find('[role="tree"]').element.contains(actions.element)).toBe(false);
    });

    test('the header has no selection until the user picks a row; picking one hands it over and marks it', async () => {
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

    /**
     * The regression the owner hit on 2026-09-23: *"ahora ya no puedo crear
     * más estanterías aparte de la de raíz"*. `New…` aims at the selected
     * row, the open page selects its own row on every visit, and nothing
     * un-selected — so after the first shelf there was no reachable way to
     * aim at the top level again. VS Code's explorer answers this with the
     * blank space below the rows: a click there clears the selection, and a
     * right-click there is the root's own menu.
     */
    test('a click on the tree’s blank space clears the selection, so New… aims at the top level again', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();
      const actions = component.findComponent(NavigationTreeActions);

      await component.findAll('[role="treeitem"]')[0]!.trigger('focus');
      await nextTick();
      expect(actions.props('selectedId')).toBe('shelf-1');

      await component.get('[role="tree"]').trigger('click');
      await nextTick();

      expect(actions.props('selectedId'), 'nothing is picked any more').toBeNull();
      expect(component.findAll('[aria-selected="true"]')).toHaveLength(0);
      // The tab stop stays on a real row: clearing a selection must not
      // drop focus off the tree (checklist §5).
      expect(component.findAll('[role="treeitem"]').filter((item) => item.attributes('tabindex') === '0')).toHaveLength(1);
    });

    /**
     * A click on the blank space is pointer-only, and checklist §5 asks for
     * a stated keyboard equivalent. It is also the only road left when the
     * tree is tall enough to fill its pane: measured against the seeded
     * workspace on 2026-09-23, the last row's bottom edge was the tree's
     * own, so there was no blank space to aim at.
     */
    test('Escape on a row clears the selection too, and says so', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();
      const actions = component.findComponent(NavigationTreeActions);

      const row = component.findAll('[role="treeitem"]')[0]!;
      await row.trigger('focus');
      await nextTick();
      expect(actions.props('selectedId')).toBe('shelf-1');

      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      row.element.dispatchEvent(escape);
      await nextTick();

      expect(actions.props('selectedId')).toBeNull();
      expect(escape.defaultPrevented).toBe(true);
      expect(component.get('[data-testid="tree-menu-status"]').text()).toMatch(/nothing is selected/i);
      // The row keeps the tab stop: clearing a selection is not leaving the tree.
      expect(row.attributes('tabindex')).toBe('0');
    });

    test('Escape with nothing selected is left alone, so an overlay above the tree still gets it', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      component.findAll('[role="treeitem"]')[0]!.element.dispatchEvent(escape);
      await nextTick();

      expect(escape.defaultPrevented).toBe(false);
    });

    test('a click on a row is the row’s, not the blank space’s: it still selects', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await component.get('[data-node-id="book-1"] [draggable="true"]').trigger('click');
      await nextTick();

      expect(component.findComponent(NavigationTreeActions).props('selectedId')).toBe('book-1');
    });

    test('with nothing picked, New… creates the top level’s one legal child — the second shelf', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await component.findAll('[role="treeitem"]')[0]!.trigger('focus');
      await nextTick();
      await component.get('[role="tree"]').trigger('click');
      await nextTick();

      // What the header would emit for an unpicked tree — the same road the
      // button takes (`NavigationTreeActions` asks the hierarchy).
      component.findComponent(NavigationTreeActions).vm.$emit('create', { parentId: 'root-1', type: 'shelf' });
      await nextTick();

      const draft = component.get('[data-testid="tree-draft-row"]');
      expect(draft.attributes('aria-level'), 'at the top level, beside the shelf that already exists').toBe('1');
      expect(component.get('[data-row-editor] input').attributes('aria-label')).toBe('Name of the new shelf');
    });

    test('New… puts a draft row where the new node will land — no dialog opens', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      component.findComponent(NavigationTreeActions).vm.$emit('create', { parentId: 'book-1', type: 'page' });
      await nextTick();

      const draft = component.find('[data-testid="tree-draft-row"]');
      expect(draft.exists()).toBe(true);
      expect(editorField(component).attributes('aria-label')).toBe('Name of the new page');
      // Last among the book's children, where `POST /nodes` puts it.
      const book = component.findAll('[role="treeitem"]').find((item) => item.attributes('data-node-id') === 'book-1')!;
      const rows = book.findAll(':scope > [role="group"] > [role="treeitem"]');
      expect(rows[rows.length - 1]!.attributes('data-testid')).toBe('tree-draft-row');
      expect(document.body.querySelector('[role="dialog"]'), 'nothing modal opened').toBeNull();
    });

    test('a first shelf is created on a tree with no rows to hold it', async () => {
      mockTree({ status: 'success', nodes: [] });
      const component = await mount();
      expect(component.find('[data-testid="tree-empty"]').exists()).toBe(true);

      component.findComponent(NavigationTreeActions).vm.$emit('create', { parentId: 'root-1', type: 'shelf' });
      await nextTick();

      expect(component.find('[data-testid="tree-draft-row"]').exists()).toBe(true);
      expect(component.find('[data-testid="tree-empty"]').exists(), 'the tree is no longer empty').toBe(false);
      expect(editorField(component).attributes('aria-label')).toBe('Name of the new shelf');
    });

    test('Enter writes the name, the row is drawn from the response, and no reload follows', async () => {
      const { load, applyCreated } = mockTree({ status: 'success', nodes: NODES });
      const created = { id: 'page-3', parentId: 'book-1', type: 'page' as const, slug: 'three', title: 'Third page', position: 2 };
      const createFetcher = vi.fn(async () => created);
      const component = await mount({ workspaceId: 'ws-1', createFetcher });
      const before = load.mock.calls.length;

      component.findComponent(NavigationTreeActions).vm.$emit('create', { parentId: 'book-1', type: 'page' });
      await nextTick();
      const field = editorField(component);
      await field.setValue('Third page');
      await field.trigger('keydown', { key: 'Enter' });
      await nextTick();

      expect(createFetcher).toHaveBeenCalledWith({ parentId: 'book-1', type: 'page', title: 'Third page' });
      expect(applyCreated).toHaveBeenCalledWith(created);
      expect(load.mock.calls.length, 'the tree is never asked for again').toBe(before);
      expect(component.get('[data-testid="tree-menu-status"]').text()).toBe('Created page “Third page” in “Handbook”.');
    });

    test('Escape cancels and leaves no row behind', async () => {
      const createFetcher = vi.fn();
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount({ workspaceId: 'ws-1', createFetcher });

      component.findComponent(NavigationTreeActions).vm.$emit('create', { parentId: 'book-1', type: 'page' });
      await nextTick();
      await editorField(component).trigger('keydown', { key: 'Escape' });
      await nextTick();

      expect(component.find('[data-testid="tree-draft-row"]').exists()).toBe(false);
      expect(createFetcher).not.toHaveBeenCalled();
    });

    test('a name already taken keeps the field, with the reason beside it and the text still in it', async () => {
      const createFetcher = vi.fn(async () => {
        throw { response: { status: 409 }, data: { error: 'Something here already has that name. Choose another.' } };
      });
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount({ workspaceId: 'ws-1', createFetcher });

      component.findComponent(NavigationTreeActions).vm.$emit('create', { parentId: 'book-1', type: 'page' });
      await nextTick();
      const field = editorField(component);
      await field.setValue('First page');
      await field.trigger('keydown', { key: 'Enter' });
      await nextTick();
      await nextTick();

      expect(component.find('[data-testid="tree-draft-row"]').exists()).toBe(true);
      expect((editorField(component).element as HTMLInputElement).value, 'never renamed behind the person’s back').toBe('First page');
      expect(component.get('[data-testid="tree-row-editor-error"]').text()).toContain('already has that name');
    });

    test('a refusal the field cannot fix takes the draft away and says why beside the tree', async () => {
      const createFetcher = vi.fn(async () => {
        throw { response: { status: 403 }, data: {} };
      });
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount({ workspaceId: 'ws-1', createFetcher });

      component.findComponent(NavigationTreeActions).vm.$emit('create', { parentId: 'book-1', type: 'page' });
      await nextTick();
      const field = editorField(component);
      await field.setValue('Third page');
      await field.trigger('keydown', { key: 'Enter' });
      await nextTick();
      await nextTick();

      expect(component.find('[data-testid="tree-draft-row"]').exists()).toBe(false);
      expect(component.get('[data-testid="tree-write-error"]').text()).toMatch(/permission/i);
    });

    test('F2 on a focused row renames it where it stands, on its current title', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const row = component.findAll('[role="treeitem"]').find((item) => item.attributes('data-node-id') === 'page-1')!;
      await row.trigger('keydown', { key: 'F2' });
      await nextTick();

      const field = editorField(component);
      expect(field.attributes('aria-label')).toBe('Rename “First page”');
      expect((field.element as HTMLInputElement).value).toBe('First page');
      // The row is the field: it draws no title link beside it.
      expect(row.find('a').exists()).toBe(false);
    });

    test('a rename writes the new name and patches the row from the response', async () => {
      const { applyRenamed, load } = mockTree({ status: 'success', nodes: NODES });
      const renamed = { id: 'page-1', slug: 'first', title: 'First page, renamed' };
      const renameFetcher = vi.fn(async () => renamed);
      const component = await mount({ workspaceId: 'ws-1', renameFetcher });
      const before = load.mock.calls.length;

      const row = component.findAll('[role="treeitem"]').find((item) => item.attributes('data-node-id') === 'page-1')!;
      await row.trigger('keydown', { key: 'F2' });
      await nextTick();
      const field = editorField(component);
      await field.setValue('First page, renamed');
      await field.trigger('keydown', { key: 'Enter' });
      await nextTick();

      expect(renameFetcher).toHaveBeenCalledWith('page-1', { title: 'First page, renamed' });
      expect(applyRenamed).toHaveBeenCalledWith(renamed);
      expect(load.mock.calls.length).toBe(before);
      expect(component.get('[data-testid="tree-menu-status"]').text()).toBe('Renamed to “First page, renamed”.');
    });

    test('while a row is a field the tree hears none of its keys', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      const row = component.findAll('[role="treeitem"]').find((item) => item.attributes('data-node-id') === 'page-1')!;
      await row.trigger('keydown', { key: 'F2' });
      await nextTick();

      // ArrowDown would move the tree's focus, and Enter would open the
      // page: inside the field both are the field's alone.
      const field = editorField(component);
      await field.trigger('keydown', { key: 'ArrowDown' });
      await nextTick();
      expect(component.find('[data-row-editor]').exists(), 'the field is still open').toBe(true);
      expect(navigateToMock).not.toHaveBeenCalled();
    });
  });

  describe('collapse all', () => {
    test('folds every container the tree is showing, and says how many', async () => {
      const { collapsed } = mockTree({ status: 'success', nodes: NODES });
      const component = await mount();
      expect(component.findComponent(NavigationTreeActions).props('canCollapseAll')).toBe(true);

      component.findComponent(NavigationTreeActions).vm.$emit('collapse-all');
      await nextTick();

      expect([...collapsed.value].sort()).toEqual(['book-1', 'shelf-1']);
      expect(component.findAll('[role="treeitem"]')).toHaveLength(1);
      expect(component.get('[data-testid="tree-menu-status"]').text()).toBe('Collapsed 2 items.');
      expect(component.findComponent(NavigationTreeActions).props('canCollapseAll')).toBe(false);
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
      expect(labels.some((label) => label?.startsWith('Page history'))).toBe(true);
      expect(labels.some((label) => label?.startsWith('Copy link'))).toBe(true);
      // Delete is last, and for a row the caller cannot manage it stays in
      // the menu with its reason (navigation-tree spec; checklist §3, §5).
      const remove = menuItems().find((item) => item.textContent?.includes('Delete…'))!;
      expect(remove).toBeDefined();
      expect(remove.getAttribute('aria-disabled')).toBe('true');
      expect(remove.textContent).toMatch(/manage access/i);

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

    test('"Rename…" from the menu edits the row in place — the same field `F2` opens, not a second path', async () => {
      const { selectedId } = mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await component.get('[data-node-id="page-2"] [draggable="true"]').trigger('contextmenu', { clientX: 40, clientY: 40 });
      await settle();
      const rename = menuItems().find((item) => item.textContent?.includes('Rename…'))!;
      rename.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();

      expect(selectedId.value).toBe('page-2');
      expect(document.body.querySelector('[role="dialog"]'), 'nothing modal opens any more').toBeNull();
      const field = component.get('[data-node-id="page-2"] [data-row-editor] input');
      expect(field.attributes('aria-label')).toBe('Rename “Second page”');
      expect((field.element as HTMLInputElement).value).toBe('Second page');
    });

    test('"New page…" from a book’s menu opens the draft row under it, with no kind to pick', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await component.get('[data-node-id="book-1"] [draggable="true"]').trigger('contextmenu', { clientX: 40, clientY: 40 });
      await settle();
      const create = menuItems().find((item) => item.textContent?.includes('New page…'))!;
      create.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();

      expect(component.get('[data-row-editor] input').attributes('aria-label')).toBe('Name of the new page');
      const book = component.get('[data-node-id="book-1"]');
      expect(book.find('[data-testid="tree-draft-row"]').exists()).toBe(true);
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

    /*
     * Delete (design.md Decision 8): from the menu, the toolbar and the
     * `Delete` key, one flow — the product's one confirm dialog, the row
     * out of the tree before the server answers, and the outcome said
     * beside the tree and in a live region. The dialog itself is
     * `ConfirmDialog`'s to render; here the pending question is answered
     * through `useConfirm` directly, as the dialog would.
     */
    describe('delete', () => {
      const TRASHED = { trashOperationId: 'op-1', trashed: { pages: 1, containers: 0 } };

      async function openMenuOn(component: Awaited<ReturnType<typeof mount>>, nodeId: string): Promise<void> {
        await component.get(`[data-node-id="${nodeId}"] [draggable="true"]`).trigger('contextmenu', { clientX: 40, clientY: 40 });
        await settle();
      }

      async function chooseDelete(): Promise<void> {
        const item = menuItems().find((entry) => entry.textContent?.includes('Delete…'))!;
        item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await settle();
        await settle();
      }

      test('"Delete…" is live on a manageable page, and picking it asks the product\'s one question', async () => {
        mockTree({ status: 'success', nodes: NODES, manageable: ['page-1'] });
        const component = await mount({ workspaceId: 'ws-1', trashFetcher: vi.fn(async () => TRASHED) });
        await openMenuOn(component, 'page-1');
        const remove = menuItems().find((item) => item.textContent?.includes('Delete…'))!;
        expect(remove.getAttribute('aria-disabled')).toBeNull();

        await chooseDelete();

        expect(useConfirm().pending.value).toMatchObject({ title: 'Delete “First page”?', confirmLabel: 'Delete', tone: 'destructive' });
        useConfirm().settle(false);
        await settle();
        expect(component.find('[data-node-id="page-1"]').exists(), 'a "no" leaves the row').toBe(true);
      });

      test('a "yes" takes the row out at once, and success is a toast carrying the way back, and announced', async () => {
        const { removeNode } = mockTree({ status: 'success', nodes: NODES, manageable: ['page-1'] });
        let release!: () => void;
        const trashFetcher = vi.fn(() => new Promise<typeof TRASHED>((resolve) => { release = () => resolve(TRASHED); }));
        const component = await mount({ workspaceId: 'ws-1', trashFetcher });
        await openMenuOn(component, 'page-1');
        await chooseDelete();

        useConfirm().settle(true);
        await settle();
        expect(removeNode).toHaveBeenCalledWith('page-1');
        expect(component.find('[data-node-id="page-1"]').exists(), 'gone before the server answered').toBe(false);
        expect(trashFetcher).toHaveBeenCalledWith('page-1');
        release();
        await settle();

        expect(component.find('[data-node-id="page-1"]').exists()).toBe(false);
        // The success is the toast tier now (owner decision, 2026-09-23):
        // transient, dismissible, and carrying the one way back. The chip
        // beside the tree is gone; the live region still says it, which is
        // the half §5 relies on.
        expect(component.find('[data-testid="tree-delete-notice"]').exists()).toBe(false);
        const toast = useToast().toasts.value.at(-1) as unknown as Record<string, unknown> & { actions?: { label: string; to?: string }[] };
        expect(toast.title).toBe('Moved “First page” to the trash.');
        expect(toast.role).toBe('status');
        expect(toast.actions?.[0]?.label).toBe('Restore from Trash');
        expect(toast.actions?.[0]?.to).toBe('/w/acme/trash');
        expect(component.get('[data-testid="tree-menu-status"]').text()).toContain('Moved “First page” to the trash');
        // Focus does not fall off the tree with the row: it lands on a neighbour.
        expect((document.activeElement as HTMLElement | null)?.getAttribute('role')).toBe('treeitem');
      });

      test('a refusal puts the row back and says why, beside the tree', async () => {
        mockTree({ status: 'success', nodes: NODES, manageable: ['page-1'] });
        const trashFetcher = vi.fn(async () => { throw { response: { status: 403 }, data: { error: 'forbidden' } }; });
        const component = await mount({ workspaceId: 'ws-1', trashFetcher });
        await openMenuOn(component, 'page-1');
        await chooseDelete();

        useConfirm().settle(true);
        await settle();
        await settle();

        expect(component.find('[data-node-id="page-1"]').exists()).toBe(true);
        const alert = component.find('[data-testid="tree-delete-error"]');
        expect(alert.exists()).toBe(true);
        expect(alert.attributes('role')).toBe('alert');
        expect(alert.text()).toMatch(/permission/i);
      });

      test('the Delete key on a focused row opens the same flow; on a row that cannot be deleted it says why instead', async () => {
        mockTree({ status: 'success', nodes: NODES, manageable: ['page-1'] });
        const component = await mount({ workspaceId: 'ws-1', trashFetcher: vi.fn(async () => TRASHED) });

        await component.get('[data-node-id="page-2"]').trigger('keydown', { key: 'Delete' });
        await settle();
        expect(useConfirm().pending.value).toBeNull();
        expect(component.get('[data-testid="tree-menu-status"]').text()).toMatch(/manage access/i);

        await component.get('[data-node-id="page-1"]').trigger('keydown', { key: 'Delete' });
        await settle();
        expect(useConfirm().pending.value?.title).toBe('Delete “First page”?');
        useConfirm().settle(false);
      });

      /**
       * The toolbar's trash control is gone (owner criterion, 2026-09-23):
       * the owner read a red trash beside "New" as *delete the workspace*.
       * Delete now has exactly two ways in — the row's own menu and the
       * `Delete` key, both tested above — and this test is what keeps a
       * third from coming back to the header.
       */
      test('no control anywhere outside the tree deletes anything', async () => {
        const { selectedId } = mockTree({ status: 'success', nodes: NODES, manageable: ['page-2'] });
        const component = await mount({ workspaceId: 'ws-1', trashFetcher: vi.fn(async () => TRASHED) });
        selectedId.value = 'page-2';
        await settle();

        expect(component.find('[data-testid="tree-delete-open"]').exists()).toBe(false);
        const header = component.get('[role="group"][aria-label="Tree actions"]');
        const names = header.findAll('button').map((button) => button.attributes('aria-label') ?? button.text());
        expect(names.join(' ').toLowerCase()).not.toMatch(/delete|trash/);
        expect(useConfirm().pending.value, 'nothing was even asked').toBeNull();
      });
    });

    /**
     * The blank space below the rows is the root's own target — the other
     * half of the 2026-09-23 regression. VS Code registers New File and New
     * Folder against the explorer's empty area as well as against a folder;
     * here the one hierarchy table leaves a workspace exactly one child, so
     * the menu holds "New shelf…" and nothing else.
     */
    test('a right-click on the tree’s blank space opens the root’s own menu: New shelf…, and nothing that acts on a row', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      await component.get('[role="tree"]').trigger('contextmenu', { clientX: 40, clientY: 400 });
      await settle();

      expect(menu()).not.toBeNull();
      const labels = menuItems().map((item) => item.textContent?.trim() ?? '');
      expect(labels).toEqual(['New shelf…']);
      expect(labels.join(' ').toLowerCase()).not.toMatch(/rename|delete|move/);
    });

    test('the blank space’s menu creates at the top level, whatever row was picked before it', async () => {
      mockTree({ status: 'success', nodes: NODES });
      const component = await mount();

      // A page is picked, as it is on every visit to a page's own screen.
      await component.get('[data-node-id="page-1"]').trigger('focus');
      await nextTick();
      expect(component.findComponent(NavigationTreeActions).props('selectedId')).toBe('page-1');

      await component.get('[role="tree"]').trigger('contextmenu', { clientX: 40, clientY: 400 });
      await settle();
      const create = menuItems().find((item) => item.textContent?.includes('New shelf…'))!;
      create.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();

      const draft = component.get('[data-testid="tree-draft-row"]');
      expect(draft.attributes('aria-level')).toBe('1');
      expect(component.get('[data-row-editor] input').attributes('aria-label')).toBe('Name of the new shelf');
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
