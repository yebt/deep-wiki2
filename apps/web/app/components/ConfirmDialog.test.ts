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

  /**
   * A question outranks every other overlay (owner decision, 2026-09-17).
   * At 320 the sidebar drawer — a Reka dialog portalled into the body when
   * opened — stacked *above* "Leave without saving?": both at `z-index:
   * auto`, so the later portal won, and a pointer could not reach Cancel.
   * The stacking ladder now lives in `docs/DESIGN-SYSTEM.md` §4.5: modals
   * one rung above the drawer and the menus (`z-60`), and this dialog one
   * rung above every modal (`z-70`), scrim and content alike, so the scrim
   * covers what it must cover. happy-dom lays nothing out, so the rung is
   * what this holds; `e2e/editor.spec.ts` measures the drawer case.
   */
  test('stands on the highest overlay rung, scrim and content both, above the modal rung every other dialog takes', async () => {
    await mount();
    void useConfirm().confirm({ title: 'Leave without saving?', confirmLabel: 'Leave' });
    await settle();

    const content = dialog()!;
    expect(content.className).toMatch(/\bz-70\b/);
    expect(content.className).not.toMatch(/\bz-60\b/);
    const overlay = document.querySelector('[data-slot="overlay"]')!;
    expect(overlay).not.toBeNull();
    expect(overlay.className).toMatch(/\bz-70\b/);
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

  /**
   * The typed-name step (design.md Decision 8): a delete that takes pages
   * with it asks the owner to type the container's name. The field is the
   * consent, so focus lands on it rather than on Cancel; the confirm
   * action stays `aria-disabled` with its reason (checklist §3 "Disabled",
   * §5) until the typed value is the name exactly; Enter in the field
   * agrees only then. And a "yes" the server refuses — the count changed,
   * the name changed — keeps the dialog open with the refusal under the
   * field and the new consequence in the description, never a second
   * dialog.
   */
  describe('with confirmText', () => {
    function field(): HTMLInputElement {
      const input = dialog()?.querySelector<HTMLInputElement>('input');
      if (!input) throw new Error('no field in the dialog');
      return input;
    }

    async function type(value: string): Promise<void> {
      const input = field();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
    }

    test('renders a labelled field naming what to type, focused on open', async () => {
      await mount();
      document.getElementById('opener')!.focus();
      void useConfirm().confirm({
        title: 'Delete “Handbook”?',
        description: '12 pages and 3 chapters will be deleted.',
        confirmLabel: 'Delete',
        tone: 'destructive',
        confirmText: 'Handbook',
      });
      await settle();

      const input = field();
      const label = dialog()!.querySelector(`label[for="${input.id}"]`);
      expect(label?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Type Handbook to confirm');
      expect(document.activeElement).toBe(input);
    });

    test('the confirm action is aria-disabled with its reason until the typed value matches exactly, case and all', async () => {
      await mount();
      void useConfirm().confirm({ title: 'Delete “Handbook”?', confirmLabel: 'Delete', tone: 'destructive', confirmText: 'Handbook' });
      await settle();

      const accept = buttonNamed(/^Delete$/);
      expect(accept.getAttribute('aria-disabled')).toBe('true');
      expect(accept.hasAttribute('disabled'), 'never the attribute — it leaves the tab order').toBe(false);
      const reason = document.getElementById(accept.getAttribute('aria-describedby') ?? '');
      expect(reason?.textContent).toMatch(/type the name exactly as shown/i);

      await type('handbook');
      expect(accept.getAttribute('aria-disabled')).toBe('true');
      await type('Handbook ');
      expect(accept.getAttribute('aria-disabled'), 'surrounding whitespace is forgiven').toBeNull();
      await type('Handbook');
      expect(accept.getAttribute('aria-disabled')).toBeNull();
    });

    test('a click on the unavailable action does nothing; Enter in the field agrees only on a match', async () => {
      await mount();
      const answer = useConfirm().confirm({ title: 'Delete “Handbook”?', confirmLabel: 'Delete', tone: 'destructive', confirmText: 'Handbook' });
      await settle();

      await type('Hand');
      buttonNamed(/^Delete$/).click();
      field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await settle();
      expect(dialog(), 'still asking').not.toBeNull();

      await type('Handbook');
      field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await expect(answer).resolves.toBe(true);
      await settle();
      expect(dialog()).toBeNull();
    });

    test('a refusal from onConfirm keeps the dialog open: the error under the field, the new description in place, focus on the field', async () => {
      await mount();
      let attempts = 0;
      const answer = useConfirm().confirm({
        title: 'Delete “Handbook”?',
        description: '3 pages will be deleted.',
        confirmLabel: 'Delete',
        tone: 'destructive',
        confirmText: 'Handbook',
        onConfirm: async () => {
          attempts += 1;
          return attempts === 1 ? { fieldError: 'The count changed while this was open.', description: '4 pages will be deleted.' } : null;
        },
      });
      await settle();
      await type('Handbook');
      buttonNamed(/^Delete$/).click();
      await settle();

      const el = dialog();
      expect(el, 'still open').not.toBeNull();
      expect(el!.textContent).toContain('The count changed while this was open.');
      expect(el!.textContent).toContain('4 pages will be deleted.');
      expect(el!.textContent).not.toContain('3 pages will be deleted.');
      const described = field().getAttribute('aria-describedby') ?? '';
      expect(described.split(' ').some((id) => document.getElementById(id)?.textContent?.includes('The count changed'))).toBe(true);
      expect(document.activeElement).toBe(field());

      buttonNamed(/^Delete$/).click();
      await expect(answer).resolves.toBe(true);
      await settle();
      expect(dialog()).toBeNull();
    });
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
