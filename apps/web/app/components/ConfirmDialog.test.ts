import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import ConfirmDialog from './ConfirmDialog.vue';

/**
 * The answer half of `useConfirm`: the one dialog every "are you sure"
 * in the product opens, mounted once in `app.vue`. Until 2026-09-16 edit
 * mode asked with `window.confirm`, which no theme, no focus rule and no
 * copy standard reaches; `beforeunload` (a tab closing) is the one prompt
 * the browser keeps for itself and is the one that stays.
 */

const HostInApp = defineComponent({
  name: 'HostInApp',
  setup: () => () => h(UApp, null, { default: () => [h('button', { id: 'opener', type: 'button' }, 'Delete'), h(ConfirmDialog)] }),
});

const mounted: VueWrapper[] = [];

async function mount(): Promise<VueWrapper> {
  const wrapper = await mountSuspended(HostInApp, { attachTo: document.body });
  mounted.push(wrapper);
  return wrapper;
}

/** The dialog renders in a portal, so it is found on the document, not under the wrapper. */
function dialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

function buttonNamed(pattern: RegExp): HTMLButtonElement {
  const button = Array.from(dialog()?.querySelectorAll('button') ?? []).find((b) => pattern.test(b.textContent ?? ''));
  if (!button) throw new Error(`no button matching ${pattern} in the dialog`);
  return button;
}

async function settle(): Promise<void> {
  await nextTick();
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  useConfirm().settle(false);
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('ConfirmDialog', () => {
  test('renders no dialog while nothing is pending', async () => {
    await mount();
    expect(dialog()).toBeNull();
  });

  test('renders the question as a dialog: title, description, the cancel and confirm labels it was given', async () => {
    await mount();
    void useConfirm().confirm({
      title: 'Leave without saving?',
      description: 'Your unsaved changes in this tab will be lost.',
      confirmLabel: 'Leave',
      cancelLabel: 'Keep editing',
    });
    await settle();

    const el = dialog();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('Leave without saving?');
    expect(el!.textContent).toContain('Your unsaved changes in this tab will be lost.');
    expect(buttonNamed(/^Keep editing$/)).toBeDefined();
    expect(buttonNamed(/^Leave$/)).toBeDefined();
    // The dialog has no "X": Escape and the cancel action are its exits,
    // and a third, unlabelled one would be a control with no reason.
    expect(el!.querySelector('button[aria-label="Close"]')).toBeNull();
  });

  test('the confirm action is the one filled button, primary by default and error for a destructive question', async () => {
    await mount();
    void useConfirm().confirm({ title: 'Save?', confirmLabel: 'Save' });
    await settle();
    expect(buttonNamed(/^Save$/).className).toMatch(/\bbg-primary\b/);
    expect(buttonNamed(/^Cancel$/).className).not.toMatch(/\bbg-primary\b/);
    useConfirm().settle(false);
    await settle();

    void useConfirm().confirm({ title: 'Take over editing?', confirmLabel: 'Take over', tone: 'destructive' });
    await settle();
    expect(buttonNamed(/^Take over$/).className).toMatch(/\bbg-error\b/);
  });

  test('confirming answers true and closes; cancelling answers false and closes', async () => {
    await mount();
    const yes = useConfirm().confirm({ title: 'Go?', confirmLabel: 'Go' });
    await settle();
    buttonNamed(/^Go$/).click();
    await expect(yes).resolves.toBe(true);
    await settle();
    expect(dialog()).toBeNull();

    const no = useConfirm().confirm({ title: 'Go?', confirmLabel: 'Go' });
    await settle();
    buttonNamed(/^Cancel$/).click();
    await expect(no).resolves.toBe(false);
    await settle();
    expect(dialog()).toBeNull();
  });

  test('Escape cancels — the answer is false, never a dialog left open', async () => {
    await mount();
    const answer = useConfirm().confirm({ title: 'Go?', confirmLabel: 'Go' });
    await settle();

    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await expect(answer).resolves.toBe(false);
    await settle();
    expect(dialog()).toBeNull();
  });

  test('focus moves into the dialog on open, onto the safe action, and returns to the control that asked when it closes', async () => {
    await mount();
    const opener = document.getElementById('opener')!;
    opener.focus();
    expect(document.activeElement).toBe(opener);

    void useConfirm().confirm({ title: 'Go?', confirmLabel: 'Go' });
    await settle();
    expect(dialog()!.contains(document.activeElement), 'focus is inside the dialog').toBe(true);
    expect(document.activeElement).toBe(buttonNamed(/^Cancel$/));

    buttonNamed(/^Cancel$/).click();
    await settle();
    expect(document.activeElement).toBe(opener);
  });
});
