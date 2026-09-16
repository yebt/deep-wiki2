import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { legalChildTypes } from '@deep-wiki/contracts';
import type { TreeNode } from '~/composables/useTree';
import NavigationTreeActions, { type CreateNodeFetcher, type RenameNodeFetcher } from './NavigationTreeActions.vue';

/**
 * The tree's write affordances: create a shelf, book, chapter or page,
 * and rename one.
 *
 * Two things this file exists to hold, neither of which a
 * screenshot-shaped test would catch:
 *
 * 1. **The type choices are derived from `LEGAL_PARENT_TYPES`, never
 *    listed.** A client that types out "shelf, book, chapter, page" is a
 *    second copy of the table the server enforces — docs/TODO.md's own
 *    named recurring defect, recorded five times. The first tests below
 *    compare what is offered against `legalChildTypes()` itself, and they
 *    do it at three different depths, because a test that only ever
 *    creates under the workspace root exercises the table not at all:
 *    `shelf` is the root's only legal child, so any implementation passes.
 * 2. **Every refusal the server can return has its own state.** A name
 *    collision, a permission denial and a dead connection are three
 *    different next actions (docs/UI-CHECKLIST.md §3), and the dialog
 *    must keep what the user typed in all three.
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
        children: [
          node({ id: 'chapter-1', type: 'chapter', title: 'Onboarding', children: [node({ id: 'page-1', title: 'Day one' })] }),
        ],
      }),
    ],
  }),
];

interface Mounted {
  wrapper: Awaited<ReturnType<typeof mountSuspended>>;
  /** The component's own markup and the modal content it teleports into `document.body` are two roots; every query walks both. */
  roots: HTMLElement[];
}

let mounted: Mounted | null = null;

afterEach(() => {
  mounted?.wrapper.unmount();
  mounted = null;
});

async function mountActions(
  overrides: {
    nodes?: TreeNode[];
    selectedId?: string | null;
    createFetcher?: CreateNodeFetcher;
    renameFetcher?: RenameNodeFetcher;
  } = {},
): Promise<Mounted> {
  const wrapper = await mountSuspended(
    defineComponent({
      name: 'ActionsHarness',
      setup: () => () =>
        h(UApp, null, {
          default: () =>
            h(NavigationTreeActions, {
              nodes: overrides.nodes ?? NODES,
              rootId: 'root-1',
              selectedId: overrides.selectedId === undefined ? null : overrides.selectedId,
              createFetcher: overrides.createFetcher,
              renameFetcher: overrides.renameFetcher,
            }),
        }),
    }),
  );
  mounted = { wrapper, roots: [wrapper.element as HTMLElement, document.body] };
  return mounted;
}

function byTestId(m: Mounted, id: string): HTMLElement | null {
  for (const root of m.roots) {
    const found = root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (found) return found;
  }
  return null;
}

function radioValues(m: Mounted, testId: string): string[] {
  const group = byTestId(m, testId);
  if (!group) return [];
  return Array.from(group.querySelectorAll('[role="radio"]')).map((el) => el.getAttribute('value') ?? '');
}

function checkedRadio(m: Mounted, testId: string): string | null {
  const group = byTestId(m, testId);
  return group?.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('value') ?? null;
}

async function settle(): Promise<void> {
  await nextTick();
  await nextTick();
  await nextTick();
}

async function openCreate(m: Mounted): Promise<void> {
  byTestId(m, 'tree-create-open')!.click();
  await settle();
}

async function typeAndSubmit(m: Mounted, testId: string, submitId: string, value: string): Promise<void> {
  const input = byTestId(m, testId) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
  byTestId(m, submitId)!.click();
  await settle();
}

function fetchError(status: number, body: unknown): unknown {
  return Object.assign(new Error('fetch failed'), { response: { status }, data: body });
}

describe('NavigationTreeActions — what may be created, and where', () => {
  test('under a book, exactly the book’s legal children are offered', async () => {
    const mounted = await mountActions({ selectedId: 'book-1' });
    await openCreate(mounted);

    expect(radioValues(mounted, 'tree-create-type')).toEqual(legalChildTypes('book'));
    expect(radioValues(mounted, 'tree-create-type')).toEqual(['chapter', 'page']);
    expect(checkedRadio(mounted, 'tree-create-location')).toBe('book-1');
  });

  test('under a chapter, only a page is offered — a different answer from the same table', async () => {
    const mounted = await mountActions({ selectedId: 'chapter-1' });
    await openCreate(mounted);

    expect(radioValues(mounted, 'tree-create-type')).toEqual(legalChildTypes('chapter'));
    expect(radioValues(mounted, 'tree-create-type')).toEqual(['page']);
  });

  test('at the top level only a shelf is offered', async () => {
    const mounted = await mountActions({ nodes: [], selectedId: null });
    await openCreate(mounted);

    expect(radioValues(mounted, 'tree-create-type')).toEqual(legalChildTypes('workspace'));
    expect(radioValues(mounted, 'tree-create-type')).toEqual(['shelf']);
    // With nothing in the tree there is only one place to create, so the
    // choice is stated rather than offered.
    expect(byTestId(mounted, 'tree-create-location')).toBeNull();
    expect(byTestId(mounted, 'tree-create-location-fixed')!.textContent).toMatch(/top level/i);
  });

  test('a page is never a location; the chapter holding it is, and the top level is always reachable', async () => {
    const mounted = await mountActions({ selectedId: 'page-1' });
    await openCreate(mounted);

    const locations = radioValues(mounted, 'tree-create-location');
    expect(locations).not.toContain('page-1');
    expect(locations).toEqual(['chapter-1', 'root-1']);
    expect(checkedRadio(mounted, 'tree-create-location')).toBe('chapter-1');
    // The location reads as a place, not an id.
    expect(byTestId(mounted, 'tree-create-location')!.textContent).toContain('Onboarding');
  });
});

describe('NavigationTreeActions — creating', () => {
  test('posts the location, the type and the title, then reports the change', async () => {
    const createFetcher = vi.fn(async () => ({
      id: 'new-1',
      parentId: 'chapter-1',
      type: 'page' as const,
      slug: 'day-two',
      title: 'Day two',
      position: 1,
    }));
    const mounted = await mountActions({ selectedId: 'chapter-1', createFetcher });
    await openCreate(mounted);
    await typeAndSubmit(mounted, 'tree-create-title', 'tree-create-submit', 'Day two');

    expect(createFetcher).toHaveBeenCalledWith({ parentId: 'chapter-1', type: 'page', title: 'Day two' });
    // The response is the row: the tree draws it from this, not from a reload.
    expect(mounted.wrapper.findComponent(NavigationTreeActions).emitted('created')).toEqual([
      [{ id: 'new-1', parentId: 'chapter-1', type: 'page', slug: 'day-two', title: 'Day two', position: 1 }],
    ]);
  });

  test('success is announced specifically, naming what was created and where it went', async () => {
    const createFetcher = vi.fn(async () => ({
      id: 'new-1',
      parentId: 'chapter-1',
      type: 'page' as const,
      slug: 'day-two',
      title: 'Day two',
      position: 1,
    }));
    const mounted = await mountActions({ selectedId: 'chapter-1', createFetcher });
    await openCreate(mounted);
    await typeAndSubmit(mounted, 'tree-create-title', 'tree-create-submit', 'Day two');

    const live = byTestId(mounted, 'tree-actions-status')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toContain('Day two');
    expect(live.textContent).toContain('Onboarding');
  });

  test('a name that collides is reported on the name field, and nothing typed is lost', async () => {
    const createFetcher = vi.fn(async () => {
      throw fetchError(409, { error: 'a sibling named "Day one" already exists here' });
    });
    const mounted = await mountActions({ selectedId: 'chapter-1', createFetcher });
    await openCreate(mounted);
    await typeAndSubmit(mounted, 'tree-create-title', 'tree-create-submit', 'Day one');

    expect(byTestId(mounted, 'tree-create-title-field')!.textContent).toMatch(/already exists here/i);
    const input = byTestId(mounted, 'tree-create-title') as HTMLInputElement;
    expect(input.value).toBe('Day one');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
  });

  test('a permission refusal says what is missing, and is not a field error', async () => {
    const createFetcher = vi.fn(async () => {
      throw fetchError(403, { error: 'forbidden' });
    });
    const mounted = await mountActions({ selectedId: 'chapter-1', createFetcher });
    await openCreate(mounted);
    await typeAndSubmit(mounted, 'tree-create-title', 'tree-create-submit', 'Day two');

    const alert = byTestId(mounted, 'tree-create-error')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toMatch(/permission/i);
    expect(byTestId(mounted, 'tree-create-title-field')!.textContent).not.toMatch(/permission/i);
  });

  test('a dead connection says so and leaves the retry in reach', async () => {
    const createFetcher = vi.fn(async () => {
      // ofetch always defines `response`, setting it to undefined when
      // nothing came back — the exact shape `app/utils/fetch-error.ts`
      // exists to classify, and the one four hand-written guards got wrong.
      throw Object.assign(new Error('fetch failed'), { response: undefined });
    });
    const mounted = await mountActions({ selectedId: 'chapter-1', createFetcher });
    await openCreate(mounted);
    await typeAndSubmit(mounted, 'tree-create-title', 'tree-create-submit', 'Day two');

    expect(byTestId(mounted, 'tree-create-error')!.textContent).toMatch(/connection/i);
    expect(byTestId(mounted, 'tree-create-submit')).not.toBeNull();
    expect((byTestId(mounted, 'tree-create-title') as HTMLInputElement).value).toBe('Day two');
  });
});

describe('NavigationTreeActions — renaming', () => {
  test('is aria-disabled with a reason when no row is selected, and stays in the tab order', async () => {
    const mounted = await mountActions({ selectedId: null });
    const button = byTestId(mounted, 'tree-rename-open')!;

    // `aria-disabled`, never the attribute: the attribute removes the
    // control from the tab order, which puts its own explanation behind a
    // hover a keyboard user cannot perform (docs/UI-CHECKLIST.md §5).
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    // Looked up across the component's own roots rather than through
    // `document`: `mountSuspended` mounts into a detached element, and
    // only teleported content reaches `document.body`.
    const reason = mounted.roots.map((root) => root.querySelector(`#${describedBy}`)).find(Boolean);
    expect(reason?.textContent).toMatch(/select a row/i);
  });

  test('names its target, sends the new title, and reports the change', async () => {
    const renameFetcher = vi.fn(async () => ({ id: 'page-1', slug: 'day-zero', title: 'Day zero' }));
    const mounted = await mountActions({ selectedId: 'page-1', renameFetcher });
    const button = byTestId(mounted, 'tree-rename-open')!;
    expect(button.getAttribute('aria-disabled')).toBeNull();
    // The target is in the accessible name; the visible label stays short
    // enough for a 280px pane.
    expect(button.getAttribute('aria-label')).toBe('Rename “Day one”…');
    expect(button.textContent).toContain('Rename…');

    button.click();
    await settle();
    expect((byTestId(mounted, 'tree-rename-title') as HTMLInputElement).value).toBe('Day one');
    await typeAndSubmit(mounted, 'tree-rename-title', 'tree-rename-submit', 'Day zero');

    expect(renameFetcher).toHaveBeenCalledWith('page-1', { title: 'Day zero' });
    expect(mounted.wrapper.findComponent(NavigationTreeActions).emitted('renamed')).toEqual([[{ id: 'page-1', slug: 'day-zero', title: 'Day zero' }]]);
  });

  test('a rename that collides is reported on the field, exactly as creation reports it', async () => {
    const renameFetcher = vi.fn(async () => {
      throw fetchError(409, { error: 'a sibling named "Overview" already exists here' });
    });
    const mounted = await mountActions({ selectedId: 'page-1', renameFetcher });
    byTestId(mounted, 'tree-rename-open')!.click();
    await settle();
    await typeAndSubmit(mounted, 'tree-rename-title', 'tree-rename-submit', 'Overview');

    expect(byTestId(mounted, 'tree-rename-title-field')!.textContent).toMatch(/already exists here/i);
  });
});

describe('NavigationTreeActions — the tree’s keyboard contract', () => {
  test('nothing here is a tree row, so no new control sits inside one', async () => {
    const mounted = await mountActions({ selectedId: 'page-1' });

    expect(mounted.wrapper.find('[role="treeitem"]').exists()).toBe(false);
    expect(mounted.wrapper.find('[role="tree"]').exists()).toBe(false);
  });
});

/*
 * The toolbar's row, 2026-09-16: "+ New…" sat beside "Rename…" at its
 * natural width and left the rest of the 280px pane empty to the right
 * (the owner's screenshot). The row fills: New… grows, Rename… keeps its
 * natural width. Geometry is the screenshots' to show; what a unit test
 * can hold is the class that makes it so, and that both stay 32px chrome
 * controls (docs/DESIGN-SYSTEM.md §7.2) — never below the 24px floor.
 */
describe('NavigationTreeActions — the toolbar row', () => {
  test('New… grows to fill the row and Rename… keeps its natural width, both at the 32px chrome height', async () => {
    const mounted = await mountActions({ selectedId: 'page-1' });

    const create = byTestId(mounted, 'tree-create-open')!;
    const rename = byTestId(mounted, 'tree-rename-open')!;
    expect(create.className).toMatch(/\bflex-1\b/);
    expect(rename.className).not.toMatch(/\bflex-1\b/);
    expect(create.className).toMatch(/\bmin-h-8\b/);
    expect(rename.className).toMatch(/\bmin-h-8\b/);
  });
});
