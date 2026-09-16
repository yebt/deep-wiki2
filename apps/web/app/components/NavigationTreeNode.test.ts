import { UIcon } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import type { TreeNode } from '~/composables/useTree';
import NavigationTreeNode from './NavigationTreeNode.vue';

/**
 * One row of the navigation tree, and the two things the row itself owns.
 *
 * **The drop arithmetic.** A drop in the top or bottom quarter of a row
 * reorders among THAT ROW's own siblings; a drop in the middle band
 * reparents under it. The row cannot see its own position in its parent's
 * list, which is why `parentId`/`index` are required props — and it is why
 * an off-by-one here silently moves a page to the wrong place rather than
 * throwing. Nothing else in the suite computes these three cases.
 *
 * **The keyboard contract.** `NavigationTreeNode` is a deliberate
 * hand-rolled exception to docs/UI-CHECKLIST.md §4.1, taken because
 * `UTree` cannot drag-reorder. Measured on 2026-09-07, the first version
 * took the *behaviour* with the drawing: tabbing through the tree screen
 * reached the brand link, then the theme toggle, then left the page — not
 * one row was reachable, and reordering existed only as a drag (§5,
 * automatic fail). The row's half of the repair is the roving tabindex,
 * the ARIA position wiring, and forwarding every keydown *with the
 * position the handler cannot otherwise know*. `tree.vue` owns what the
 * keys then do, and `tree.test.ts` holds that; if this file's payload is
 * wrong, those tests still pass and the screen is still broken.
 *
 * Drag events are dispatched directly rather than through
 * `trigger('drop', …)`: `dataTransfer` is a read-only accessor on a real
 * `DragEvent`, so the option object would be silently dropped, and the
 * rect the drop maths reads has to be stubbed because happy-dom has no
 * layout engine and would hand every row a height of 0.
 */
function node(overrides: Partial<TreeNode> & { id: string }): TreeNode {
  return {
    type: 'page',
    slug: overrides.id,
    title: overrides.id,
    position: 0,
    children: [],
    ...overrides,
  };
}

const { preloadRouteComponentsMock } = vi.hoisted(() => ({ preloadRouteComponentsMock: vi.fn(async () => {}) }));
mockNuxtImport('preloadRouteComponents', () => preloadRouteComponentsMock);
beforeEach(() => preloadRouteComponentsMock.mockClear());

const SHELF: TreeNode = node({
  id: 'shelf-1',
  type: 'shelf',
  title: 'Engineering',
  children: [
    node({ id: 'page-1', title: 'First page' }),
    node({ id: 'page-2', title: 'Second page' }),
  ],
});

interface NodeProps {
  node: TreeNode;
  depth: number;
  parentId: string;
  index: number;
  setSize: number;
  activeId: string | null;
  selectedId: string | null;
  collapsedIds: ReadonlySet<string>;
  currentId?: string | null;
}

/**
 * The component's root element is the `<li>` itself, so it is mounted
 * inside the `<ul role="tree">` it actually ships in — which also makes
 * the root row reachable by the same query as its children.
 */
async function mountNode(
  overrides: Partial<NodeProps> = {},
  slots: Record<string, (scope: { node: TreeNode; active: boolean }) => ReturnType<typeof h>> = {},
  mountOptions: { attachTo?: Element } = {},
) {
  const props: NodeProps = {
    node: SHELF,
    depth: 0,
    parentId: 'root-1',
    index: 2,
    setSize: 5,
    activeId: null,
    selectedId: null,
    collapsedIds: new Set(),
    ...overrides,
  };
  const wrapper = await mountSuspended(
    defineComponent({
      name: 'TreeHarness',
      setup: () => () => h('ul', { role: 'tree' }, [h(NavigationTreeNode, props, slots)]),
    }),
    mountOptions,
  );
  return { dom: wrapper.element as HTMLElement, row: wrapper.findComponent(NavigationTreeNode), unmount: () => wrapper.unmount() };
}

const ROW_TOP = 100;
const ROW_HEIGHT = 40;

function itemOf(dom: HTMLElement, nodeId: string): HTMLElement {
  return dom.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)!;
}

/** The draggable row inside a given tree item, with a real box stubbed onto it. */
function rowOf(dom: HTMLElement, nodeId: string): HTMLElement {
  const row = itemOf(dom, nodeId).querySelector<HTMLElement>('[draggable="true"]')!;
  row.getBoundingClientRect = () =>
    ({ top: ROW_TOP, bottom: ROW_TOP + ROW_HEIGHT, height: ROW_HEIGHT, left: 0, right: 200, width: 200, x: 0, y: ROW_TOP, toJSON: () => ({}) }) as DOMRect;
  return row;
}

function fire(el: HTMLElement, type: string, props: Record<string, unknown> = {}, bubbles = true): void {
  const event = new Event(type, { bubbles, cancelable: true });
  Object.assign(event, props);
  el.dispatchEvent(event);
}

/** Drags `draggedId` onto `row` at a point that lands in the given band. */
async function dropOnto(row: HTMLElement, band: 'before' | 'on' | 'after', draggedId: string): Promise<void> {
  const offset = band === 'before' ? 4 : band === 'after' ? ROW_HEIGHT - 4 : ROW_HEIGHT / 2;
  fire(row, 'dragover', { clientY: ROW_TOP + offset });
  await nextTick();
  fire(row, 'drop', { dataTransfer: { getData: () => draggedId } });
  await nextTick();
}

describe('NavigationTreeNode', () => {
  describe('drop zones', () => {
    test('a drop in the top quarter puts the dragged node before this row, among this row’s siblings', async () => {
      const component = await mountNode({ index: 2, parentId: 'root-1' });

      await dropOnto(rowOf(component.dom, 'shelf-1'), 'before', 'dragged-1');

      expect(component.row.emitted('reorder')).toEqual([[{ draggedId: 'dragged-1', newParentId: 'root-1', newIndex: 2 }]]);
    });

    test('a drop in the bottom quarter puts it after this row', async () => {
      const component = await mountNode({ index: 2, parentId: 'root-1' });

      await dropOnto(rowOf(component.dom, 'shelf-1'), 'after', 'dragged-1');

      expect(component.row.emitted('reorder')).toEqual([[{ draggedId: 'dragged-1', newParentId: 'root-1', newIndex: 3 }]]);
    });

    test('a drop in the middle band reparents under this row, appended after its existing children', async () => {
      const component = await mountNode({ index: 2, parentId: 'root-1' });

      await dropOnto(rowOf(component.dom, 'shelf-1'), 'on', 'dragged-1');

      // The shelf already has two children, so "appended" is index 2 — of
      // the shelf's list, not of the shelf's own position among its
      // siblings, which is also 2. The two are different numbers that
      // happened to coincide before this test pinned the parent id.
      expect(component.row.emitted('reorder')).toEqual([[{ draggedId: 'dragged-1', newParentId: 'shelf-1', newIndex: 2 }]]);
    });

    test('dropping a row onto itself is not a move', async () => {
      const component = await mountNode();

      await dropOnto(rowOf(component.dom, 'shelf-1'), 'on', 'shelf-1');

      expect(component.row.emitted('reorder')).toBeUndefined();
    });

    test('the row under the pointer says which of the three moves the drop would make', async () => {
      const component = await mountNode();
      const row = rowOf(component.dom, 'shelf-1');

      fire(row, 'dragover', { clientY: ROW_TOP + ROW_HEIGHT / 2 });
      await nextTick();
      // Reparenting fills the row — `secondary-container`, M3's selected
      // role, opaque so it reads the same in both themes. Reordering draws
      // an edge instead, so the two moves are never confusable (§4.7 — the
      // anchored target is visibly indicated).
      expect(row.className).toContain('bg-secondary-container');

      fire(row, 'dragover', { clientY: ROW_TOP + 4 });
      await nextTick();
      expect(row.className).not.toContain('bg-secondary-container');
      expect(row.className).toContain('border-t-2');

      fire(row, 'dragleave');
      await nextTick();
      expect(row.className).not.toMatch(/bg-secondary-container|border-t-2|border-b-2/);
    });

    test('a drag carries the row’s own id, as a move', async () => {
      const component = await mountNode();
      const transfer: { data: Record<string, string>; effectAllowed?: string } = { data: {} };

      fire(rowOf(component.dom, 'shelf-1'), 'dragstart', {
        dataTransfer: {
          setData: (format: string, value: string) => {
            transfer.data[format] = value;
          },
          set effectAllowed(value: string) {
            transfer.effectAllowed = value;
          },
        },
      });

      expect(transfer.data['text/plain']).toBe('shelf-1');
      expect(transfer.effectAllowed).toBe('move');
    });

    test('a drop on a child reports the child’s parent, and reaches the screen unchanged', async () => {
      const component = await mountNode();

      await dropOnto(rowOf(component.dom, 'page-2'), 'before', 'page-1');

      // The nested row emits to its parent row, which re-emits: the payload
      // the screen acts on must be the child's, not the root's.
      expect(component.row.emitted('reorder')).toEqual([[{ draggedId: 'page-1', newParentId: 'shelf-1', newIndex: 1 }]]);
    });
  });

  describe('the keyboard and ARIA contract UTree would have brought', () => {
    test('the row holding the tab stop is the only one in the tab order', async () => {
      const component = await mountNode({ activeId: 'page-1' });

      const items = component.dom.querySelectorAll('[role="treeitem"]');
      expect(items).toHaveLength(3);
      expect([...items].filter((item) => item.getAttribute('tabindex') === '0')).toHaveLength(1);
      expect(component.dom.querySelector('[data-node-id="page-1"]')!.getAttribute('tabindex')).toBe('0');
      expect(component.dom.querySelector('[data-node-id="shelf-1"]')!.getAttribute('tabindex')).toBe('-1');
    });

    test('position in the tree is announced rather than left to be counted', async () => {
      const component = await mountNode({ depth: 0, index: 2, setSize: 5 });

      const shelf = component.dom.querySelector('[data-node-id="shelf-1"]')!;
      expect(shelf.getAttribute('aria-level')).toBe('1');
      expect(shelf.getAttribute('aria-posinset')).toBe('3');
      expect(shelf.getAttribute('aria-setsize')).toBe('5');
      expect(shelf.getAttribute('aria-expanded')).toBe('true');

      const child = component.dom.querySelector('[data-node-id="page-2"]')!;
      expect(child.getAttribute('aria-level')).toBe('2');
      expect(child.getAttribute('aria-posinset')).toBe('2');
      expect(child.getAttribute('aria-setsize')).toBe('2');
      // A leaf is not collapsible, so it claims neither state.
      expect(child.getAttribute('aria-expanded')).toBeNull();
    });

    test('a keydown is forwarded with the position the screen cannot otherwise know', async () => {
      const component = await mountNode();

      fire(component.dom.querySelector('[data-node-id="page-2"]') as HTMLElement, 'keydown', { key: 'ArrowUp', altKey: true });
      await nextTick();

      const forwarded = component.row.emitted('keydown');
      expect(forwarded).toHaveLength(1);
      const payload = forwarded![0]![0] as { event: Event; node: TreeNode; parentId: string; index: number };
      expect(payload.node.id).toBe('page-2');
      // `tree.vue` reorders with exactly these two values. A row that
      // reported its own parent as the root, or its depth-first position as
      // its index, would move the page somewhere else entirely.
      expect(payload.parentId).toBe('shelf-1');
      expect(payload.index).toBe(1);
      expect(payload.event.type).toBe('keydown');
    });

    test('the keydown comes from the element that holds focus, not from the row inside it', async () => {
      const component = await mountNode();

      // The tab stop is on the `treeitem`, so that is where the arrow keys
      // arrive; a handler on the inner row would never see them.
      fire(component.dom.querySelector('[data-node-id="shelf-1"] [draggable="true"]') as HTMLElement, 'keydown', { key: 'ArrowDown' });
      await nextTick();

      const forwarded = component.row.emitted('keydown')!;
      expect(forwarded).toHaveLength(1);
      expect((forwarded[0]![0] as { node: TreeNode }).node.id).toBe('shelf-1');
    });

    test('taking focus moves the tab stop and never navigates', async () => {
      const component = await mountNode();

      // `focus` does not bubble, so the row that took it is the only one that reports.
      fire(itemOf(component.dom, 'page-1'), 'focus', {}, false);
      await nextTick();

      expect(component.row.emitted('activate')).toEqual([['page-1']]);
      expect(component.row.emitted('open')).toBeUndefined();
    });
  });

  describe('opening a row', () => {
    test('clicking a page asks to open it', async () => {
      const component = await mountNode();

      rowOf(component.dom, 'page-1').click();
      await nextTick();

      expect(component.row.emitted('open')).toEqual([['page-1']]);
    });

    /**
     * A page row's title is a real link (2026-09-16): an `<a href>` the
     * browser can open in a new tab, copy or drag, and that the router
     * takes over on a plain click. Out of the tab order — the tree is one
     * tab stop, on the `treeitem` — and a click on it records the
     * selection only, since the link itself is what navigates; the rest
     * of the row still opens the page through the tree, as Enter does.
     */
    test('a page’s title is a real link to the page, outside the tab order', async () => {
      const component = await mountNode();

      const link = itemOf(component.dom, 'page-1').querySelector<HTMLAnchorElement>('a[href]')!;
      expect(link).not.toBeNull();
      expect(link.getAttribute('href')).toBe('/pages/page-1');
      expect(link.getAttribute('tabindex')).toBe('-1');
      expect(link.textContent).toContain('First page');
      // A container is a place to fold, not a place to go: no link.
      expect(itemOf(component.dom, 'shelf-1').querySelector(':scope > .dw-tree-row a[href]')).toBeNull();
    });

    test('a click on the link records the selection and leaves the navigation to the link', async () => {
      const component = await mountNode();

      const link = itemOf(component.dom, 'page-1').querySelector<HTMLAnchorElement>('a[href]')!;
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await nextTick();

      expect(component.row.emitted('activate')).toEqual([['page-1']]);
      expect(component.row.emitted('open')).toBeUndefined();
    });

    /**
     * A mouse click focuses the element under the pointer, and the link
     * carries a `tabindex` — so a click on the title used to leave focus
     * on the `<a>` inside the row, not on the `treeitem`. Seen 2026-09-16
     * (docs/TODO.md Findings): the confirm dialog that guards a dirty
     * editor read that `<a>` as the control that asked and returned focus
     * to it, and the tree's one tab stop was no longer where focus was.
     * Focus on the link is the row's: it lands on the `treeitem`, the
     * element the ARIA tree pattern gives the keyboard to.
     */
    test('focus arriving on the link lands on the row itself, so the tree’s one tab stop is where focus is', async () => {
      const component = await mountNode({ activeId: 'page-1' }, {}, { attachTo: document.body });
      try {
        const item = itemOf(component.dom, 'page-1');
        const link = item.querySelector<HTMLAnchorElement>('a[href]')!;

        link.focus();
        await nextTick();

        expect(document.activeElement).toBe(item);
        expect(component.row.emitted('activate')).toEqual([['page-1']]);
      } finally {
        component.unmount();
      }
    });

    /**
     * Nothing prefetched the read route when a person reached for a row:
     * the rows navigated with `navigateTo`, which Nuxt's link prefetch
     * never sees — and `NuxtLink`'s own prefetch skips
     * `preloadRouteComponents` in dev, the environment the owner runs
     * (docs/TODO.md Findings, 2026-09-16, cause 3). The row itself warms
     * the route on pointer and keyboard intent, once.
     */
    test('pointer or keyboard intent on a page row preloads the page route, once', async () => {
      const component = await mountNode();
      const row = rowOf(component.dom, 'page-1');

      fire(row, 'pointerenter', {}, false);
      fire(itemOf(component.dom, 'page-1'), 'focus', {}, false);
      fire(row, 'pointerenter', {}, false);
      await nextTick();

      expect(preloadRouteComponentsMock).toHaveBeenCalledTimes(1);
      expect(preloadRouteComponentsMock).toHaveBeenCalledWith('/pages/page-1');
    });

    test('a container row has no route to warm', async () => {
      const component = await mountNode();

      fire(rowOf(component.dom, 'shelf-1'), 'pointerenter', {}, false);
      fire(itemOf(component.dom, 'shelf-1'), 'focus', {}, false);
      await nextTick();

      expect(preloadRouteComponentsMock).not.toHaveBeenCalled();
    });

    // A container row used to hover, show a grab cursor and do nothing on
    // click (audit, 2026-09-14: docs/UI-CHECKLIST.md §6, "no inert
    // interactions"). It has one thing to do that is not navigation: fold.
    test('clicking a shelf toggles its expansion — never opens it, never does nothing', async () => {
      const component = await mountNode();

      rowOf(component.dom, 'shelf-1').click();
      await nextTick();

      expect(component.row.emitted('open')).toBeUndefined();
      expect(component.row.emitted('toggle')).toEqual([['shelf-1']]);
    });
  });

  describe('expansion', () => {
    test('an expanded container says so and renders its children', async () => {
      const component = await mountNode();

      expect(itemOf(component.dom, 'shelf-1').getAttribute('aria-expanded')).toBe('true');
      expect(component.dom.querySelectorAll('[role="treeitem"]')).toHaveLength(3);
    });

    test('a collapsed container says so and renders no children at all', async () => {
      const component = await mountNode({ collapsedIds: new Set(['shelf-1']) });

      expect(itemOf(component.dom, 'shelf-1').getAttribute('aria-expanded')).toBe('false');
      expect(component.dom.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
    });

    test('a leaf never claims to be expandable', async () => {
      const component = await mountNode();

      expect(itemOf(component.dom, 'page-1').hasAttribute('aria-expanded')).toBe(false);
    });
  });

  describe('selection', () => {
    // docs/DESIGN-SYSTEM.md §5.2: a container fill on an interactive element
    // is for exactly one thing, a selected or active state — and the toolbar
    // above the tree acts on this row, so the user has to be able to see it.
    test('the selected row is marked for assistive technology and carries the container fill; no other row does', async () => {
      const component = await mountNode({ selectedId: 'page-1' });

      expect(itemOf(component.dom, 'page-1').getAttribute('aria-selected')).toBe('true');
      expect(rowOf(component.dom, 'page-1').classList.contains('bg-secondary-container')).toBe(true);
      expect(itemOf(component.dom, 'shelf-1').getAttribute('aria-selected')).toBe('false');
      expect(rowOf(component.dom, 'shelf-1').classList.contains('bg-secondary-container')).toBe(false);
    });

    test('with nothing selected, no row carries the fill', async () => {
      const component = await mountNode();

      for (const id of ['shelf-1', 'page-1', 'page-2']) {
        expect(rowOf(component.dom, id).classList.contains('bg-secondary-container'), id).toBe(false);
      }
    });
  });

  /*
   * The sidebar houses the tree, and a book's history is a context action
   * on the book's own row rather than a chrome link (it used to be a strip
   * of "Book history: A B C" in the app bar). The row rents out a slot at
   * its end; what stands there is the tree's decision, but the row owes it
   * two things: a click there must not fold or open the row, and a key
   * pressed there must not move the tree's focus.
   */
  describe('row actions', () => {
    test('the slot renders at the end of every row, with the node and whether the row holds the tab stop', async () => {
      const component = await mountNode(
        { activeId: 'page-1' },
        { 'row-actions': ({ node, active }) => h('button', { type: 'button', 'data-testid': `act-${node.id}`, 'data-active': String(active) }, 'More') },
      );

      expect(component.dom.querySelector('[data-testid="act-shelf-1"]')!.getAttribute('data-active')).toBe('false');
      expect(component.dom.querySelector('[data-testid="act-page-1"]')!.getAttribute('data-active')).toBe('true');
      expect(component.dom.querySelector('[data-testid="act-page-2"]')).not.toBeNull();
    });

    test('a click on the action neither opens nor folds the row, and a key pressed there does not reach the tree', async () => {
      const component = await mountNode(
        {},
        { 'row-actions': ({ node }) => h('button', { type: 'button', 'data-testid': `act-${node.id}` }, 'More') },
      );

      const action = component.dom.querySelector<HTMLElement>('[data-testid="act-page-1"]')!;
      action.click();
      await nextTick();
      expect(component.row.emitted('open')).toBeUndefined();
      expect(component.row.emitted('toggle')).toBeUndefined();

      fire(action, 'keydown', { key: 'ArrowDown' });
      await nextTick();
      expect(component.row.emitted('keydown')).toBeUndefined();
    });
  });

  describe('the current page', () => {
    // The row of the page that is open is the one the sidebar exists to
    // point at: marked for assistive technology as the current page, on the
    // page row alone.
    test('the row of the open page carries aria-current, and no other row does', async () => {
      const component = await mountNode({ currentId: 'page-2' });

      expect(itemOf(component.dom, 'page-2').getAttribute('aria-current')).toBe('page');
      expect(itemOf(component.dom, 'page-1').getAttribute('aria-current')).toBeNull();
      expect(itemOf(component.dom, 'shelf-1').getAttribute('aria-current')).toBeNull();
    });
  });

  describe('the row itself', () => {
    test('the node’s type is in the accessible name, not only in the icon', async () => {
      const component = await mountNode();

      // §4.3: packs differ in metaphor, so an icon is never the only carrier
      // of meaning. The type is read out; the icon is hidden.
      const shelfRow = rowOf(component.dom, 'shelf-1');
      expect(shelfRow.textContent).toContain('shelf:');
      expect(shelfRow.textContent).toContain('Engineering');
      expect(component.row.findAllComponents(UIcon).every((icon) => icon.attributes('aria-hidden') === 'true')).toBe(true);
      // The type icon, beside the fold chevron every container row now carries.
      expect(component.row.findAllComponents(UIcon).map((icon) => icon.props('name'))).toContain('i-lucide-library');
      expect(rowOf(component.dom, 'page-1').textContent).toContain('page:');
    });

    test('a long title keeps its full text available once it truncates', async () => {
      const component = await mountNode({
        node: node({ id: 'page-9', title: 'A page title long enough that the column will have to cut it off somewhere' }),
      });

      const label = component.dom.querySelector('.truncate')!;
      expect(label.getAttribute('title')).toBe('A page title long enough that the column will have to cut it off somewhere');
    });

    test('depth is drawn as indentation, one 12px step per level', async () => {
      const component = await mountNode({ depth: 1 });

      // §7.2's tree-indent value. Four levels at M3's own 16dp pushes titles
      // off a narrow viewport (§6).
      expect(rowOf(component.dom, 'shelf-1').style.paddingLeft).toBe('20px');
      expect(rowOf(component.dom, 'page-1').style.paddingLeft).toBe('32px');
    });

    test('a leaf renders no empty child group', async () => {
      const component = await mountNode({ node: node({ id: 'page-9', title: 'Alone' }) });

      expect(component.dom.querySelectorAll('[role="group"]')).toHaveLength(0);
      expect(component.dom.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
    });
  });
});
