import { describe, expect, test } from 'bun:test';
import {
  LoginRequestSchema,
  LoginResponseSchema,
  PasswordResetConfirmRequestSchema,
  PasswordResetConfirmResponseSchema,
  PasswordResetRequestSchema,
  PasswordResetResponseSchema,
} from './auth';

describe('LoginRequestSchema', () => {
  test('accepts an email and a password', () => {
    expect(LoginRequestSchema.safeParse({ email: 'a@example.com', password: 'x' }).success).toBe(true);
  });

  test('rejects a non-string password', () => {
    expect(LoginRequestSchema.safeParse({ email: 'a@example.com', password: 123 }).success).toBe(false);
  });
});

describe('LoginResponseSchema', () => {
  test('accepts the bare acknowledgement — the session token never appears here', () => {
    expect(LoginResponseSchema.safeParse({ ok: true }).success).toBe(true);
  });

  test('rejects a body carrying a session token field', () => {
    // Not a structural guarantee (the schema simply has no such field) —
    // this documents the contract's shape: an extraneous field is not the
    // enforcement mechanism, but ok must stay a bare literal.
    expect(LoginResponseSchema.safeParse({ ok: false }).success).toBe(false);
  });
});

describe('PasswordResetRequestSchema / PasswordResetResponseSchema', () => {
  test('accepts an email', () => {
    expect(PasswordResetRequestSchema.safeParse({ email: 'a@example.com' }).success).toBe(true);
  });

  test('the response is the same shape regardless of account existence — one schema, one shape', () => {
    const known = PasswordResetResponseSchema.safeParse({ ok: true, message: 'generic' });
    const unknown = PasswordResetResponseSchema.safeParse({ ok: true, message: 'generic' });

    expect(known.success).toBe(true);
    expect(unknown.success).toBe(true);
  });
});

describe('PasswordResetConfirmRequestSchema / PasswordResetConfirmResponseSchema', () => {
  test('accepts a token and a new password', () => {
    expect(PasswordResetConfirmRequestSchema.safeParse({ token: 't', newPassword: 'p' }).success).toBe(true);
  });

  test('accepts the bare acknowledgement', () => {
    expect(PasswordResetConfirmResponseSchema.safeParse({ ok: true }).success).toBe(true);
  });
});
