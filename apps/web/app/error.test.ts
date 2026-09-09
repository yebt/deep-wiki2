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

  test('a 404 inside the workspaces area, with no id, offers the list of workspaces', async () => {
    // The address the owner actually landed on. `/workspaces/` names a real
    // part of the product and no particular workspace, and it used to fall
    // all the way through to sign-in.
    atRoute('/workspaces/');

    const component = await mountSuspended(ErrorScreen, {
      props: { error: asNuxtError({ statusCode: 404 }) },
    });

    expect(buttonNames(component)).toContain('Your workspaces');
  });

  test('a 404 with no workspace or page in the address still offers somewhere to go', async () => {
    atRoute('/totally/unknown');

    const component = await mountSuspended(ErrorScreen, {
      props: { error: asNuxtError({ statusCode: 404 }) },
    });

    expect(buttonNames(component)).toContain('Your workspaces');
  });

  /**
   * The defect this screen was sent back for. The owner reached it from
   * `/workspaces/` while signed in and was offered "Go to sign-in" and
   * nothing else — an action that was not merely unhelpful but false about
   * them. The session cookie is HttpOnly and there is no session endpoint,
   * so this screen genuinely cannot know whether it is talking to a signed-in
   * subject. The fix is therefore not a better guess: it is to stop making
   * the claim. Every destination in this product needs a session, so sign-in
   * stays on the screen — as the second door, never as the only one.
   */
  test.each([
    ['/totally/unknown'],
    ['/workspaces/'],
    ['/workspaces/44444444-4444-4444-8444-444444444444/settings'],
    ['/pages/55555555-5555-4555-8555-555555555555/nope'],
  ])('sign-in is never the only way out of a 404 at %s', async (path) => {
    atRoute(path);

    const component = await mountSuspended(ErrorScreen, {
      props: { error: asNuxtError({ statusCode: 404 }) },
    });

    const names = buttonNames(component);
    const exits = names.filter((name) => name !== 'Toggle color theme');

    expect(exits).toContain('Sign in');
    expect(exits.length).toBeGreaterThan(1);
    // …and the sign-in offer is never the first one, because the address
    // always supports something more specific than "start over".
    expect(exits[0]).not.toBe('Sign in');
  });

  test('the address the user typed is on the screen, because it came from the user', async () => {
    atRoute('/workspaces/66666666-6666-4666-8666-666666666666/settings');

    const component = await mountSuspended(ErrorScreen, {
      props: { error: asNuxtError({ statusCode: 404 }) },
    });

    expect(component.text()).toContain('/workspaces/66666666-6666-4666-8666-666666666666/settings');
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

  test('the server branch offers a retry and nothing else — a second exit there is not a choice', async () => {
    atRoute('/pages/77777777-7777-4777-8777-777777777777');

    const component = await mountSuspended(ErrorScreen, {
      props: { error: asNuxtError({ statusCode: 503 }) },
    });

    const exits = buttonNames(component).filter((name) => name !== 'Toggle color theme');
    expect(exits).toEqual(['Try again']);
  });

  test('both states render exactly one h1, at one type role', async () => {
    atRoute('/nowhere');
    const notFound = await mountSuspended(ErrorScreen, {
      props: { error: asNuxtError({ statusCode: 404 }) },
    });
    const failed = await mountSuspended(ErrorScreen, {
      props: { error: asNuxtError({ statusCode: 500 }) },
    });

    expect(notFound.findAll('h1')).toHaveLength(1);
    expect(failed.findAll('h1')).toHaveLength(1);
    // The *type role* is what §4.4 requires to hold across a screen's
    // states — the colour is allowed to change, and does: the failed
    // branch is an `error-container`, which brings its own `on-` role.
    expect(notFound.get('h1').classes()).toContain('text-headline-medium');
    expect(failed.get('h1').classes()).toContain('text-headline-medium');
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
