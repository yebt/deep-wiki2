/**
 * The instance's registration policy, for the Super Root screen at
 * `/admin/registration`: `GET /admin/instance-settings`, `PUT
 * /admin/registration-mode`, `PUT /admin/registration-domains` and `POST
 * /admin/smtp-test` (registration-policy spec).
 *
 * **Every change is followed by a reload.** The mode the screen shows is
 * always what the server holds, never what was last submitted — because
 * the server can refuse (`open` without a verified SMTP send) and can
 * revert on its own (a changed SMTP configuration puts `open` back to
 * `invitation_only`). A screen that trusted its own last write would show
 * a switch as on while the instance had turned it off.
 *
 * **A 403 is a plain state here.** Unlike a workspace, the existence of
 * the instance settings is no secret; telling a non-operator "this is
 * the operator's" discloses nothing they did not already know.
 */
import {
  ErrorResponseSchema,
  type InstanceSettingsResponse,
  type RegistrationDomainsRequest,
  type RegistrationDomainsResponse,
  type RegistrationModeRequest,
  type RegistrationModeResponse,
  type RegistrationModeValue,
  type SmtpTestRequest,
  type SmtpTestResponse,
} from '@deep-wiki/contracts';
import { z } from 'zod';

export type InstanceSettingsStatus = 'idle' | 'loading' | 'success' | 'forbidden' | 'unauthenticated' | 'network-error';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'refused' | 'network-error';
export type SmtpTestStatus = 'idle' | 'sending' | 'sent' | 'failed' | 'invalid' | 'network-error';

export interface UseInstanceSettingsDeps {
  readonly fetchSettings?: () => Promise<InstanceSettingsResponse>;
  readonly putMode?: (input: RegistrationModeRequest) => Promise<RegistrationModeResponse>;
  readonly putDomains?: (input: RegistrationDomainsRequest) => Promise<RegistrationDomainsResponse>;
  readonly postSmtpTest?: (input: SmtpTestRequest) => Promise<SmtpTestResponse>;
}

export interface UseInstanceSettingsResult {
  readonly status: Ref<InstanceSettingsStatus>;
  readonly message: Ref<string>;
  readonly settings: Ref<InstanceSettingsResponse | null>;
  readonly modeStatus: Ref<SaveStatus>;
  readonly modeMessage: Ref<string>;
  readonly domainsStatus: Ref<SaveStatus>;
  readonly domainsMessage: Ref<string>;
  readonly smtpStatus: Ref<SmtpTestStatus>;
  readonly smtpMessage: Ref<string>;
  readonly load: () => Promise<void>;
  readonly saveMode: (mode: RegistrationModeValue) => Promise<void>;
  readonly saveDomains: (domains: readonly string[]) => Promise<void>;
  readonly sendSmtpTest: (to: string) => Promise<void>;
}

const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.';
const TestAddressSchema = z.string().trim().email();

/** The server's own sentence when it refuses, or `undefined` when there is none to quote. */
function refusalReason(error: unknown): string | undefined {
  const parsed = ErrorResponseSchema.safeParse(responseBodyOf(error));
  return parsed.success ? parsed.data.error : undefined;
}

export function useInstanceSettings(deps: UseInstanceSettingsDeps = {}): UseInstanceSettingsResult {
  const config = useRuntimeConfig();
  const base = `${config.public.apiBaseUrl}/admin`;
  const fetchSettings = deps.fetchSettings ?? (() => $fetch<InstanceSettingsResponse>(`${base}/instance-settings`, { credentials: 'include' }));
  const putMode =
    deps.putMode ??
    ((input: RegistrationModeRequest) =>
      $fetch<RegistrationModeResponse>(`${base}/registration-mode`, { method: 'PUT', body: input, credentials: 'include' }));
  const putDomains =
    deps.putDomains ??
    ((input: RegistrationDomainsRequest) =>
      $fetch<RegistrationDomainsResponse>(`${base}/registration-domains`, { method: 'PUT', body: input, credentials: 'include' }));
  const postSmtpTest =
    deps.postSmtpTest ??
    ((input: SmtpTestRequest) => $fetch<SmtpTestResponse>(`${base}/smtp-test`, { method: 'POST', body: input, credentials: 'include' }));

  const status = ref<InstanceSettingsStatus>('idle');
  const message = ref('');
  const settings = ref<InstanceSettingsResponse | null>(null);
  const modeStatus = ref<SaveStatus>('idle');
  const modeMessage = ref('');
  const domainsStatus = ref<SaveStatus>('idle');
  const domainsMessage = ref('');
  const smtpStatus = ref<SmtpTestStatus>('idle');
  const smtpMessage = ref('');

  async function load(): Promise<void> {
    status.value = 'loading';
    try {
      settings.value = await fetchSettings();
      status.value = 'success';
      message.value = '';
    } catch (error) {
      settings.value = null;
      const code = httpStatusOf(error);
      if (code === 401) {
        status.value = 'unauthenticated';
        message.value = 'Your session has ended.';
        return;
      }
      if (code === 403) {
        status.value = 'forbidden';
        message.value = 'Only the instance operator can change registration.';
        return;
      }
      status.value = 'network-error';
      message.value = NETWORK_MESSAGE;
    }
  }

  async function saveMode(mode: RegistrationModeValue): Promise<void> {
    modeStatus.value = 'saving';
    modeMessage.value = '';
    try {
      await putMode({ mode });
      modeStatus.value = 'saved';
      modeMessage.value = `Registration is now ${describeMode(mode)}.`;
      await load();
    } catch (error) {
      const reason = refusalReason(error);
      if (reason) {
        modeStatus.value = 'refused';
        modeMessage.value = `Not changed: ${reason}.`;
        return;
      }
      modeStatus.value = 'network-error';
      modeMessage.value = NETWORK_MESSAGE;
    }
  }

  async function saveDomains(domains: readonly string[]): Promise<void> {
    const normalised = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter((d) => d.length > 0))];
    domainsStatus.value = 'saving';
    domainsMessage.value = '';
    try {
      await putDomains({ domains: normalised });
      domainsStatus.value = 'saved';
      domainsMessage.value =
        normalised.length === 0 ? 'Allowlist cleared: any domain may register while registration is open.' : `Allowlist saved: ${normalised.join(', ')}.`;
      await load();
    } catch (error) {
      const reason = refusalReason(error);
      if (reason) {
        domainsStatus.value = 'refused';
        domainsMessage.value = `Not saved: ${reason}.`;
        return;
      }
      domainsStatus.value = 'network-error';
      domainsMessage.value = NETWORK_MESSAGE;
    }
  }

  async function sendSmtpTest(to: string): Promise<void> {
    const address = TestAddressSchema.safeParse(to);
    if (!address.success) {
      smtpStatus.value = 'invalid';
      smtpMessage.value = 'Enter the address the test message should go to.';
      return;
    }
    smtpStatus.value = 'sending';
    smtpMessage.value = '';
    try {
      await postSmtpTest({ to: address.data });
      smtpStatus.value = 'sent';
      smtpMessage.value = `Test message sent to ${address.data}. SMTP is verified; open registration can now be chosen.`;
      await load();
    } catch (error) {
      if (httpStatusOf(error) === 502) {
        smtpStatus.value = 'failed';
        smtpMessage.value = 'The test message could not be sent. Check the SMTP settings in the server environment, restart the API, and try again.';
        return;
      }
      smtpStatus.value = 'network-error';
      smtpMessage.value = NETWORK_MESSAGE;
    }
  }

  return { status, message, settings, modeStatus, modeMessage, domainsStatus, domainsMessage, smtpStatus, smtpMessage, load, saveMode, saveDomains, sendSmtpTest };
}

export function describeMode(mode: RegistrationModeValue): string {
  switch (mode) {
    case 'closed':
      return 'closed — nobody can create an account';
    case 'invitation_only':
      return 'by invitation only';
    case 'open':
      return 'open — anyone may create an account';
  }
}
