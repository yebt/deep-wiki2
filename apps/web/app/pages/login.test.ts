import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import AuthSubmit from '../components/AuthSubmit.vue';
import LoginPage from './login.vue';

const { useLoginMock, useRouteMock, navigateToMock } = vi.hoisted(() => ({
  useLoginMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ query: {} as Record<string, unknown>, fullPath: '/login' })),
  navigateToMock: vi.fn(async () => {}),
}));

mockNuxtImport('useLogin', () => useLoginMock);
mockNuxtImport('useRoute', () => useRouteMock);
mockNuxtImport('navigateTo', () => navigateToMock);

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(LoginPage) }),
});

function mockLogin(overrides: Partial<{ status: string; message: string }> = {}) {
  const status = ref(overrides.status ?? 'idle');
  // A submit that succeeds: the composable's own status moves, which is
  // what the page navigates on.
  const login = vi.fn(async () => {
    status.value = 'success';
  });
  useLoginMock.mockReturnValue({
    status,
    message: ref(overrides.message ?? ''),
    login,
  });
  return login;
}

function atAddress(query: Record<string, unknown>) {
  useRouteMock.mockReturnValue({ query, fullPath: '/login' });
}

/** Fill both fields and submit; the page navigates 800ms after the composable reports success. */
async function signInThrough(component: Awaited<ReturnType<typeof mountSuspended>>): Promise<void> {
  await component.get('input[type="email"]').setValue('a@example.com');
  await component.get('input[type="password"]').setValue('correct horse');
  await component.get('form').trigger('submit');
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

describe('login page', () => {
  beforeEach(() => {
    navigateToMock.mockClear();
    atAddress({});
  });

  test('renders exactly one h1 inside main, and no app chrome around it', async () => {
    mockLogin();
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toMatch(/^sign in$/i);
    expect(component.find('main').exists()).toBe(true);
    // A sign-in is met before the product: no app bar, no footer (AuthShell).
    expect(component.find('header').exists()).toBe(false);
    expect(component.find('footer').exists()).toBe(false);
  });

  test('says what the product is, in one truthful line, under the mark', async () => {
    mockLogin();
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toContain('deep-wiki');
    expect(component.get('h1 + p').text()).toBe('Your team’s design documents, decisions and runbooks.');
  });

  test('has a labeled email field and a labeled password field', async () => {
    mockLogin();
    const component = await mountSuspended(PageInApp);

    const emailInput = component.get('input[type="email"]');
    const passwordInput = component.get('input[type="password"]');
    expect(emailInput).toBeTruthy();
    expect(passwordInput).toBeTruthy();
  });

  test('links to the forgot-password page', async () => {
    mockLogin();
    const component = await mountSuspended(PageInApp);

    const link = component.find('a[href="/forgot-password"]');
    expect(link.exists()).toBe(true);
  });

  test('shows a recoverable error banner announced via role="alert" on invalid credentials', async () => {
    mockLogin({ status: 'invalid-credentials', message: 'Incorrect email or password.' });
    const component = await mountSuspended(PageInApp);

    const alert = component.get('[role="alert"]');
    expect(alert.text()).toMatch(/incorrect email or password/i);
  });

  test('disables the submit control while loading, with a visible reason', async () => {
    mockLogin({ status: 'loading', message: 'Signing in…' });
    const component = await mountSuspended(PageInApp);

    const submit = component.get('button[type="submit"]');
    expect(submit.attributes('disabled')).toBeDefined();
    expect(submit.text()).toMatch(/signing in/i);
  });

  test('shows a success confirmation, announced via a live region, on success', async () => {
    mockLogin({ status: 'success', message: 'Signed in.' });
    const component = await mountSuspended(PageInApp);

    const status = component.get('[role="status"]');
    expect(status.text()).toMatch(/signed in/i);
  });

  /**
   * What this asserts is *wiring*, and it is worth being blunt about the
   * difference. Once the page has mounted, a guarded submit control and an
   * unguarded one render identically — same element, same type, same label —
   * so there is nothing here that could tell them apart. The window the guard
   * exists for is the one before mount, and this test starts after it.
   *
   * The guarantee itself is held in `app/components/AuthSubmit.test.ts`,
   * which server-renders the control and asserts against those exact bytes.
   * This test exists so that a page which quietly stops routing through the
   * guard fails in the suite instead of in somebody's browser. Read it as a
   * wiring check and nothing more.
   */
  /**
   * The return half of `useSignInRedirect`: a screen that bounced a
   * signed-out visitor here wrote where they were into `next`, and a
   * successful sign-in takes them back there rather than to `/` — with a
   * notice, shown once, saying why they are here (docs/UI-CHECKLIST.md
   * §3: a redirect with no explanation is a dead end).
   */
  describe('reached by a redirect from a signed-in screen', () => {
    test('explains the bounce in a polite notice, not an alert, and names the sign-in as the way back', async () => {
      atAddress({ next: '/workspaces/ws-1/members' });
      mockLogin();
      const component = await mountSuspended(PageInApp);

      const notice = component.get('[role="status"]');
      expect(notice.text()).toMatch(/session has ended/i);
      expect(notice.text()).toMatch(/sign in/i);
      expect(component.findAll('[role="alert"]')).toHaveLength(0);
    });

    test('returns to the address it was sent from once the sign-in succeeds', async () => {
      atAddress({ next: '/workspaces/ws-1/members?tab=invites' });
      mockLogin();
      const component = await mountSuspended(PageInApp);

      await signInThrough(component);

      expect(navigateToMock).toHaveBeenCalledWith('/workspaces/ws-1/members?tab=invites');
    });

    test('ignores a return address that leaves this origin, and lands on the front door instead', async () => {
      atAddress({ next: 'https://evil.example/phish' });
      mockLogin();
      const component = await mountSuspended(PageInApp);

      expect(component.findAll('[role="status"]')).toHaveLength(0);
      await signInThrough(component);

      expect(navigateToMock).toHaveBeenCalledWith('/');
    });
  });

  test('reached directly, shows no session notice and lands on the front door after sign-in', async () => {
    atAddress({});
    mockLogin();
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('[role="status"]')).toHaveLength(0);
    await signInThrough(component);

    expect(navigateToMock).toHaveBeenCalledWith('/');
  });

  test('routes its submit control through the pre-hydration guard', async () => {
    mockLogin();
    const component = await mountSuspended(PageInApp);

    expect(component.findComponent(AuthSubmit).exists()).toBe(true);
  });
});
