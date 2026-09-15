import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import SidebarToggle from './SidebarToggle.vue';

/**
 * The control that hides the sidebar and brings it back — focus mode.
 * Icon-only, so it carries an accessible name *and* a tooltip (checklist
 * §4.3), the name saying what the next press does; the state change is
 * announced (§5); and the keys are the ones Notion binds and Obsidian's
 * users ask for, `Ctrl`/`⌘` + `\`, which also stay clear of `Ctrl+B` in
 * an editor.
 *
 * What a browser owns: that the sidebar actually vanishes and the article
 * takes the pane, that it is still hidden after a reload, and that below
 * `lg` the drawer is untouched — `e2e/frame.spec.ts`, "focus mode".
 */
const mounted: Awaited<ReturnType<typeof mountSuspended>>[] = [];

async function mount() {
  useFocusMode().collapsed.value = false;
  const wrapper = await mountSuspended(
    defineComponent({
      name: 'ToggleInApp',
      setup: () => () => h(UApp, null, { default: () => h(SidebarToggle) }),
    }),
  );
  mounted.push(wrapper);
  return wrapper;
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('SidebarToggle', () => {
  test('is icon-only with a name that says what the next press does, and flips it on click', async () => {
    const component = await mount();

    const button = component.get('button');
    expect(button.text()).toBe('');
    expect(button.attributes('aria-label')).toBe('Hide sidebar');

    await button.trigger('click');

    expect(useFocusMode().collapsed.value).toBe(true);
    expect(component.get('button').attributes('aria-label')).toBe('Show sidebar');
  });

  test('announces the change in a live region that is always in the DOM, naming the keys that bring the sidebar back', async () => {
    const component = await mount();
    const status = component.get('[role="status"]');
    expect(status.text()).toBe('');

    await component.get('button').trigger('click');
    expect(status.text()).toMatch(/^Sidebar hidden\. Press .+\\ to show it\.$/);

    await component.get('button').trigger('click');
    expect(status.text()).toBe('Sidebar shown.');
  });

  test('Ctrl+\\ toggles it from anywhere on the page, the editor included', async () => {
    await mount();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true, bubbles: true }));
    await nextTick();

    expect(useFocusMode().collapsed.value).toBe(true);
  });

  test('hiding the sidebar while focus is inside it moves focus to the content bar, and otherwise leaves focus alone', async () => {
    // The sidebar and the bar, by the ids the frame gives them.
    const sidebar = document.createElement('div');
    sidebar.id = 'dw-frame-sidebar-workspace';
    const inSidebar = document.createElement('button');
    sidebar.append(inSidebar);
    const bar = document.createElement('header');
    bar.id = 'content-bar';
    bar.tabIndex = -1;
    document.body.append(sidebar, bar);
    try {
      await mount();
      inSidebar.focus();
      expect(document.activeElement).toBe(inSidebar);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true, bubbles: true }));
      await nextTick();
      await nextTick();
      expect(document.activeElement).toBe(bar);

      // Showing it again does not move focus; nor does hiding it from elsewhere.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true, bubbles: true }));
      await nextTick();
      expect(document.activeElement).toBe(bar);
      bar.blur();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true, bubbles: true }));
      await nextTick();
      await nextTick();
      expect(document.activeElement).not.toBe(bar);
    } finally {
      sidebar.remove();
      bar.remove();
    }
  });

  test('is hidden below lg, where the sidebar is a drawer with its own toggle', async () => {
    const component = await mount();

    expect(component.get('button').classes()).toEqual(expect.arrayContaining(['hidden', 'lg:inline-flex']));
  });
});
