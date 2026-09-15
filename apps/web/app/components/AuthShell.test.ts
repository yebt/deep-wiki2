import { UApp, UCard } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import AppShell from './AppShell.vue';
import AuthShell from './AuthShell.vue';

/**
 * The sign-in family's own shell: the product's mark, the heading block and
 * the card, on the app ground, with no app chrome around them. Until
 * 2026-09-15 this component rendered inside `AppShell` — the top app bar
 * with the brand link, the registration entry and the theme toggle, and
 * the footer — so a visitor met the product's chrome before they had
 * entered the product. A sign-in screen is the one surface a person sees
 * *before* trusting the product, and it showed them a header for a room
 * they were not yet in.
 *
 * The assertions below are therefore about two things: what the shell
 * refuses to draw (the app's landmarks and navigation), and what it keeps
 * from the family's existing contracts (one `<h1>` outside the card, the
 * form inside it, the narrow column centred both ways, no eyebrow).
 */
function mountAuthShell(props: { heading: string; description?: string }) {
  return mountSuspended(
    defineComponent({
      name: 'AuthShellInApp',
      setup: () => () =>
        h(UApp, null, {
          default: () => h(AuthShell, props, { default: () => h('form', { 'data-testid': 'auth-form' }, 'fields') }),
        }),
    }),
  );
}

describe('AuthShell', () => {
  test('the page’s single h1 is the shell’s heading, and it stands outside the card', async () => {
    const component = await mountAuthShell({ heading: 'Sign in to deep-wiki' });

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe('Sign in to deep-wiki');
    // `UAuthForm`'s own `title` prop renders a `<div>`, not a heading, so
    // the page's heading can never be the card's title.
    expect(component.findComponent(UCard).element.contains(component.get('h1').element)).toBe(false);
  });

  test('the form goes inside the card', async () => {
    const component = await mountAuthShell({ heading: 'Sign in to deep-wiki' });

    const form = component.get('[data-testid="auth-form"]').element;
    expect(component.findComponent(UCard).element.contains(form)).toBe(true);
  });

  test('the supporting sentence renders under the heading when there is one', async () => {
    const withDescription = await mountAuthShell({
      heading: 'Reset your password',
      description: 'We’ll email you a link.',
    });
    const without = await mountAuthShell({ heading: 'Reset your password' });

    expect(withDescription.get('h1 + p').text()).toBe('We’ll email you a link.');
    expect(without.find('h1 + p').exists()).toBe(false);
  });

  test('there is no eyebrow above the heading', async () => {
    const component = await mountAuthShell({ heading: 'Sign in to deep-wiki' });

    // 2026-09-04: the shell supplied an eyebrow slot and every screen filled
    // it, so "Sign in" sat above "Sign in to deep-wiki" — a hierarchy level
    // spent on a paraphrase (§4.4). The `<h1>` is the first thing in the
    // heading block.
    const headingBlock = component.get('h1').element.parentElement!;
    expect([...headingBlock.children][0]!.tagName).toBe('H1');
  });

  test('the auth screens stand in the shell’s narrow column, centred both ways', async () => {
    const component = await mountAuthShell({ heading: 'Sign in to deep-wiki' });

    // `max-w-md` is §2.4's `narrow` column — one card holding a short form,
    // and the only screens in the product that are not on the reading
    // measure. `mx-auto` centres it; `my-auto` on the container is the
    // `center` prop, which absorbs the leftover vertical space.
    const column = component.get('h1').element.parentElement!.parentElement!;
    expect(column.className).toContain('max-w-md');
    expect(column.className).toContain('mx-auto');
    expect(column.parentElement!.className).toContain('my-auto');
  });

  test('a sign-in carries no app chrome: no header, no footer, no brand link, and no AppShell at all', async () => {
    const component = await mountAuthShell({ heading: 'Sign in' });

    // The app's `banner` and `contentinfo` landmarks belong to a signed-in
    // product. Here they are absent — not hidden, not emptied, absent.
    expect(component.findAll('header')).toHaveLength(0);
    expect(component.findAll('footer')).toHaveLength(0);
    expect(component.findComponent(AppShell).exists()).toBe(false);
    // The brand is identity on this screen, not a way back: there is no
    // "back" for a person who has not signed in, so it is not a link.
    expect(component.find('a[href="/"]').exists()).toBe(false);
    // One `main`, and the heading lives in it (docs/UI-CHECKLIST.md §5).
    expect(component.findAll('main')).toHaveLength(1);
    expect(component.get('main').element.contains(component.get('h1').element)).toBe(true);
  });

  test('the product’s mark and name come first, and are not interactive', async () => {
    const component = await mountAuthShell({ heading: 'Sign in' });

    const column = component.get('h1').element.parentElement!.parentElement!;
    const first = column.children[0]!;
    expect(first.textContent?.trim()).toBe('deep-wiki');
    expect(first.tagName).not.toBe('A');
    expect(first.querySelector('a, button')).toBeNull();
    // An icon is never the only carrier of meaning (§4.3): the name is text.
    expect(first.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  test('the theme toggle stays — small, named, and the only control outside the card', async () => {
    const component = await mountAuthShell({ heading: 'Sign in' });

    const card = component.findComponent(UCard).element;
    const outside = component.findAll('button, a').filter((node) => !card.contains(node.element));
    expect(outside).toHaveLength(1);
    expect(outside[0]!.attributes('aria-label')).toMatch(/theme|dark|light/i);
  });
});
