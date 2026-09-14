import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import AuthSubmit from '../components/AuthSubmit.vue';
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

  // Measured by the 2026-09-14 audit: after submitting, `document.activeElement`
  // was `BODY`. The form — and the button that had focus — was replaced by the
  // confirmation, and nothing took focus in its place (checklist §5, "async
  // state changes are announced"; §3, never a dead end).
  test('the sent confirmation takes focus from the submit control it replaced', async () => {
    const status = ref('idle');
    usePasswordResetRequestMock.mockReturnValue({ status, message: ref('If an account exists for that email, a reset link has been sent.'), requestReset: vi.fn() });
    const component = await mountSuspended(PageInApp, { attachTo: document.body });

    (component.get('button[type="submit"]').element as HTMLButtonElement).focus();
    expect(document.activeElement?.tagName).toBe('BUTTON');

    status.value = 'sent';
    await nextTick();
    await nextTick();

    expect(document.activeElement).toBe(component.get('[role="status"]').element);
    component.unmount();
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
    mockRequest();
    const component = await mountSuspended(PageInApp);

    expect(component.findComponent(AuthSubmit).exists()).toBe(true);
  });
});
