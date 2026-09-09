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

  test('rejects a non-string password, and the password is what it names', () => {
    const result = LoginRequestSchema.safeParse({ email: 'a@example.com', password: 123 });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.path)).toEqual([['password']]);
  });
});

describe('LoginResponseSchema', () => {
  test('accepts the bare acknowledgement — the session token never appears here', () => {
    expect(LoginResponseSchema.safeParse({ ok: true }).success).toBe(true);
  });

  // Renamed 2026-09-09: this was called "rejects a body carrying a session
  // token field", which it never did — the fixture carries no token, and
  // `z.object` strips an undeclared field rather than rejecting it. What it
  // actually pins is the literal, so that is what it now says; the strip is
  // asserted directly below.
  test('rejects an ok that is not the bare literal true', () => {
    const result = LoginResponseSchema.safeParse({ ok: false });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.path)).toEqual([['ok']]);
  });

  test('strips a session token a widened handler might add — it travels only in Set-Cookie', () => {
    const parsed = LoginResponseSchema.parse({ ok: true, token: 'a-real-session-token' });

    expect(parsed).toEqual({ ok: true });
  });
});

describe('PasswordResetRequestSchema / PasswordResetResponseSchema', () => {
  test('accepts an email', () => {
    expect(PasswordResetRequestSchema.safeParse({ email: 'a@example.com' }).success).toBe(true);
  });

  // Replaced 2026-09-09: this parsed the identical literal twice and
  // compared the two successes, which is `expect(x).toEqual(x)`. Whether
  // the *handler* answers identically for a known and an unknown address is
  // a route-level guarantee, tested in apps/api. What this schema
  // contributes is that a field distinguishing the two cannot survive the
  // parse, and that is now what is asserted.
  test('strips a field that would disclose account existence — the shape cannot vary', () => {
    const parsed = PasswordResetResponseSchema.parse({
      ok: true,
      message: 'If that address has an account, a reset link is on its way.',
      accountExists: true,
    });

    expect(parsed).toEqual({
      ok: true,
      message: 'If that address has an account, a reset link is on its way.',
    });
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
