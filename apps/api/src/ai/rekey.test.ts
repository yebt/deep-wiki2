/**
 * `rekeyAll` — key rotation as a re-wrap job (design.md — "Credentials:
 * envelope encryption a self-hoster can operate" — "Rotation"). Unwraps
 * each row's DEK under its own `key_id`, rewraps under the target, and
 * persists only `wrapped_dek`/`key_id` — `ciphertext`, `iv` and
 * `auth_tag` never change, because they depend only on the DEK's
 * plaintext bytes (`rewrapDek`, Phase 7.5/7.6). `--compromised` treats
 * every row this job actually moves off its current key as having been
 * wrapped under a now-compromised KEK: it stamps `compromised_at` and
 * clears `validated_at` so the product asks for re-entry rather than
 * quietly continuing to serve a workspace with a key that must be
 * revoked at the provider.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Secret, type CredentialCipher } from '@deep-wiki/core';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { AesGcmCredentialCipher } from '../adapters/ai/cipher/aes-gcm-cipher';
import { EnvKeyProvider } from '../adapters/ai/key-provider/env-key-provider';
import { rekeyAll } from './rekey';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;
let cipher: CredentialCipher;

const keys = new Map([
  ['k1', randomBytes(32)],
  ['k2', randomBytes(32)],
]);
const keyProvider = new EnvKeyProvider(keys, 'k1');

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 5 });
  cipher = new AesGcmCredentialCipher(keyProvider);
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

async function seedCredential(provider: string, plaintext: string): Promise<{ workspaceId: string; id: string }> {
  const [owner] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
  `;
  const id = crypto.randomUUID();
  const sealed = await cipher.seal(new Secret(plaintext), { workspaceId: ws!.id, credentialId: id, provider });
  if (!sealed.ok) throw new Error('seal failed in test setup');

  await sql`
    INSERT INTO workspace_ai_credentials
      (id, workspace_id, provider, ciphertext, iv, auth_tag, wrapped_dek, key_id, last_four, validated_at)
    VALUES
      (${id}, ${ws!.id}, ${provider}, ${Buffer.from(sealed.value.ciphertext)}, ${Buffer.from(sealed.value.iv)},
       ${Buffer.from(sealed.value.authTag)}, ${Buffer.from(sealed.value.wrappedDek)}, ${sealed.value.keyId}, '1234', now())
  `;

  return { workspaceId: ws!.id, id };
}

describe('rekeyAll', () => {
  test('rewraps a row not at the target, leaves ciphertext byte-identical, and the credential still opens', async () => {
    const { workspaceId, id } = await seedCredential('anthropic', 'sk-ant-original');
    const [before] = await sql<{ ciphertext: Buffer; iv: Buffer; auth_tag: Buffer }[]>`
      SELECT ciphertext, iv, auth_tag FROM workspace_ai_credentials WHERE id = ${id}
    `;

    const result = await rekeyAll({ sql, keyProvider }, { toKeyId: 'k2' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.find((r) => r.id === id)).toEqual({ id, skipped: false });

    const [after] = await sql<{ ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; wrapped_dek: Buffer; key_id: string }[]>`
      SELECT ciphertext, iv, auth_tag, wrapped_dek, key_id FROM workspace_ai_credentials WHERE id = ${id}
    `;
    expect(after!.key_id).toBe('k2');
    expect(after!.ciphertext).toEqual(before!.ciphertext);
    expect(after!.iv).toEqual(before!.iv);
    expect(after!.auth_tag).toEqual(before!.auth_tag);

    const opened = await cipher.open(
      {
        ciphertext: new Uint8Array(after!.ciphertext),
        iv: new Uint8Array(after!.iv),
        authTag: new Uint8Array(after!.auth_tag),
        wrappedDek: new Uint8Array(after!.wrapped_dek),
        keyId: after!.key_id,
      },
      { workspaceId, credentialId: id, provider: 'anthropic' },
    );
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.value.reveal()).toBe('sk-ant-original');
  });

  test('a row already at the target is skipped — idempotent, wrapped_dek untouched', async () => {
    const { id } = await seedCredential('openai', 'sk-oai-already-there');
    await sql`UPDATE workspace_ai_credentials SET key_id = 'k2' WHERE id = ${id}`;
    const [before] = await sql<{ wrapped_dek: Buffer }[]>`SELECT wrapped_dek FROM workspace_ai_credentials WHERE id = ${id}`;

    const result = await rekeyAll({ sql, keyProvider }, { toKeyId: 'k2' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.find((r) => r.id === id)).toEqual({ id, skipped: true });

    const [after] = await sql<{ wrapped_dek: Buffer }[]>`SELECT wrapped_dek FROM workspace_ai_credentials WHERE id = ${id}`;
    expect(after!.wrapped_dek).toEqual(before!.wrapped_dek);
  });

  test('--compromised stamps compromised_at and clears validated_at only on rows it actually rewraps', async () => {
    const { id: movedId } = await seedCredential('google', 'sk-goog-compromised');
    const { id: alreadyThereId } = await seedCredential('deepseek', 'sk-ds-unaffected');
    await sql`UPDATE workspace_ai_credentials SET key_id = 'k2' WHERE id = ${alreadyThereId}`;

    const result = await rekeyAll({ sql, keyProvider }, { toKeyId: 'k2', compromised: true });

    expect(result.ok).toBe(true);

    const [moved] = await sql<{ compromised_at: Date | null; validated_at: Date | null }[]>`
      SELECT compromised_at, validated_at FROM workspace_ai_credentials WHERE id = ${movedId}
    `;
    expect(moved!.compromised_at).not.toBeNull();
    expect(moved!.validated_at).toBeNull();

    const [skipped] = await sql<{ compromised_at: Date | null; validated_at: Date | null }[]>`
      SELECT compromised_at, validated_at FROM workspace_ai_credentials WHERE id = ${alreadyThereId}
    `;
    expect(skipped!.compromised_at).toBeNull();
    expect(skipped!.validated_at).not.toBeNull();
  });

  test('rewrapping to a key id absent from the keyring fails per row, without touching that row', async () => {
    const { id } = await seedCredential('openrouter', 'sk-or-untouched');
    const [before] = await sql<{ key_id: string; wrapped_dek: Buffer }[]>`
      SELECT key_id, wrapped_dek FROM workspace_ai_credentials WHERE id = ${id}
    `;

    const result = await rekeyAll({ sql, keyProvider }, { toKeyId: 'k-missing' });

    expect(result.ok).toBe(false);

    const [after] = await sql<{ key_id: string; wrapped_dek: Buffer }[]>`
      SELECT key_id, wrapped_dek FROM workspace_ai_credentials WHERE id = ${id}
    `;
    expect(after!.key_id).toBe(before!.key_id);
    expect(after!.wrapped_dek).toEqual(before!.wrapped_dek);
  });
});
