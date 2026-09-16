import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import EditorSelectionToolbar from './EditorSelectionToolbar.vue';

/**
 * The floating toolbar over a text selection (docs/TODO.md Findings
 * 2026-09-16, "the `/mount` API"): Bold, Italic, Strikethrough, Code and
 * Link, pressed from the selection plugin's `marks`, acting through the
 * owner (`EditorSurface`) so a button and its keystroke share one
 * command. Presentational, like `MentionMenu`: the owner decides when it
 * shows and where; this holds what it *is* — a named `toolbar` with one
 * tab stop and arrow keys between its controls (the WAI-ARIA toolbar
 * pattern, docs/UI-CHECKLIST.md §4.1's hand-rolled-primitive contract),
 * every control named and tooltipped (§4.3), the pressed state carried
 * by `aria-pressed` and a selected fill rather than colour alone (§5),
 * and Escape as the way back to the editor (§4.6).
 */
const NO_MARKS = { strong: false, emphasis: false, delete: false, inlineCode: false, link: false } as const;

type ToolbarProps = InstanceType<typeof EditorSelectionToolbar>['$props'];

function inApp(props: ToolbarProps) {
  return defineComponent({
    name: 'ToolbarInApp',
    setup: () => () => h(UApp, null, { default: () => h(EditorSelectionToolbar, props) }),
  });
}

function popover(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

async function settle(): Promise<void> {
  await nextTick();
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('EditorSelectionToolbar', () => {
  test('is a named toolbar at the viewport position it is given, holding the five formatting controls in order, each named and tooltipped', async () => {
    const component = await mountSuspended(inApp({ marks: NO_MARKS, link: null, position: { top: 120, left: 300 } }), { attachTo: document.body });

    const toolbar = component.get('[role="toolbar"]');
    expect(toolbar.attributes('aria-label')).toBe('Text formatting');
    expect(toolbar.classes()).toContain('fixed');
    expect((toolbar.element as HTMLElement).style.top).toBe('120px');
    expect((toolbar.element as HTMLElement).style.left).toBe('300px');

    const buttons = toolbar.findAll('button');
    expect(buttons.map((button) => button.attributes('aria-label'))).toEqual(['Bold', 'Italic', 'Strikethrough', 'Code', 'Link']);
    for (const button of buttons) {
      // Reka's tooltip trigger stamps `data-state` on the control it names (§4.3).
      expect(button.attributes('data-state')).toBeDefined();
    }
    component.unmount();
  });

  test('reflects the active marks as aria-pressed, with the selected fill on the pressed control and none on the rest', async () => {
    const component = await mountSuspended(inApp({ marks: { ...NO_MARKS, strong: true, inlineCode: true }, link: null, position: { top: 0, left: 0 } }));

    const pressed = component.findAll('[role="toolbar"] button').filter((button) => button.attributes('aria-pressed') === 'true');
    expect(pressed.map((button) => button.attributes('aria-label'))).toEqual(['Bold', 'Code']);
    expect(pressed[0]!.classes().some((cls) => /bg-secondary-container/.test(cls))).toBe(true);
    const italic = component.get('[role="toolbar"] button[aria-label="Italic"]');
    expect(italic.attributes('aria-pressed')).toBe('false');
    expect(italic.classes().some((cls) => /^bg-/.test(cls))).toBe(false);
  });

  test('a click on a mark button asks the owner to toggle that mark, and keeps focus in the editor by cancelling mousedown', async () => {
    const component = await mountSuspended(inApp({ marks: NO_MARKS, link: null, position: { top: 0, left: 0 } }));
    const toolbar = component.findComponent(EditorSelectionToolbar);
    const bold = component.get('[role="toolbar"] button[aria-label="Bold"]');

    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    bold.element.dispatchEvent(mousedown);
    expect(mousedown.defaultPrevented).toBe(true);
    await bold.trigger('click');
    await component.get('[role="toolbar"] button[aria-label="Strikethrough"]').trigger('click');

    expect(toolbar.emitted('toggle')).toEqual([['strong'], ['delete']]);
  });

  test('is one tab stop: the arrow keys move focus between the controls, Home and End jump to the ends, and Escape asks the owner for the editor back', async () => {
    const component = await mountSuspended(inApp({ marks: NO_MARKS, link: null, position: { top: 0, left: 0 } }), { attachTo: document.body });
    const toolbar = component.findComponent(EditorSelectionToolbar);
    const buttons = component.findAll('[role="toolbar"] button');
    expect(buttons.filter((button) => button.attributes('tabindex') === '0')).toHaveLength(1);

    (toolbar.vm as unknown as { focus: () => void }).focus();
    await nextTick();
    expect(document.activeElement).toBe(buttons[0]!.element);

    await buttons[0]!.trigger('keydown', { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]!.element);
    expect(buttons[1]!.attributes('tabindex')).toBe('0');
    expect(buttons[0]!.attributes('tabindex')).toBe('-1');

    await buttons[1]!.trigger('keydown', { key: 'End' });
    expect(document.activeElement).toBe(buttons[4]!.element);
    await buttons[4]!.trigger('keydown', { key: 'ArrowRight' });
    expect(document.activeElement, 'wraps').toBe(buttons[0]!.element);
    await buttons[0]!.trigger('keydown', { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(buttons[4]!.element);
    await buttons[4]!.trigger('keydown', { key: 'Home' });
    expect(document.activeElement).toBe(buttons[0]!.element);

    await buttons[0]!.trigger('keydown', { key: 'Escape' });
    expect(toolbar.emitted('close')).toHaveLength(1);
    component.unmount();
  });

  describe('the link control', () => {
    test('opens a popover holding a labelled URL field, and Enter there applies the address', async () => {
      const component = await mountSuspended(inApp({ marks: NO_MARKS, link: null, position: { top: 0, left: 0 } }), { attachTo: document.body });
      const toolbar = component.findComponent(EditorSelectionToolbar);
      const link = component.get('[role="toolbar"] button[aria-label="Link"]');
      expect(link.attributes('aria-haspopup')).toBe('dialog');
      expect(popover()).toBeNull();

      await link.trigger('click');
      await settle();

      const dialog = popover();
      expect(dialog).not.toBeNull();
      const input = dialog!.querySelector<HTMLInputElement>('input')!;
      expect(input).not.toBeNull();
      const labelId = input.getAttribute('id');
      expect(dialog!.querySelector(`label[for="${labelId}"]`)?.textContent).toMatch(/link url/i);
      expect(dialog!.textContent).not.toMatch(/remove link/i);

      input.value = 'https://example.com/spec';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      dialog!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await settle();

      expect(toolbar.emitted('setLink')).toEqual([['https://example.com/spec']]);
      component.unmount();
    });

    test('an empty address applies nothing', async () => {
      const component = await mountSuspended(inApp({ marks: NO_MARKS, link: null, position: { top: 0, left: 0 } }), { attachTo: document.body });
      const toolbar = component.findComponent(EditorSelectionToolbar);

      await component.get('[role="toolbar"] button[aria-label="Link"]').trigger('click');
      await settle();
      const dialog = popover()!;
      const input = dialog.querySelector<HTMLInputElement>('input')!;
      input.value = '   ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await settle();

      expect(toolbar.emitted('setLink')).toBeUndefined();
      component.unmount();
    });

    test('inside an existing link, the field is prefilled and "Remove link" asks the owner to unset it', async () => {
      const component = await mountSuspended(
        inApp({ marks: { ...NO_MARKS, link: true }, link: { href: 'https://example.com/old', title: null }, position: { top: 0, left: 0 } }),
        { attachTo: document.body },
      );
      const toolbar = component.findComponent(EditorSelectionToolbar);
      const link = component.get('[role="toolbar"] button[aria-label="Link"]');
      expect(link.attributes('aria-pressed')).toBe('true');

      await link.trigger('click');
      await settle();
      const dialog = popover()!;
      expect(dialog.querySelector<HTMLInputElement>('input')!.value).toBe('https://example.com/old');
      const remove = Array.from(dialog.querySelectorAll('button')).find((button) => /remove link/i.test(button.textContent ?? ''))!;
      expect(remove).toBeDefined();

      remove.click();
      await settle();

      expect(toolbar.emitted('unsetLink')).toHaveLength(1);
      component.unmount();
    });
  });
});
