import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import ResetPasswordPage from './reset-password.vue';

const { usePasswordResetConfirmMock, useRouteMock } = vi.hoisted(() => ({
  usePasswordResetConfirmMock: vi.fn(),
  useRouteMock: vi.fn(),
}));

mockNuxtImport('usePasswordResetConfirm', () => usePasswordResetConfirmMock);
mockNuxtImport('useRoute', () => useRouteMock);

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(ResetPasswordPage) }),
});

function mockConfirm(overrides: Partial<{ status: string; message: string }> = {}) {
  const confirmReset = vi.fn(async () => {});
  usePasswordResetConfirmMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    message: ref(overrides.message ?? ''),
    confirmReset,
  });
  return confirmReset;
}

describe('reset-password page', () => {
  test('a missing token renders its own invalid-link state, with no form', async () => {
    useRouteMock.mockReturnValue({ query: {} });
    mockConfirm();
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.find('form').exists()).toBe(false);
    expect(component.text()).toMatch(/invalid|expired|link/i);
    expect(component.find('a[href="/forgot-password"]').exists()).toBe(true);
  });

  test('a present token renders the new-password form with matching-confirmation fields', async () => {
    useRouteMock.mockReturnValue({ query: { token: 'abc123' } });
    mockConfirm();
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('h1')).toHaveLength(1);
    const passwordInputs = component.findAll('input[type="password"]');
    expect(passwordInputs.length).toBe(2);
  });

  test('an invalid-or-expired token replaces the form with its own state, not a generic error', async () => {
    useRouteMock.mockReturnValue({ query: { token: 'stale' } });
    mockConfirm({ status: 'invalid-or-expired', message: 'This password reset link is invalid or has expired. Request a new one.' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('form').exists()).toBe(false);
    expect(component.text()).toMatch(/invalid or has expired/i);
    expect(component.find('a[href="/forgot-password"]').exists()).toBe(true);
  });

  test('a network failure keeps the form visible with a recoverable error banner', async () => {
    useRouteMock.mockReturnValue({ query: { token: 'abc123' } });
    mockConfirm({ status: 'network-error', message: 'Could not reach the server. Check your connection and try again.' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('form').exists()).toBe(true);
    const alert = component.get('[role="alert"]');
    expect(alert.text()).toMatch(/could not reach the server/i);
  });

  test('success is confirmed via a live region with a link back to sign in', async () => {
    useRouteMock.mockReturnValue({ query: { token: 'abc123' } });
    mockConfirm({ status: 'success', message: 'Your password has been changed.' });
    const component = await mountSuspended(PageInApp);

    const status = component.get('[role="status"]');
    expect(status.text()).toMatch(/password has been changed/i);
    expect(component.find('a[href="/login"]').exists()).toBe(true);
  });
});
