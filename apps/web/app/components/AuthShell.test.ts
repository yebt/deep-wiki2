import { UApp, UCard } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import AuthShell from './AuthShell.vue';

/**
 * The four authentication screens' only genuinely own layout decision:
 * which of `AppShell`'s columns they stand in, and a card in it.
 * Everything else — the chrome, the height, the heading block — is
 * delegated, and that delegation is the contract, because it was written
 * here too until 2026-09-07 and the copies drifted (this file rendered the
 * brand as an inert `<span>` and the theme toggle at 40px; `AppShell`
 * rendered a link at 32px).
 *
 * So the assertions below are about *what this shell delegates to* rather
 * than what it draws: the narrow column, the vertical centring, the page's
 * `<h1>` outside the card, and the card the form goes in.
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

  test('the chrome is the app shell’s: every auth screen gets the same landmarks as every other screen', async () => {
    const component = await mountAuthShell({ heading: 'Sign in to deep-wiki' });

    expect(component.findAll('header')).toHaveLength(1);
    expect(component.findAll('main')).toHaveLength(1);
    expect(component.findAll('footer')).toHaveLength(1);
    expect(component.get('header a').attributes('href')).toBe('/');
    expect(component.get('main').element.contains(component.get('h1').element)).toBe(true);
  });
});
