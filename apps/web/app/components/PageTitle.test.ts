import { mountSuspended } from '@nuxt/test-utils/runtime';
import { UApp } from '#components';
import { h } from 'vue';
import { describe, expect, test } from 'vitest';
import PageTitle from './PageTitle.vue';

/**
 * The page's title, edited in place (owner decision, 2026-09-23: "El
 * title, se edita y es el mismo title del page, como en obsidian").
 *
 * What is asserted here is the screen's half — one `<h1>` in every state,
 * the two ways in, the keys, the announcement, and that the optimistic
 * name reaches the rest of the screen. The rename's own rules (trim,
 * unchanged, 409, revert) are `usePageTitle.test.ts`'s.
 *
 * Mounted inside `UApp` like every page suite: `UTooltip` injects its
 * provider. No request is made anywhere here — every test stops before a
 * commit, which is `usePageTitle.test.ts`'s subject.
 */
function mount(props: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  return mountSuspended(
    {
      setup: () => () => h(UApp, null, { default: () => h(PageTitle, { nodeId: 'n1', title: 'Handbook', workspaceId: 'ws-1', ...props }) }),
    },
    options,
  );
}

describe('PageTitle', () => {
  test('renders the page’s single h1 at the heading role, with the name in it', async () => {
    const component = await mount();

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe('Handbook');
    expect(component.get('h1').classes()).toContain('text-headline-medium');
  });

  test('the way in by keyboard is a named, tooltipped control that is never out of the tab order', async () => {
    const component = await mount();
    const rename = component.get('[data-testid="page-title-rename"]');

    expect(rename.attributes('aria-label')).toBe('Rename this page');
    expect(rename.attributes('disabled')).toBeUndefined();
    // Quiet until the heading is hovered or it is focused (§4.4), never hidden.
    expect(rename.classes()).toContain('opacity-0');
    expect(rename.classes()).toContain('focus-visible:opacity-100');
  });

  test('the control opens a named field inside the heading, so the screen still has exactly one h1', async () => {
    const component = await mount();
    await component.get('[data-testid="page-title-rename"]').trigger('click');
    await component.vm.$nextTick();

    const field = component.get('[data-testid="page-title-field"]');
    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').find('[data-testid="page-title-field"]').exists()).toBe(true);
    expect((field.element as HTMLInputElement).value).toBe('Handbook');
    expect(field.attributes('aria-label')).toBe('Title of this page');
    // The heading's own type role, in the field too: the title does not
    // change size when it becomes editable (§4.4, §3's no layout shift).
    expect(field.classes()).toContain('text-headline-medium');
  });

  test('the title itself opens the field, as it does in Obsidian', async () => {
    const component = await mount();
    await component.get('[data-testid="page-title-text"]').trigger('click');
    await component.vm.$nextTick();

    expect(component.find('[data-testid="page-title-field"]').exists()).toBe(true);
  });

  test('a screen with nothing to rename offers no way in', async () => {
    const component = await mount({ editable: false });

    expect(component.find('[data-testid="page-title-rename"]').exists()).toBe(false);
    await component.get('[data-testid="page-title-text"]').trigger('click');
    await component.vm.$nextTick();
    expect(component.find('[data-testid="page-title-field"]').exists()).toBe(false);
  });

  test('Escape closes the field, writes nothing, and hands focus back to the control that opened it', async () => {
    // `attachTo`: focus only exists for an element in the document
    // (the same reason `forgot-password.test.ts` attaches).
    const component = await mount({}, { attachTo: document.body });
    await component.get('[data-testid="page-title-rename"]').trigger('click');
    await component.vm.$nextTick();
    const field = component.get('[data-testid="page-title-field"]');
    (field.element as HTMLInputElement).value = 'Notes';
    await field.trigger('input');
    await field.trigger('keydown.escape');
    await component.vm.$nextTick();
    await component.vm.$nextTick();

    expect(component.find('[data-testid="page-title-field"]').exists()).toBe(false);
    expect(component.get('h1').text()).toBe('Handbook');
    expect(document.activeElement).toBe(component.get('[data-testid="page-title-rename"]').element);
    component.unmount();
  });
});
