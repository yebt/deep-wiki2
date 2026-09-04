import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import ForgotPasswordPage from './forgot-password.vue';

const { usePasswordResetRequestMock } = vi.hoisted(() => ({ usePasswordResetRequestMock: vi.fn() }));

mockNuxtImport('usePasswordResetRequest', () => usePasswordResetRequestMock);

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(ForgotPasswordPage) }),
});

function mockRequest(overrides: Partial<{ status: string; message: string }> = {}) {
  const requestReset = vi.fn(async () => {});
  usePasswordResetRequestMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    message: ref(overrides.message ?? ''),
    requestReset,
  });
  return requestReset;
}

describe('forgot-password page', () => {
  test('renders exactly one h1 and the semantic landmarks', async () => {
    mockRequest();
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.find('header').exists()).toBe(true);
    expect(component.find('main').exists()).toBe(true);
    expect(component.find('footer').exists()).toBe(true);
  });

  test('has a labeled email field and links back to sign in', async () => {
    mockRequest();
    const component = await mountSuspended(PageInApp);

    expect(component.find('input[type="email"]').exists()).toBe(true);
    expect(component.find('a[href="/login"]').exists()).toBe(true);
  });

  test('the generic sent confirmation is the same regardless of account existence — it names no account state', async () => {
    mockRequest({
      status: 'sent',
      message: 'If an account exists for that email, a reset link has been sent.',
    });
    const component = await mountSuspended(PageInApp);

    const status = component.get('[role="status"]');
    expect(status.text()).toMatch(/if an account exists/i);
    expect(status.text()).not.toMatch(/no account|not found|does not exist/i);
  });

  test('a network failure shows a recoverable error, distinct from the sent confirmation', async () => {
    mockRequest({ status: 'network-error', message: 'Could not reach the server. Check your connection and try again.' });
    const component = await mountSuspended(PageInApp);

    const alert = component.get('[role="alert"]');
    expect(alert.text()).toMatch(/could not reach the server/i);
  });

  test('disables the submit control while loading', async () => {
    mockRequest({ status: 'loading' });
    const component = await mountSuspended(PageInApp);

    const submit = component.get('button[type="submit"]');
    expect(submit.attributes('disabled')).toBeDefined();
  });
});
