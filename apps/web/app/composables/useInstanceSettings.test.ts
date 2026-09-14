import { describe, expect, test, vi } from 'vitest';
import type { InstanceSettingsResponse } from '@deep-wiki/contracts';
import { useInstanceSettings, type UseInstanceSettingsDeps } from './useInstanceSettings';

function responseError(status: number, data?: unknown) {
  return { response: { status }, data };
}

const settings: InstanceSettingsResponse = {
  registrationMode: 'invitation_only',
  openRegistrationDomains: ['company.com'],
  smtpVerifiedAt: null,
  smtpVerificationReverted: false,
};

type Deps = Required<UseInstanceSettingsDeps>;

function build(overrides: Partial<Deps> = {}) {
  const deps: Deps = {
    fetchSettings: vi.fn(async () => settings),
    putMode: vi.fn(async () => ({ ok: true as const })),
    putDomains: vi.fn(async () => ({ ok: true as const })),
    postSmtpTest: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
  return { deps, result: useInstanceSettings(deps) };
}

describe('useInstanceSettings — load', () => {
  test('starts idle and loads the settings on success', async () => {
    const { result } = build();

    expect(result.status.value).toBe('idle');
    await result.load();

    expect(result.status.value).toBe('success');
    expect(result.settings.value).toEqual(settings);
  });

  test('a 403 is the forbidden state — this screen is the operator\'s alone, and saying so discloses nothing', async () => {
    const { result } = build({
      fetchSettings: vi.fn(async () => {
        throw responseError(403);
      }),
    });

    await result.load();

    expect(result.status.value).toBe('forbidden');
  });

  test('a 401 is its own state, so the screen offers sign-in rather than a retry', async () => {
    const { result } = build({
      fetchSettings: vi.fn(async () => {
        throw responseError(401);
      }),
    });

    await result.load();

    expect(result.status.value).toBe('unauthenticated');
  });

  test('an unreachable server is a recoverable error', async () => {
    const { result } = build({
      fetchSettings: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    });

    await result.load();

    expect(result.status.value).toBe('network-error');
    expect(result.message.value).toMatch(/try again/i);
  });
});

describe('useInstanceSettings — changes', () => {
  test('saving a mode puts it, then reloads so the screen shows what the server holds', async () => {
    const fetchSettings = vi.fn(async () => settings);
    const { deps, result } = build({ fetchSettings });
    await result.load();
    fetchSettings.mockClear();

    await result.saveMode('closed');

    expect(deps.putMode).toHaveBeenCalledWith({ mode: 'closed' });
    expect(result.modeStatus.value).toBe('saved');
    expect(fetchSettings).toHaveBeenCalledTimes(1);
  });

  test('a refused switch to open is its own state carrying the server\'s reason, and the mode shown stays what the server holds', async () => {
    const { result } = build({
      putMode: vi.fn(async () => {
        throw responseError(400, { error: 'switching to open mode requires a successful SMTP test send first' });
      }),
    });
    await result.load();

    await result.saveMode('open');

    expect(result.modeStatus.value).toBe('refused');
    expect(result.modeMessage.value).toMatch(/smtp/i);
    expect(result.settings.value?.registrationMode).toBe('invitation_only');
  });

  test('saving the allowlist normalises the domains and reloads', async () => {
    const { deps, result } = build();
    await result.load();

    await result.saveDomains([' Company.com ', 'partner.io', 'company.com', '']);

    expect(deps.putDomains).toHaveBeenCalledWith({ domains: ['company.com', 'partner.io'] });
    expect(result.domainsStatus.value).toBe('saved');
  });

  test('a successful SMTP test send is confirmed and the settings are reloaded so the verified state appears', async () => {
    const verified: InstanceSettingsResponse = { ...settings, smtpVerifiedAt: '2026-09-14T10:00:00.000Z' };
    const fetchSettings = vi.fn<() => Promise<InstanceSettingsResponse>>().mockResolvedValueOnce(settings).mockResolvedValueOnce(verified);
    const { deps, result } = build({ fetchSettings });
    await result.load();

    await result.sendSmtpTest('ops@example.com');

    expect(deps.postSmtpTest).toHaveBeenCalledWith({ to: 'ops@example.com' });
    expect(result.smtpStatus.value).toBe('sent');
    expect(result.settings.value?.smtpVerifiedAt).toBe('2026-09-14T10:00:00.000Z');
  });

  test('a failed SMTP test send is its own state and is not mistaken for a network error', async () => {
    const { result } = build({
      postSmtpTest: vi.fn(async () => {
        throw responseError(502, { error: 'SMTP test send failed' });
      }),
    });
    await result.load();

    await result.sendSmtpTest('ops@example.com');

    expect(result.smtpStatus.value).toBe('failed');
    expect(result.smtpMessage.value).toMatch(/could not be sent|failed/i);
  });

  test('a malformed test address is refused before any request is made', async () => {
    const { deps, result } = build();
    await result.load();

    await result.sendSmtpTest('not-an-address');

    expect(result.smtpStatus.value).toBe('invalid');
    expect(deps.postSmtpTest).not.toHaveBeenCalled();
  });
});
