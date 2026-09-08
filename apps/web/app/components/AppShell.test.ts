import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h, type VNode } from 'vue';
import AppShell from './AppShell.vue';

/**
 * `AppShell` owns two things no screen may restate: the chrome (the
 * full-height column, the app bar, the footer) and the content column's
 * width *and horizontal position*.
 *
 * The second is the one with a history. Measured on the running app at
 * 1280x900 on 2026-09-07, the read, edit and navigation-tree screens each
 * rendered a 658.9px column at **x=32** — `max-w-measure` caps a width and
 * centres nothing, so the right 589px of every product screen was empty
 * (docs/UI-CHECKLIST.md §6; docs/DESIGN-SYSTEM.md §2.4, "a measure is a
 * cap, not a position"). The suite was green throughout, because nothing
 * asserted the column at all.
 *
 * A unit test cannot measure a rendered box — happy-dom has no layout
 * engine, and the Review Log is explicit that the geometry belongs in
 * `e2e/auth-layout.spec.ts`. What it *can* hold is the half that was
 * missing when the defect shipped: that the column carries a horizontal
 * position at all, and that each of the three kinds resolves to the width
 * §2.4's table gives it. `mx-auto` disappearing from this file is exactly
 * the regression, and it now costs a red test rather than a review.
 */
function mountInApp(render: () => VNode) {
  return mountSuspended(
    defineComponent({
      name: 'ShellInApp',
      setup: () => () => h(UApp, null, { default: render }),
    }),
  );
}

const SLOT = { 'data-testid': 'shell-slot' } as const;

function mountShell(props: Record<string, unknown> = {}, headerEnd?: () => VNode) {
  return mountInApp(() =>
    h(AppShell, props, {
      default: () => h('p', SLOT, 'screen content'),
      ...(headerEnd ? { 'header-end': headerEnd } : {}),
    }),
  );
}

/** The element the slot's content sits directly inside — the shell's column. */
function columnOf(component: Awaited<ReturnType<typeof mountShell>>): HTMLElement {
  const slot = component.get('[data-testid="shell-slot"]').element;
  return slot.parentElement as HTMLElement;
}

describe('AppShell', () => {
  describe('the content column', () => {
    test('the measure column is centred, not merely capped', async () => {
      const component = await mountShell({ column: 'measure' });

      const column = columnOf(component);
      expect(column.className).toContain('max-w-measure');
      // The half that was missing when 589px of every wide screen went
      // unused: a maximum width with no horizontal position.
      expect(column.className).toContain('mx-auto');
    });

    test('the narrow column is centred too, and is the auth card width rather than the measure', async () => {
      const component = await mountShell({ column: 'narrow' });

      const column = columnOf(component);
      expect(column.className).toContain('max-w-md');
      expect(column.className).toContain('mx-auto');
      expect(column.className).not.toContain('max-w-measure');
    });

    test('the wide column states no maximum width, so the container’s own is what applies', async () => {
      const component = await mountShell({ column: 'wide' });

      const column = columnOf(component);
      expect(column.className).not.toMatch(/max-w-/);
    });

    test('a screen that names no column gets the reading measure', async () => {
      const component = await mountShell();

      expect(columnOf(component).className).toContain('max-w-measure');
    });

    test('the column stands inside the page’s one main landmark', async () => {
      const component = await mountShell();

      const main = component.get('main').element;
      expect(component.findAll('main')).toHaveLength(1);
      expect(main.contains(columnOf(component))).toBe(true);
    });

    test('`center` absorbs the leftover vertical space, and is off unless asked for', async () => {
      const centred = await mountShell({ center: true });
      const topAligned = await mountShell();

      // `my-auto` sits on the container around the column: it only absorbs
      // *positive* free space, so a block taller than the region stays
      // top-aligned and fully reachable.
      expect(columnOf(centred).parentElement!.className).toContain('my-auto');
      expect(columnOf(topAligned).parentElement!.className).not.toContain('my-auto');
    });
  });

  describe('the chrome', () => {
    test('renders the three landmarks every screen shares, exactly once each', async () => {
      const component = await mountShell();

      expect(component.findAll('header')).toHaveLength(1);
      expect(component.findAll('main')).toHaveLength(1);
      expect(component.findAll('footer')).toHaveLength(1);
    });

    test('the brand is the way back from any screen, so it is a link and not a label', async () => {
      const component = await mountShell();

      const brand = component.get('header a');
      expect(brand.attributes('href')).toBe('/');
      expect(brand.text()).toContain('deep-wiki');
    });

    test('the only icon-only control in the chrome carries an accessible name', async () => {
      const component = await mountShell();

      const named = component
        .findAll('header button')
        .filter((button) => (button.text() || button.attributes('aria-label') || '').length > 0);
      expect(named).toHaveLength(component.findAll('header button').length);
      expect(named.some((button) => button.attributes('aria-label') === 'Toggle color theme')).toBe(true);
    });

    test('the header renders no control that does nothing — no route mounts a mobile menu yet', async () => {
      const component = await mountShell();

      // `UHeader`'s default hamburger opens a menu built from its `#body`
      // slot, which nothing fills: a control that looks clickable and is
      // inert (docs/UI-CHECKLIST.md §6, observable breakage).
      expect(component.findAll('header button')).toHaveLength(1);
    });

    test('`header-end` puts a screen’s own chrome in the app bar, beside the shared theme toggle', async () => {
      const component = await mountShell({}, () => h('button', { type: 'button' }, 'Save'));

      const header = component.get('header').element;
      const save = component.get('header button');
      expect(save.text()).toBe('Save');
      expect(header.contains(save.element)).toBe(true);
      // Screen chrome first, then the toggle every screen shares.
      expect(component.findAll('header button')).toHaveLength(2);
      expect(component.findAll('header button')[1]!.attributes('aria-label')).toBe('Toggle color theme');
    });

    test('the screen’s content is not in the header or the footer', async () => {
      const component = await mountShell();

      const slot = component.get('[data-testid="shell-slot"]').element;
      expect(component.get('header').element.contains(slot)).toBe(false);
      expect(component.get('footer').element.contains(slot)).toBe(false);
    });
  });
});
