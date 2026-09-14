import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import RegistrationPage from './registration.vue';

const { useInstanceSettingsMock } = vi.hoisted(() => ({ useInstanceSettingsMock: vi.fn() }));

mockNuxtImport('useInstanceSettings', () => useInstanceSettingsMock);

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(RegistrationPage) }),
});

const unverified = {
  registrationMode: 'invitation_only' as const,
  openRegistrationDomains: [] as string[],
  smtpVerifiedAt: null as string | null,
  smtpVerificationReverted: false,
};
const verified = { ...unverified, smtpVerifiedAt: '2026-09-14T10:00:00.000Z' };

function mockSettings(
  overrides: {
    status?: string;
    message?: string;
    settings?: unknown;
    modeStatus?: string;
    modeMessage?: string;
    domainsStatus?: string;
    domainsMessage?: string;
    smtpStatus?: string;
    smtpMessage?: string;
  } = {},
) {
  const fns = {
    load: vi.fn(async () => {}),
    saveMode: vi.fn(async () => {}),
    saveDomains: vi.fn(async () => {}),
    sendSmtpTest: vi.fn(async () => {}),
  };
  useInstanceSettingsMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    message: ref(overrides.message ?? ''),
    settings: ref(overrides.settings ?? null),
    modeStatus: ref(overrides.modeStatus ?? 'idle'),
    modeMessage: ref(overrides.modeMessage ?? ''),
    domainsStatus: ref(overrides.domainsStatus ?? 'idle'),
    domainsMessage: ref(overrides.domainsMessage ?? ''),
    smtpStatus: ref(overrides.smtpStatus ?? 'idle'),
    smtpMessage: ref(overrides.smtpMessage ?? ''),
    ...fns,
  });
  return fns;
}

describe('instance registration screen', () => {
  test('renders one h1 and the shell landmarks', async () => {
    mockSettings({ status: 'success', settings: unverified });
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.find('header').exists()).toBe(true);
    expect(component.find('main').exists()).toBe(true);
    expect(component.find('footer').exists()).toBe(true);
  });

  test('renders a skeleton while it loads and no form', async () => {
    mockSettings({ status: 'loading' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('[data-testid="registration-skeleton"]').exists()).toBe(true);
    expect(component.find('form').exists()).toBe(false);
  });

  test('a non-operator gets a coherent denied state naming who can change this, and no form', async () => {
    mockSettings({ status: 'forbidden', message: 'Only the instance operator can change registration.' });
    const component = await mountSuspended(PageInApp);

    expect(component.get('[role="status"]').text()).toMatch(/operator/i);
    expect(component.find('form').exists()).toBe(false);
  });

  test('while SMTP is unverified the open option says what it needs, and the mode saved is the one chosen', async () => {
    const { saveMode } = mockSettings({ status: 'success', settings: unverified });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/not verified/i);
    const openRadio = component.findAll('[role="radio"]').find((r) => /open/i.test(r.attributes('aria-label') ?? r.text()) || r.attributes('value') === 'open');
    expect(openRadio, 'a radio for the open mode').toBeDefined();
    expect(openRadio!.attributes('disabled')).toBeUndefined();

    const closedRadio = component.findAll('[role="radio"]').find((r) => r.attributes('value') === 'closed')!;
    await closedRadio.trigger('click');
    const modeForm = component.find('form[aria-labelledby="mode-heading"]');
    await modeForm.trigger('submit');
    await flushPromises();

    expect(saveMode).toHaveBeenCalledWith('closed');
  });

  test('a refused switch to open is shown as a refusal, with the server\'s reason, and the mode shown stays the server\'s', async () => {
    mockSettings({
      status: 'success',
      settings: unverified,
      modeStatus: 'refused',
      modeMessage: 'Not changed: switching to open mode requires a successful SMTP test send first.',
    });
    const component = await mountSuspended(PageInApp);

    expect(component.get('[role="alert"]').text()).toMatch(/smtp/i);
    const checked = component.findAll('[role="radio"]').find((r) => r.attributes('aria-checked') === 'true');
    expect(checked?.attributes('value')).toBe('invitation_only');
  });

  test('a reverted open mode is announced as such — the switch the operator flipped is off, and the screen says why', async () => {
    mockSettings({ status: 'success', settings: { ...unverified, smtpVerificationReverted: true } });
    const component = await mountSuspended(PageInApp);

    const alerts = component.findAll('[role="alert"]').map((a) => a.text());
    expect(alerts.some((t) => /switched off|reverted/i.test(t) && /smtp/i.test(t))).toBe(true);
  });

  test('with SMTP verified the screen names when, in a <time> carrying the instant', async () => {
    mockSettings({ status: 'success', settings: verified });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/verified/i);
    expect(component.find('time').attributes('datetime')).toBe('2026-09-14T10:00:00.000Z');
  });

  test('the SMTP test form has a labelled address field and sends to it', async () => {
    const { sendSmtpTest } = mockSettings({ status: 'success', settings: unverified });
    const component = await mountSuspended(PageInApp);

    const label = component.findAll('label').find((l) => /send a test message to/i.test(l.text()));
    expect(label, 'a label for the test address').toBeDefined();
    await component.find(`#${label!.attributes('for')}`).setValue('ops@example.com');
    await component.find('form[aria-labelledby="smtp-heading"]').trigger('submit');
    await flushPromises();

    expect(sendSmtpTest).toHaveBeenCalledWith('ops@example.com');
  });

  test('a failed test send is its own alert naming the SMTP settings as the thing to fix', async () => {
    mockSettings({ status: 'success', settings: unverified, smtpStatus: 'failed', smtpMessage: 'The test message could not be sent. Check the SMTP settings.' });
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('[role="alert"]').some((a) => /could not be sent/i.test(a.text()))).toBe(true);
  });

  test('the allowlist form saves the domains typed', async () => {
    const { saveDomains } = mockSettings({ status: 'success', settings: { ...unverified, openRegistrationDomains: ['company.com'] } });
    const component = await mountSuspended(PageInApp);

    const label = component.findAll('label').find((l) => /allowed domains/i.test(l.text()));
    expect(label, 'a label for the allowlist').toBeDefined();
    const field = component.find(`#${label!.attributes('for')}`);
    expect((field.element as HTMLTextAreaElement).value).toContain('company.com');
    await field.setValue('company.com\npartner.io');
    await component.find('form[aria-labelledby="domains-heading"]').trigger('submit');
    await flushPromises();

    expect(saveDomains).toHaveBeenCalledWith(['company.com', 'partner.io']);
  });

  test('a saved change is confirmed in a live region', async () => {
    mockSettings({ status: 'success', settings: unverified, modeStatus: 'saved', modeMessage: 'Registration is now closed — nobody can create an account.' });
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('[role="status"]').some((s) => /now closed/i.test(s.text()))).toBe(true);
  });

  test('a failed load is a recoverable error with a retry', async () => {
    const { load } = mockSettings({ status: 'network-error', message: 'Could not reach the server.' });
    const component = await mountSuspended(PageInApp);

    expect(component.get('[role="alert"]').text()).toMatch(/could not reach/i);
    const retry = component.findAll('button').find((b) => /retry/i.test(b.text()));
    load.mockClear();
    await retry!.trigger('click');
    expect(load).toHaveBeenCalled();
  });

  test('a signed-out visitor is offered sign-in', async () => {
    mockSettings({ status: 'unauthenticated' });
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('a').find((a) => /sign in/i.test(a.text()))?.attributes('href')).toBe('/login');
  });
});
