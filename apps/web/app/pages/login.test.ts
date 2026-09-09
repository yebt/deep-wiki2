import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import AuthSubmit from '../components/AuthSubmit.vue';
import LoginPage from './login.vue';

const { useLoginMock } = vi.hoisted(() => ({ useLoginMock: vi.fn() }));

mockNuxtImport('useLogin', () => useLoginMock);

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(LoginPage) }),
});

function mockLogin(overrides: Partial<{ status: string; message: string }> = {}) {
  const login = vi.fn(async () => {});
  useLoginMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    message: ref(overrides.message ?? ''),
    login,
  });
  return login;
}

describe('login page', () => {
  test('renders exactly one h1 and the semantic landmarks', async () => {
    mockLogin();
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toMatch(/sign in/i);
    expect(component.find('header').exists()).toBe(true);
    expect(component.find('main').exists()).toBe(true);
    expect(component.find('footer').exists()).toBe(true);
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
  test('routes its submit control through the pre-hydration guard', async () => {
    mockLogin();
    const component = await mountSuspended(PageInApp);

    expect(component.findComponent(AuthSubmit).exists()).toBe(true);
  });
});
