import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import InlineNotice from './InlineNotice.vue';

/**
 * The two inline notice tiers (bar and chip) — the ones that sit *inside* a
 * screen's flow rather than replacing its content, which is `PageNotice`'s
 * job. Before this component the bar existed twelve times across the four
 * auth screens and the chip six times in edit mode, each a hand-rolled
 * `div` (docs/UI-CHECKLIST.md §4.1: anything on more than one screen is
 * one component).
 */

type NoticeProps = InstanceType<typeof InlineNotice>['$props'];

function inApp(props: NoticeProps, slots: Record<string, () => unknown> = {}) {
  return defineComponent({
    name: 'NoticeInApp',
    setup: () => () => h(UApp, null, { default: () => h(InlineNotice, props, slots) }),
  });
}

describe('InlineNotice', () => {
  test('a bar carries an icon, a title and supporting text, and the tone picks the M3 container pair', async () => {
    const component = await mountSuspended(
      inApp({ tier: 'bar', tone: 'success', icon: 'i-lucide-circle-check', title: 'Done' }, { default: () => 'All good.' }),
    );

    const root = component.get('[data-notice-tier="bar"]');
    expect(root.classes()).toContain('bg-success-container');
    expect(root.text()).toContain('Done');
    expect(root.text()).toContain('All good.');
    expect(root.find('[aria-hidden="true"]').exists()).toBe(true);
  });

  // `info` is for a fact the person should know that is neither a result
  // nor a fault — "your session ended, sign in to go back" on the sign-in
  // screen. Its container pair already exists in main.css beside the
  // other three; the tone only had no name here.
  test('the info tone picks the M3 info container pair', async () => {
    const component = await mountSuspended(inApp({ tier: 'chip', tone: 'info' }, { default: () => 'Your session has ended.' }));

    const root = component.get('[data-notice-tier="chip"]');
    expect(root.classes()).toContain('bg-info-container');
    expect(root.classes()).toContain('text-on-info-container');
  });

  test('a chip is the one-line tier: no title, and its action sits on the same row', async () => {
    const component = await mountSuspended(
      inApp({ tier: 'chip', tone: 'error', role: 'alert' }, { default: () => 'Save refused.', actions: () => h('button', 'Reload') }),
    );

    const root = component.get('[data-notice-tier="chip"]');
    expect(root.classes()).toContain('bg-error-container');
    expect(root.find('button').text()).toBe('Reload');
    expect(root.findAll('p')).toHaveLength(0);
  });

  test('a state the user navigated into is a polite status; a failure is an alert', async () => {
    const status = await mountSuspended(inApp({ tier: 'bar', tone: 'success', icon: 'i-lucide-check', title: 'Sent' }));
    expect(status.get('[data-notice-tier]').attributes('role')).toBe('status');
    expect(status.get('[data-notice-tier]').attributes('aria-live')).toBe('polite');

    const alert = await mountSuspended(inApp({ tier: 'bar', tone: 'error', icon: 'i-lucide-x', title: 'Failed', role: 'alert' }));
    expect(alert.get('[data-notice-tier]').attributes('role')).toBe('alert');
  });

  // The 2026-09-14 audit measured `document.activeElement` after the
  // forgot-password submit: `BODY`. The form the user was in had been
  // replaced, and focus fell off the page. Checklist §5: async state
  // changes are announced — and a result that takes focus is both read
  // and the place the next Tab starts from.
  test('with `focus`, a notice that appears after an async change takes focus, from wherever focus was', async () => {
    const shown = ref(false);
    const Host = defineComponent({
      name: 'FocusHost',
      setup: () => () =>
        h(UApp, null, {
          default: () => [
            h('button', { id: 'submit' }, 'Submit'),
            shown.value ? h(InlineNotice, { tier: 'bar', tone: 'success', icon: 'i-lucide-check', title: 'Sent', focus: true }) : null,
          ],
        }),
    });
    const component = await mountSuspended(Host, { attachTo: document.body });

    // Blur first: the assertion below is meaningless if nothing had focus.
    (component.get('#submit').element as HTMLButtonElement).focus();
    expect(document.activeElement?.id).toBe('submit');

    shown.value = true;
    await nextTick();
    await nextTick();

    const notice = component.get('[data-notice-tier]').element;
    expect(document.activeElement).toBe(notice);
    component.unmount();
  });

  test('without `focus`, a notice leaves focus where it was', async () => {
    const shown = ref(false);
    const Host = defineComponent({
      name: 'StillHost',
      setup: () => () =>
        h(UApp, null, {
          default: () => [
            h('button', { id: 'keep' }, 'Keep'),
            shown.value ? h(InlineNotice, { tier: 'chip', tone: 'error', role: 'alert' }, { default: () => 'Refused' }) : null,
          ],
        }),
    });
    const component = await mountSuspended(Host, { attachTo: document.body });
    (component.get('#keep').element as HTMLButtonElement).focus();

    shown.value = true;
    await nextTick();
    await nextTick();

    expect(document.activeElement?.id).toBe('keep');
    component.unmount();
  });

  test('uses only on-grid spacing, never an arbitrary bracketed value', async () => {
    const component = await mountSuspended(inApp({ tier: 'bar', tone: 'warning', icon: 'i-lucide-alert', title: 'Hm' }));

    expect(component.html()).not.toMatch(/\[[0-9.]+(px|rem)\]/);
  });
});
