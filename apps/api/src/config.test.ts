import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { assertKeyringComplete, loadConfig } from './config';

// A 32-byte key, base64-encoded (Buffer.alloc(32, 7).toString('base64')).
const TEST_KEK = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';

function validRawEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'test',
    PORT: '4000',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/deep_wiki',
    SMTP_HOST: 'localhost',
    MAIL_FROM: 'noreply@deep-wiki.local',
    BLOB_STORE_FS_ROOT: './.data/blobs',
    AI_KEK_KEYRING: `k1:${TEST_KEK}`,
    AI_KEK_ACTIVE_ID: 'k1',
    ...overrides,
  };
}

describe('loadConfig', () => {
  test('loads successfully from a valid environment', () => {
    const config = loadConfig(validRawEnv());

    expect(config.PORT).toBe(4000);
    expect(config.DATABASE_URL).toBe('postgres://user:pass@localhost:5432/deep_wiki');
  });

  test('fails fast and names the missing variable', () => {
    expect(() => loadConfig(validRawEnv({ DATABASE_URL: undefined }))).toThrow(/DATABASE_URL/);
  });

  test('fails fast and names the malformed variable', () => {
    expect(() => loadConfig(validRawEnv({ PORT: 'not-a-number' }))).toThrow(/PORT/);
  });

  test('fails fast and names a missing SMTP host', () => {
    expect(() => loadConfig(validRawEnv({ SMTP_HOST: undefined }))).toThrow(/SMTP_HOST/);
  });
});

// Boot-time keyring completeness (design.md — "Credentials: envelope
// encryption a self-hoster can operate" — "Keyring completeness";
// environment-config delta — "Envelope Master Key Validated at
// Startup"). `refineEnv()` already guarantees the *configured* keyring
// itself parses; this guards the case that config alone cannot see — a
// stored credential referencing a key id that was since retired from
// `AI_KEK_KEYRING`. Discovering that mid-request, per tenant, is exactly
// the failure design.md names as the worst possible moment to learn it.
describe('assertKeyringComplete', () => {
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

  async function seedCredentialWithKeyId(keyId: string): Promise<void> {
    const [owner] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name)
      VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
    `;
    const [ws] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
    `;
    await sql`
      INSERT INTO workspace_ai_credentials
        (id, workspace_id, provider, ciphertext, iv, auth_tag, wrapped_dek, key_id, last_four)
      VALUES
        (${crypto.randomUUID()}, ${ws!.id}, 'anthropic', ${Buffer.from('c')}, ${Buffer.from('i')}, ${Buffer.from('a')},
         ${Buffer.from('w')}, ${keyId}, '1234')
    `;
  }

  // Runs before any row is seeded — the freshly provisioned database has
  // no `workspace_ai_credentials` rows yet.
  test('boots cleanly with no credential rows at all', async () => {
    await expect(assertKeyringComplete(sql, loadConfig(validRawEnv()))).resolves.toBeUndefined();
  });

  test('boots cleanly when every stored key_id is present in the keyring', async () => {
    await seedCredentialWithKeyId('k1');

    await expect(assertKeyringComplete(sql, loadConfig(validRawEnv()))).resolves.toBeUndefined();
  });

  test('aborts naming the missing key id when a stored row references one absent from the keyring', async () => {
    await seedCredentialWithKeyId('k-retired');

    await expect(assertKeyringComplete(sql, loadConfig(validRawEnv()))).rejects.toThrow(/k-retired/);
  });
});
