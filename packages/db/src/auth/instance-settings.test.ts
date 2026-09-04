/**
 * Instance-wide registration policy (design.md — "Registration mode";
 * registration-policy spec).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import {
  getInstanceSettings,
  recordSmtpVerification,
  setOpenRegistrationDomains,
  setRegistrationMode,
} from './instance-settings';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 5 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

describe('getInstanceSettings', () => {
  test('a fresh instance reads registration_mode = invitation_only', async () => {
    const settings = await getInstanceSettings(sql, 'any-hash');

    expect(settings.registrationMode).toBe('invitation_only');
    expect(settings.smtpVerifiedAt).toBeNull();
  });
});

describe('setRegistrationMode', () => {
  test('refuses to switch to open without a recorded SMTP verification', async () => {
    const result = await setRegistrationMode(sql, 'open', 'config-hash-a');

    expect(result).toBe('smtp_not_verified');
    expect((await getInstanceSettings(sql, 'config-hash-a')).registrationMode).not.toBe('open');
  });

  test('switches to open after a matching SMTP verification is recorded', async () => {
    await recordSmtpVerification(sql, 'config-hash-b');

    const result = await setRegistrationMode(sql, 'open', 'config-hash-b');

    expect(result).toBe('ok');
    expect((await getInstanceSettings(sql, 'config-hash-b')).registrationMode).toBe('open');

    // Reset for later tests in this file.
    await setRegistrationMode(sql, 'invitation_only', 'config-hash-b');
  });

  test('closed mode can always be set', async () => {
    const result = await setRegistrationMode(sql, 'closed', 'irrelevant-hash');

    expect(result).toBe('ok');
    expect((await getInstanceSettings(sql, 'irrelevant-hash')).registrationMode).toBe('closed');

    await setRegistrationMode(sql, 'invitation_only', 'irrelevant-hash');
  });
});

describe('SMTP config-change reconciliation', () => {
  test('a changed SMTP configuration clears smtp_verified_at and reverts open mode to invitation_only', async () => {
    await recordSmtpVerification(sql, 'config-hash-c');
    await setRegistrationMode(sql, 'open', 'config-hash-c');
    expect((await getInstanceSettings(sql, 'config-hash-c')).registrationMode).toBe('open');

    const afterConfigChange = await getInstanceSettings(sql, 'a-completely-different-hash');

    expect(afterConfigChange.registrationMode).toBe('invitation_only');
    expect(afterConfigChange.smtpVerifiedAt).toBeNull();
    expect(afterConfigChange.reverted).toBe(true);
  });

  test('reading again with the same (now-stale) mismatched hash does not report a second revert', async () => {
    await getInstanceSettings(sql, 'a-completely-different-hash');
    const secondRead = await getInstanceSettings(sql, 'a-completely-different-hash');

    expect(secondRead.reverted).toBe(false);
  });
});

describe('setOpenRegistrationDomains', () => {
  test('stores the allowlist', async () => {
    await setOpenRegistrationDomains(sql, ['company.com', 'example.org']);

    const settings = await getInstanceSettings(sql, 'unused-hash');
    expect([...settings.openRegistrationDomains].sort()).toEqual(['company.com', 'example.org']);
  });
});
