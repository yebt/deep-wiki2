import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import AuthSubmit from '../../components/AuthSubmit.vue';
import AcceptInvitePage from './accept.vue';

const { useAcceptInvitationMock, useRouteMock } = vi.hoisted(() => ({
  useAcceptInvitationMock: vi.fn(),
  useRouteMock: vi.fn(),
}));

mockNuxtImport('useAcceptInvitation', () => useAcceptInvitationMock);
mockNuxtImport('useRoute', () => useRouteMock);

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(AcceptInvitePage) }),
});

function mockAccept(overrides: Partial<{ status: string; message: string; workspaceId: string | null }> = {}) {
  const accept = vi.fn(async () => {});
  useAcceptInvitationMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    message: ref(overrides.message ?? ''),
    workspaceId: ref(overrides.workspaceId ?? null),
    accept,
  });
  return accept;
}

describe('invite/accept page', () => {
  test('a missing token renders its own invalid state, with no form', async () => {
    useRouteMock.mockReturnValue({ query: {} });
    mockAccept();
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.find('form').exists()).toBe(false);
    expect(component.text()).toMatch(/invalid|invite/i);
  });

  // The audit (2026-09-14) found `/invite/accept` with no token rendering
  // zero actions — prose and nothing else. Checklist §3: never a dead end.
  // `/reset-password` with no token already offers "Request a new link"; an
  // invitation cannot be re-requested by the invitee, so the way out is the
  // door someone who already has an account needs: sign in.
  test('a missing token still offers a way out — sign in — like the reset screen does', async () => {
    useRouteMock.mockReturnValue({ query: {} });
    mockAccept();
    const component = await mountSuspended(PageInApp);

    expect(component.find('a[href="/login"]').exists()).toBe(true);
  });

  test('a refused invitation is an alert and takes focus from the submit control it replaced', async () => {
    useRouteMock.mockReturnValue({ query: { token: 'old' } });
    const status = ref('idle');
    useAcceptInvitationMock.mockReturnValue({ status, message: ref('This invitation has expired. Ask whoever invited you to send a new one.'), workspaceId: ref(null), accept: vi.fn() });
    const component = await mountSuspended(PageInApp, { attachTo: document.body });
    (component.get('button[type="submit"]').element as HTMLButtonElement).focus();
    expect(document.activeElement?.tagName).toBe('BUTTON');

    status.value = 'expired';
    await nextTick();
    await nextTick();

    const alert = component.get('[role="alert"]');
    expect(alert.text()).toMatch(/expired/i);
    expect(document.activeElement).toBe(alert.element);
    component.unmount();
  });

  test('the joined confirmation takes focus from the submit control it replaced', async () => {
    useRouteMock.mockReturnValue({ query: { token: 'abc123' } });
    const status = ref('idle');
    useAcceptInvitationMock.mockReturnValue({ status, message: ref('You have joined the workspace.'), workspaceId: ref('ws1'), accept: vi.fn() });
    const component = await mountSuspended(PageInApp, { attachTo: document.body });
    (component.get('button[type="submit"]').element as HTMLButtonElement).focus();

    status.value = 'success';
    await nextTick();
    await nextTick();

    expect(document.activeElement).toBe(component.get('[role="status"]').element);
    component.unmount();
  });

  test('a present token renders the join form: display name and password', async () => {
    useRouteMock.mockReturnValue({ query: { token: 'abc123' } });
    mockAccept();
    const component = await mountSuspended(PageInApp);

    expect(component.find('input[type="text"]').exists()).toBe(true);
    expect(component.findAll('input[type="password"]').length).toBe(2);
  });

  test('an expired invitation renders its own state, distinct from an invalid link', async () => {
    useRouteMock.mockReturnValue({ query: { token: 'old' } });
    mockAccept({ status: 'expired', message: 'This invitation has expired. Ask whoever invited you to send a new one.' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('form').exists()).toBe(false);
    expect(component.text()).toMatch(/expired/i);
  });

  test('an already-used invitation renders its own state with a sign-in path', async () => {
    useRouteMock.mockReturnValue({ query: { token: 'used' } });
    mockAccept({ status: 'already-used', message: 'This invitation has already been used. Sign in instead.' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('form').exists()).toBe(false);
    expect(component.text()).toMatch(/already/i);
    expect(component.find('a[href="/login"]').exists()).toBe(true);
  });

  test('an invalid invitation renders its own state', async () => {
    useRouteMock.mockReturnValue({ query: { token: 'garbage' } });
    mockAccept({ status: 'invalid', message: "This invitation link isn't valid." });
    const component = await mountSuspended(PageInApp);

    expect(component.find('form').exists()).toBe(false);
    expect(component.text()).toMatch(/isn't valid/i);
  });

  test('a network failure keeps the form visible with a recoverable error banner', async () => {
    useRouteMock.mockReturnValue({ query: { token: 'abc123' } });
    mockAccept({ status: 'network-error', message: 'Could not reach the server. Check your connection and try again.' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('form').exists()).toBe(true);
    const alert = component.get('[role="alert"]');
    expect(alert.text()).toMatch(/could not reach the server/i);
  });

  test('success is confirmed via a live region', async () => {
    useRouteMock.mockReturnValue({ query: { token: 'abc123' } });
    mockAccept({ status: 'success', message: 'You have joined the workspace.', workspaceId: 'ws1' });
    const component = await mountSuspended(PageInApp);

    const status = component.get('[role="status"]');
    expect(status.text()).toMatch(/joined the workspace/i);
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
    useRouteMock.mockReturnValue({ query: { token: 'abc123' } });
    mockAccept();
    const component = await mountSuspended(PageInApp);

    expect(component.findComponent(AuthSubmit).exists()).toBe(true);
  });
});
