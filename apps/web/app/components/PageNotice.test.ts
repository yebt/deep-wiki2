import { UIcon } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import PageNotice from './PageNotice.vue';

/**
 * The container a screen shows *instead of* its content: permission
 * denied, not found, refused, someone else is editing, nothing here yet,
 * the request failed. Eight hand-rolled copies of it were replaced by this
 * one component on 2026-09-07.
 *
 * Three of its props carry contracts a review had to catch by measuring
 * the running app, and each is asserted below:
 *
 * - `level` picks the heading *element*; the size follows from the level,
 *   so a screen's `<h1>` is `headline-medium` in every state it has
 *   (§4.4). The copies rendered 24px when the request failed and 28px when
 *   it succeeded, which made the type scale report the outcome.
 * - `tone="error"` swaps to M3's `error-container` accent role, and the
 *   colour is never the only signal (§5) — the icon and the wording are
 *   the caller's to supply, and the heading text carries it.
 * - `role` distinguishes a failure the user did not ask for (`alert`) from
 *   a state they navigated into (`status`) (§3).
 */
describe('PageNotice', () => {
  test('a notice that replaces a screen’s content owns the page’s h1 by default', async () => {
    const component = await mountSuspended(PageNotice, {
      props: { icon: 'i-lucide-lock', heading: 'You don’t have access to this page' },
      slots: { default: 'Ask a workspace admin to grant you access.' },
    });

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe('You don’t have access to this page');
    expect(component.text()).toContain('Ask a workspace admin to grant you access.');
  });

  test('the heading size follows the level, so an h1 is one type role in every state', async () => {
    const asH1 = await mountSuspended(PageNotice, { props: { icon: 'i-lucide-lock', heading: 'Denied' } });
    const asH2 = await mountSuspended(PageNotice, { props: { icon: 'i-lucide-lock', heading: 'Denied', level: 2 } });

    // 28px for the page's own heading, 24px for a notice standing under a
    // `PageHeading` that already rendered one — §2.3's scale read from the
    // level, never chosen per state.
    expect(asH1.get('h1').classes()).toContain('text-headline-medium');
    expect(asH2.findAll('h1')).toHaveLength(0);
    expect(asH2.get('h2').classes()).toContain('text-headline-small');
  });

  test('the error tone moves to the accent container role, and takes its own foreground with it', async () => {
    const errored = await mountSuspended(PageNotice, {
      props: { icon: 'i-lucide-circle-alert', heading: 'Couldn’t load the tree', tone: 'error' },
      slots: { default: 'The network request failed.' },
    });

    // `error-container` is an accent role, not a surface rung, so it does
    // not move on the ladder — and its foreground must move with it, or the
    // copy is drawn in the surface's `on-` role over an accent fill.
    expect(errored.element.className).toContain('bg-error-container');
    expect(errored.get('h1').classes()).toContain('text-on-error-container');
    expect(errored.get('p').classes()).toContain('text-on-error-container');
  });

  test('a neutral notice is the same card as the auth card, never the error fill', async () => {
    const component = await mountSuspended(PageNotice, {
      props: { icon: 'i-lucide-library-big', heading: 'No shelves yet' },
      slots: { default: 'Create a shelf to start organising books, chapters and pages.' },
    });

    expect(component.element.className).not.toContain('bg-error-container');
    expect(component.get('h1').classes()).not.toContain('text-on-error-container');
    // §9.4: a container on the app ground is the Filled card, one rung
    // above the chrome. `bg-elevated` is the rung the eight hand-rolled
    // copies were drawn at, byte-identical to the header above them.
    expect(component.element.className).not.toContain('bg-elevated');
  });

  test('a state the user navigated into is a status; a failure they did not ask for is an alert', async () => {
    const navigatedInto = await mountSuspended(PageNotice, { props: { icon: 'i-lucide-lock', heading: 'Denied' } });
    const failure = await mountSuspended(PageNotice, {
      props: { icon: 'i-lucide-circle-alert', heading: 'Couldn’t load the tree', tone: 'error', role: 'alert' },
    });

    expect(navigatedInto.element.getAttribute('role')).toBe('status');
    expect(failure.element.getAttribute('role')).toBe('alert');
  });

  test('the icon a screen chose is the one drawn, and it is never announced', async () => {
    const component = await mountSuspended(PageNotice, {
      props: { icon: 'i-lucide-lock', heading: 'You don’t have access to this page' },
    });

    // §4.3: an icon is never the only carrier of meaning — the heading says
    // it in words — and a decorative one must not be announced on top of
    // them. The name is the caller's: a notice that drew its own glyph
    // would say "locked" on the state that means "missing".
    // The rendered glyph arrives asynchronously (Iconify fetches the set),
    // so the assertion is on what this component actually decides: the name
    // it hands the icon, and that it is hidden from the accessibility tree.
    const icon = component.findComponent(UIcon);
    expect(icon.exists()).toBe(true);
    expect(icon.props('name')).toBe('i-lucide-lock');
    expect(icon.attributes('aria-hidden')).toBe('true');
    expect(component.text()).toContain('You don’t have access to this page');
  });

  test('the actions row exists only when a screen offers an action', async () => {
    const withAction = await mountSuspended(PageNotice, {
      props: { icon: 'i-lucide-circle-alert', heading: 'Couldn’t load the tree', tone: 'error', role: 'alert' },
      slots: { default: 'Offline.', actions: '<button type="button">Retry</button>' },
    });
    const without = await mountSuspended(PageNotice, {
      props: { icon: 'i-lucide-lock', heading: 'Denied' },
      slots: { default: 'Ask an admin.' },
    });

    expect(withAction.get('button').text()).toBe('Retry');
    expect(without.findAll('button')).toHaveLength(0);
    // …and no 24px of dead space under the copy where the actions would
    // have gone. `mt-6` is the actions row's own distance from the last
    // line (§7.4), so its absence is what "no row" looks like.
    expect(withAction.element.querySelector('.mt-6')).not.toBeNull();
    expect(without.element.querySelector('.mt-6')).toBeNull();
  });
});
