/**
 * `Secret<T>` (design.md — "Credentials that must never be logged,
 * serialised or rendered", enforcement layer 1). Framework-free wrapper
 * whose `toString()`/`toJSON()` return a fixed redaction marker, so an
 * accidental `JSON.stringify`, template interpolation, or `console.log`
 * is inert by construction rather than by discipline.
 */
import { describe, expect, test } from 'bun:test';
import { Secret } from './secret';

describe('Secret<T>', () => {
  test('toString() never returns the wrapped value', () => {
    const secret = new Secret('super-secret-password');

    expect(secret.toString()).toBe('[redacted]');
    expect(secret.toString()).not.toContain('super-secret-password');
  });

  test('toJSON() never returns the wrapped value, so JSON.stringify cannot leak it', () => {
    const secret = new Secret('another-secret-token');
    const serialised = JSON.stringify({ token: secret });

    expect(serialised).toBe('{"token":"[redacted]"}');
    expect(serialised).not.toContain('another-secret-token');
  });

  test('template interpolation never leaks the wrapped value', () => {
    const secret = new Secret('interpolated-secret');
    const message = `password hash: ${secret}`;

    expect(message).toBe('password hash: [redacted]');
    expect(message).not.toContain('interpolated-secret');
  });

  test('reveal() returns the original wrapped value for the one call site that legitimately needs it', () => {
    const secret = new Secret('smtp-password-value');

    expect(secret.reveal()).toBe('smtp-password-value');
  });

  test('two different wrapped values produce the identical redacted representation', () => {
    const a = new Secret('value-one');
    const b = new Secret('value-two');

    expect(a.toString()).toBe(b.toString());
  });
});
