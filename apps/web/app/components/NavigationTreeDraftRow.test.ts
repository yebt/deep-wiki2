import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import type { TreeRowEditorBinding } from '~/composables/useTreeRowEditor';
import NavigationTreeDraftRow from './NavigationTreeDraftRow.vue';

/**
 * The row a creation is typed into, as a row of the tree.
 *
 * What this holds is the ARIA the wrapper owes and the roving tabindex it
 * must not join: the draft is a real `treeitem` so the tree's shape stays
 * true while it exists (a book that is about to hold three pages says
 * `aria-setsize` 3, not 2), and it is `tabindex="-1"` so the arrow keys
 * never land on a row that is a text box — the field itself holds focus.
 */
function binding(): TreeRowEditorBinding {
  return {
    snapshot: {
      draft: { mode: 'create', parentId: 'book-1', type: 'page', depth: 2, parentTitle: 'Handbook' },
      phase: 'naming',
      value: '',
      error: null,
    },
    setValue: () => {},
    commit: () => {},
    cancel: () => {},
  };
}

let wrapper: Awaited<ReturnType<typeof mountSuspended>> | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

async function mount() {
  const host = defineComponent({
    setup: () => () =>
      h(UApp, null, {
        default: () => h('ul', { role: 'tree' }, [h(NavigationTreeDraftRow, { editor: binding(), depth: 2, posinset: 3, setSize: 3 })]),
      }),
  });
  wrapper = await mountSuspended(host, { attachTo: document.body });
  await nextTick();
  return wrapper.element as HTMLElement;
}

describe('NavigationTreeDraftRow', () => {
  test('is a real row of the tree, at the level and place the new node will have', async () => {
    const root = await mount();
    const item = root.querySelector('[role="treeitem"]')!;

    expect(item.getAttribute('aria-level')).toBe('3');
    expect(item.getAttribute('aria-posinset')).toBe('3');
    expect(item.getAttribute('aria-setsize')).toBe('3');
    expect(item.getAttribute('aria-selected')).toBe('false');
  });

  test('is not a tab stop: the field inside it is what has focus', async () => {
    const root = await mount();
    expect(root.querySelector('[role="treeitem"]')?.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement?.tagName).toBe('INPUT');
  });

  test('carries the editor, so the one field is drawn here too', async () => {
    const root = await mount();
    expect(root.querySelector('[data-row-editor] input')?.getAttribute('aria-label')).toBe('Name of the new page');
  });
});
