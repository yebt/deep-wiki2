import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { legalChildTypes, type NodeType } from '@deep-wiki/contracts';
import type { TreeNode } from '~/composables/useTree';
import NavigationTreeActions from './NavigationTreeActions.vue';

/**
 * The tree's header, and the one question it is allowed to ask.
 *
 * The owner rejected this header on 2026-09-23: it carried `New…`,
 * `Rename…` and a red trash button, and the trash beside "New" read as
 * *delete the workspace*. Two properties are what the correction turns on,
 * and both are held here rather than in a screenshot:
 *
 * 1. **The item set is exactly New…, Filter, Collapse all — and nothing
 *    destructive can come back.** The first test does not enumerate what is
 *    absent; it asserts the group's whole contents, so a fourth control of
 *    any kind fails it.
 * 2. **A question with one answer is never asked.** The type menu appears
 *    only where the one `LEGAL_PARENT_TYPES` table leaves more than one
 *    legal child, and the tests read that table rather than restating it —
 *    at three different depths, because a test that only ever creates at
 *    the top level exercises the table not at all (`shelf` is the root's
 *    only legal child, so any implementation passes).
 */
function node(overrides: Partial<TreeNode> & { id: string }): TreeNode {
  return { type: 'page', slug: overrides.id, title: overrides.id, position: 0, children: [], ...overrides };
}

const NODES: TreeNode[] = [
  node({
    id: 'shelf-1',
    type: 'shelf',
    title: 'Engineering',
    children: [
      node({
        id: 'book-1',
        type: 'book',
        title: 'Handbook',
        children: [node({ id: 'chapter-1', type: 'chapter', title: 'Onboarding', children: [node({ id: 'page-1', title: 'Day one' })] })],
      }),
    ],
  }),
];

let wrapper: Awaited<ReturnType<typeof mountSuspended>> | null = null;
let created: { parentId: string; type: NodeType }[] = [];

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  created = [];
});

async function mountHeader(props: Record<string, unknown> = {}) {
  created = [];
  const host = defineComponent({
    setup: () => () =>
      h(UApp, null, {
        default: () =>
          h(NavigationTreeActions, {
            nodes: NODES,
            rootId: 'root-1',
            selectedId: null,
            filterOpen: false,
            filterBoxId: 'filter-box',
            canFilter: true,
            canCollapseAll: true,
            onCreate: (target: { parentId: string; type: NodeType }) => created.push(target),
            ...props,
          }),
      }),
  });
  wrapper = await mountSuspended(host, { attachTo: document.body });
  await nextTick();
  return wrapper.element as HTMLElement;
}

/** Every control the header offers, by its accessible name, in the order it is drawn. */
function controlNames(root: HTMLElement): string[] {
  const group = root.querySelector('[role="group"][aria-label="Tree actions"]');
  if (!group) throw new Error('the header rendered no named action group');
  return [...group.querySelectorAll('button')].map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '');
}

describe('the tree header', () => {
  test('carries exactly three controls: New…, Filter, Collapse all', async () => {
    const root = await mountHeader();
    expect(controlNames(root)).toEqual(['New…', 'Filter tree', 'Collapse all']);
  });

  test('nothing in it deletes or renames — the two the owner found beside New', async () => {
    const root = await mountHeader();
    const names = controlNames(root).join(' | ').toLowerCase();
    expect(names).not.toMatch(/delete|trash|remove/);
    expect(names).not.toMatch(/rename/);
    // And no error-coloured control of any kind: a destructive action is
    // the one thing this header may never carry (DESIGN-SYSTEM §9.1 gives
    // a destructive action the `error` role and a visible boundary).
    const group = root.querySelector('[role="group"][aria-label="Tree actions"]')!;
    expect(group.innerHTML).not.toMatch(/-error\b/);
  });

  test('an empty tree offers creation and nothing to look through', async () => {
    const root = await mountHeader({ nodes: [], canFilter: false, canCollapseAll: false });
    expect(controlNames(root)).toEqual(['New…']);
  });

  test('"Collapse all" stays in the header with its reason when everything is already folded', async () => {
    const root = await mountHeader({ canCollapseAll: false });
    const collapse = root.querySelector('[data-testid="tree-collapse-all"]');
    expect(collapse?.getAttribute('aria-disabled')).toBe('true');
    expect(collapse?.hasAttribute('disabled'), 'never the attribute — it removes the reason from the keyboard').toBe(false);
    expect(root.querySelector('#tree-collapse-all-reason')?.textContent).toContain('already collapsed');
  });

  test('the filter toggle says what it controls and whether it is open', async () => {
    const root = await mountHeader({ filterOpen: true });
    const toggle = root.querySelector('[data-testid="tree-filter-toggle"]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.getAttribute('aria-controls')).toBe('filter-box');
  });
});

describe('New… asks the hierarchy, never the person, when there is one answer', () => {
  test('with nothing picked it creates the top level’s only child outright', async () => {
    const root = await mountHeader();
    expect(legalChildTypes('workspace'), 'the table still leaves one answer here').toEqual(['shelf']);

    root.querySelector<HTMLElement>('[data-testid="tree-create-open"]')!.click();
    await nextTick();

    expect(created).toEqual([{ parentId: 'root-1', type: 'shelf' }]);
    expect(root.querySelector('[aria-haspopup="menu"]'), 'no menu was opened to ask one question').toBeNull();
  });

  test('inside a shelf it creates a book outright, and inside a chapter a page', async () => {
    for (const [selectedId, parentId, type] of [
      ['shelf-1', 'shelf-1', 'book'],
      ['chapter-1', 'chapter-1', 'page'],
    ] as const) {
      const root = await mountHeader({ selectedId });
      root.querySelector<HTMLElement>('[data-testid="tree-create-open"]')!.click();
      await nextTick();
      expect(created, selectedId).toEqual([{ parentId, type }]);
      wrapper?.unmount();
      wrapper = null;
    }
  });

  test('a page cannot hold anything, so New… points at the chapter above it', async () => {
    const root = await mountHeader({ selectedId: 'page-1' });
    root.querySelector<HTMLElement>('[data-testid="tree-create-open"]')!.click();
    await nextTick();
    expect(created).toEqual([{ parentId: 'chapter-1', type: 'page' }]);
  });

  test('a book holds two kinds, so — and only so — the control asks first', async () => {
    expect(legalChildTypes('book'), 'the table still leaves two answers here').toEqual(['chapter', 'page']);
    const root = await mountHeader({ selectedId: 'book-1' });

    const trigger = root.querySelector<HTMLElement>('[data-testid="tree-create-open"]')!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    trigger.click();
    await nextTick();
    await nextTick();

    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim());
    expect(items).toEqual(['Chapter', 'Page']);
    expect(created, 'nothing is created until the kind is picked').toEqual([]);
  });
});
