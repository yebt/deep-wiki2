import { describe, expect, test } from 'bun:test';
import {
  InstanceSettingsResponseSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
  RegistrationDomainsRequestSchema,
  RegistrationDomainsResponseSchema,
  RegistrationModeRequestSchema,
  RegistrationModeResponseSchema,
  RegistrationModeSchema,
  SmtpTestRequestSchema,
  SmtpTestResponseSchema,
} from './admin';

describe('RegisterRequestSchema / RegisterResponseSchema', () => {
  test('accepts an email and a password', () => {
    expect(RegisterRequestSchema.safeParse({ email: 'a@example.com', password: 'x' }).success).toBe(true);
  });

  test('accepts the bare acknowledgement', () => {
    expect(RegisterResponseSchema.safeParse({ ok: true }).success).toBe(true);
  });

  // The old test was called "never the created password hash" and asserted
  // only `success === true` — which the schema also returns for input that
  // carries one. The guarantee is the strip, so the strip is what is
  // asserted (as workspaces.test.ts already does).
  test('strips a password hash a widened handler might add', () => {
    const parsed = RegisterResponseSchema.parse({ ok: true, passwordHash: '$argon2id$v=19$m=65536' });

    expect(parsed).toEqual({ ok: true });
  });
});

describe('RegistrationModeSchema / RegistrationModeRequestSchema / RegistrationModeResponseSchema', () => {
  test('accepts each of the three registration modes', () => {
    expect(RegistrationModeSchema.safeParse('closed').success).toBe(true);
    expect(RegistrationModeSchema.safeParse('invitation_only').success).toBe(true);
    expect(RegistrationModeSchema.safeParse('open').success).toBe(true);
  });

  test('rejects an unrecognised mode, naming the mode field as the cause', () => {
    const result = RegistrationModeRequestSchema.safeParse({ mode: 'public' });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.path)).toEqual([['mode']]);
    expect(result.error.issues[0]?.code).toBe('invalid_enum_value');
  });

  test('accepts the bare acknowledgement', () => {
    expect(RegistrationModeResponseSchema.safeParse({ ok: true }).success).toBe(true);
  });
});

describe('RegistrationDomainsRequestSchema / RegistrationDomainsResponseSchema', () => {
  test('accepts an array of domain strings', () => {
    expect(RegistrationDomainsRequestSchema.safeParse({ domains: ['example.com'] }).success).toBe(true);
  });

  test('rejects a non-string domain entry, naming which entry', () => {
    const result = RegistrationDomainsRequestSchema.safeParse({ domains: ['example.com', 42] });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.path)).toEqual([['domains', 1]]);
  });

  test('accepts the bare acknowledgement', () => {
    expect(RegistrationDomainsResponseSchema.safeParse({ ok: true }).success).toBe(true);
  });
});

describe('SmtpTestRequestSchema / SmtpTestResponseSchema', () => {
  test('accepts a destination address', () => {
    expect(SmtpTestRequestSchema.safeParse({ to: 'ops@example.com' }).success).toBe(true);
  });

  // Same correction as RegisterResponseSchema above: the old test claimed
  // "never the SMTP password" while asserting only that a body without one
  // parses. A caller cannot smuggle credentials through this request,
  // because anything undeclared is dropped.
  test('strips SMTP credentials a caller tries to send with the test mail', () => {
    const parsed = SmtpTestRequestSchema.parse({
      to: 'ops@example.com',
      password: 'hunter2',
      host: 'evil.example.com',
    });

    expect(parsed).toEqual({ to: 'ops@example.com' });
  });

  test('accepts the bare acknowledgement', () => {
    expect(SmtpTestResponseSchema.safeParse({ ok: true }).success).toBe(true);
  });
});

describe('InstanceSettingsResponseSchema', () => {
  test('parses the four fields the registration screen renders', () => {
    const parsed = InstanceSettingsResponseSchema.parse({
      registrationMode: 'invitation_only',
      openRegistrationDomains: ['company.com'],
      smtpVerifiedAt: null,
      smtpVerificationReverted: true,
    });

    expect(parsed).toEqual({
      registrationMode: 'invitation_only',
      openRegistrationDomains: ['company.com'],
      smtpVerifiedAt: null,
      smtpVerificationReverted: true,
    });
  });

  test('strips the SMTP configuration hash a widened handler might add', () => {
    const parsed = InstanceSettingsResponseSchema.parse({
      registrationMode: 'open',
      openRegistrationDomains: [],
      smtpVerifiedAt: '2026-09-14T00:00:00.000Z',
      smtpVerificationReverted: false,
      smtpConfigHash: 'deadbeef',
    });

    expect(Object.keys(parsed)).not.toContain('smtpConfigHash');
  });
});
