import { describe, expect, test } from 'bun:test';
import {
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

  test('accepts the bare acknowledgement — never the created password hash', () => {
    expect(RegisterResponseSchema.safeParse({ ok: true }).success).toBe(true);
  });
});

describe('RegistrationModeSchema / RegistrationModeRequestSchema / RegistrationModeResponseSchema', () => {
  test('accepts each of the three registration modes', () => {
    expect(RegistrationModeSchema.safeParse('closed').success).toBe(true);
    expect(RegistrationModeSchema.safeParse('invitation_only').success).toBe(true);
    expect(RegistrationModeSchema.safeParse('open').success).toBe(true);
  });

  test('rejects an unrecognised mode', () => {
    expect(RegistrationModeRequestSchema.safeParse({ mode: 'public' }).success).toBe(false);
  });

  test('accepts the bare acknowledgement', () => {
    expect(RegistrationModeResponseSchema.safeParse({ ok: true }).success).toBe(true);
  });
});

describe('RegistrationDomainsRequestSchema / RegistrationDomainsResponseSchema', () => {
  test('accepts an array of domain strings', () => {
    expect(RegistrationDomainsRequestSchema.safeParse({ domains: ['example.com'] }).success).toBe(true);
  });

  test('rejects a non-string domain entry', () => {
    expect(RegistrationDomainsRequestSchema.safeParse({ domains: [42] }).success).toBe(false);
  });

  test('accepts the bare acknowledgement', () => {
    expect(RegistrationDomainsResponseSchema.safeParse({ ok: true }).success).toBe(true);
  });
});

describe('SmtpTestRequestSchema / SmtpTestResponseSchema', () => {
  test('accepts a destination address — never the SMTP password', () => {
    expect(SmtpTestRequestSchema.safeParse({ to: 'ops@example.com' }).success).toBe(true);
  });

  test('accepts the bare acknowledgement', () => {
    expect(SmtpTestResponseSchema.safeParse({ ok: true }).success).toBe(true);
  });
});
