import type { NuxtError } from '#app';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import ErrorScreen from './error.vue';

/**
 * `error.vue` is the screen Nuxt renders instead of `app.vue` when a route
 * did not resolve or a request failed before a page could. It declares its
 * own `UApp`, so — unlike the page suites — it is mounted directly.
 *
 * The assertions target accessible roles and names, never classes or DOM
 * shape (docs/UI-CHECKLIST.md §7).
 */
const { useRouteMock } = vi.hoisted(() => ({ useRouteMock: vi.fn() }));
mockNuxtImport('useRoute', () => useRouteMock);

/**
 * What Nuxt actually hands `error.vue` is a plain object carrying whatever
 * `createError` was given — `name`, `fatal`, `unhandled` and `toJSON` are
 * on the *type* but are not what any assertion here is about, and filling
 * them in would say this screen depends on fields it deliberately never
 * reads. The cast keeps each case to the fields the failure really has,
 * including the one that arrives with no status code at all.
 */
function asNuxtError(fields: Record<string, unknown>): NuxtError {
  return fields as unknown as NuxtError;
}

function atRoute(path: string): void {
  useRouteMock.mockReturnValue({ path, fullPath: path });
}

/** The accessible names of every button on the screen, chrome included. */
function buttonNames(component: { findAll: (selector: string) => { text: () => string; attributes: (name: string) => string | undefined }[] }): string[] {
  return component
    .findAll('button')
    .map((button) => button.text() || button.attributes('aria-label') || '')
    .filter((name) => name.length > 0);
}

describe('error screen', () => {
  test('a 404 states what happened in the user’s terms and keeps the product chrome', async () => {
    atRoute('/nowhere');

    const component = await mountSuspended(ErrorScreen, {
      props: { error: asNuxtError({ statusCode: 404, message: 'Page not found' }) },
    });

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe("This link doesn't lead anywhere");
    // A screen, so it carries the shell's landmarks — not a bare page.
    expect(component.find('header').exists()).toBe(true);
    expect(component.find('main').exists()).toBe(true);
    expect(component.find('footer').exists()).toBe(true);
    // Never a bare status code as the message (§3).
    expect(component.text()).not.toMatch(/HTTP 404/);
  });

  test('a 404 renders from the status code alone, so a denied resource cannot be told from a missing one', async () => {
    atRoute('/pages/11111111-1111-4111-8111-111111111111/history');

    const denied = await mountSuspended(ErrorScreen, {
      props: {
        error: asNuxtError({
          statusCode: 404,
          statusMessage: 'forbidden',
          message: 'user lacks read on node 11111111-1111-4111-8111-111111111111',
          data: { reason: 'forbidden' },
        }),
      },
    });
    const missing = await mountSuspended(ErrorScreen, {
      props: { error: asNuxtError({ statusCode: 404 }) },
    });

    // Nothing the server said about *why* reaches the page…
    expect(denied.text()).not.toMatch(/forbidden/i);
    expect(denied.text()).not.toMatch(/lacks read/i);
    // …so the two are the same screen. The address differs because the
    // user typed it; the copy about the failure does not.
    expect(denied.get('h1').text()).toBe(missing.get('h1').text());
  });

  test('a 404 inside a workspace offers that workspace, not just “go home”', async () => {
    atRoute('/workspaces/22222222-2222-4222-8222-222222222222/settings');

    const component = await mountSuspended(ErrorScreen, {
      props: { error: asNuxtError({ statusCode: 404 }) },
    });

    expect(buttonNames(component)).toContain('Open this workspace');
  });

  test('a 404 with no workspace or page in the address offers sign-in', async () => {
    atRoute('/totally/unknown');

    const component = await mountSuspended(ErrorScreen, {
      props: { error: asNuxtError({ statusCode: 404 }) },
    });

    expect(buttonNames(component)).toContain('Go to sign-in');
  });

  test('a server error is a different screen: it is announced, offers a retry, and carries a reference', async () => {
    atRoute('/pages/33333333-3333-4333-8333-333333333333');

    const component = await mountSuspended(ErrorScreen, {
      props: { error: asNuxtError({ statusCode: 500, message: 'ECONNREFUSED 127.0.0.1:5432' }) },
    });

    expect(component.get('h1').text()).toBe('Something went wrong on our side');
    // A failure the user did not ask for is announced (§5's live region).
    expect(component.find('[role="alert"]').exists()).toBe(true);
    expect(component.text()).toContain('Try again');
    // The reference sits beside the plain-language message, never instead of it.
    expect(component.text()).toContain('Reference: HTTP 500');
    // The raw server message is never echoed, in any environment.
    expect(component.text()).not.toMatch(/ECONNREFUSED/);
  });

  test('an error with no status code is treated as a server failure, not a missing address', async () => {
    atRoute('/');

    const component = await mountSuspended(ErrorScreen, {
      props: { error: asNuxtError({ message: 'boom' }) },
    });

    expect(component.get('h1').text()).toBe('Something went wrong on our side');
    expect(component.text()).toContain('Reference: HTTP 500');
  });
});
