import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import type { TunesItem } from '~/utils/block-tunes';
import EditorBlockHandle from './EditorBlockHandle.vue';

/**
 * The block handle (docs/TODO.md Findings 2026-09-16, "the `/mount`
 * API"): the one `⋮⋮` beside the hovered block, draggable, and the
 * trigger of the tunes menu. The owner decides where it stands and what
 * the menu offers; this holds that the handle is named and tooltipped
 * with its keys (§4.3, §5), that the menu is the library's — unavailable
 * items in it `aria-disabled` with their reason on show (§3, §5) — and
 * that a drag reaches the owner.
 */
const ITEMS: TunesItem[][] = [
  [
    {
      label: 'Turn into',
      icon: 'i-lucide-replace',
      children: [
        { label: 'Text', icon: 'i-lucide-pilcrow', onSelect: vi.fn() },
        { label: 'Heading 2', icon: 'i-lucide-heading-2', disabled: true, description: 'Already a heading 2.' },
      ],
    },
  ],
  [
    { label: 'Move up', icon: 'i-lucide-arrow-up', disabled: true, description: 'Already the first block.', kbds: ['alt', 'arrowup'] },
    { label: 'Move down', icon: 'i-lucide-arrow-down', kbds: ['alt', 'arrowdown'], onSelect: vi.fn() },
  ],
];

function inApp(props: Record<string, unknown>) {
  return defineComponent({
    name: 'HandleInApp',
    setup: () => () => h(UApp, null, { default: () => h(EditorBlockHandle, { top: 40, items: ITEMS, modifierName: 'Control', ...props }) }),
  });
}

function menuItems(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]'));
}

async function settle(): Promise<void> {
  await nextTick();
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('EditorBlockHandle', () => {
  test('is a named, tooltipped, draggable control at the block\'s top, out of the tab order, with the menu\'s keys stated', async () => {
    const component = await mountSuspended(inApp({}), { attachTo: document.body });

    const root = component.get('[data-testid="block-handle"]');
    expect((root.element as HTMLElement).style.top).toBe('40px');
    const button = root.get('button');
    expect(button.attributes('aria-label')).toBe('Block options');
    expect(button.attributes('draggable')).toBe('true');
    expect(button.attributes('tabindex')).toBe('-1');
    expect(button.attributes('aria-haspopup')).toBe('menu');
    expect(button.attributes('aria-keyshortcuts')).toBe('Control+/');
    // Reka's tooltip trigger stamps `data-state` on the control it names.
    expect(button.attributes('data-state')).toBeDefined();
    component.unmount();
  });

  test('a click opens the tunes menu with the items given, unavailable ones aria-disabled with their reason on show, and Escape closes it', async () => {
    const component = await mountSuspended(inApp({}), { attachTo: document.body });
    const handle = component.findComponent(EditorBlockHandle);

    await component.get('[data-testid="block-handle"] button').trigger('click');
    await settle();

    const labels = menuItems().map((item) => item.textContent?.replace(/\s+/g, ' ').trim());
    expect(labels.some((label) => label?.startsWith('Turn into'))).toBe(true);
    expect(labels.some((label) => label?.startsWith('Move up'))).toBe(true);
    const up = menuItems().find((item) => item.textContent?.includes('Move up'))!;
    expect(up.getAttribute('aria-disabled')).toBe('true');
    expect(up.textContent).toContain('Already the first block.');
    expect(handle.emitted('update:open')).toEqual([[true]]);

    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(handle.emitted('closed')).toHaveLength(1);
    component.unmount();
  });

  test('selecting an item runs its action', async () => {
    const component = await mountSuspended(inApp({}), { attachTo: document.body });
    const down = ITEMS[1]![1]!;
    vi.mocked(down.onSelect!).mockClear();

    await component.get('[data-testid="block-handle"] button').trigger('click');
    await settle();
    const item = menuItems().find((entry) => entry.textContent?.includes('Move down'))!;
    item.click();
    await settle();

    expect(down.onSelect).toHaveBeenCalledTimes(1);
    component.unmount();
  });

  test('a drag from the handle reaches the owner with the event, and its end reaches it too', async () => {
    const component = await mountSuspended(inApp({}), { attachTo: document.body });
    const handle = component.findComponent(EditorBlockHandle);
    const button = component.get('[data-testid="block-handle"] button');

    await button.trigger('dragstart');
    await button.trigger('dragend');

    expect(handle.emitted('dragStart')).toHaveLength(1);
    expect(handle.emitted('dragStart')![0]![0]).toBeInstanceOf(Event);
    expect(handle.emitted('dragEnd')).toHaveLength(1);
    component.unmount();
  });
});
