/**
 * Credential save/read routes (workspace-ai-credentials spec). The
 * `AesGcmCredentialCipher` and `EnvKeyProvider` from Phase 7 are used
 * directly — no fake — because the point of this suite is exactly that
 * the plaintext key never survives into the response, not that sealing
 * happened at all.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSession } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import type { CredentialCipher, ProviderId } from '@deep-wiki/core';
import postgres from 'postgres';
import { AesGcmCredentialCipher } from '../adapters/ai/cipher/aes-gcm-cipher';
import { EnvKeyProvider } from '../adapters/ai/key-provider/env-key-provider';
import type { CredentialValidationProbe, ProbeResult } from '../adapters/ai/credentials/validation-probe';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createAiCredentialRoutes } from './ai-credentials';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;
let cipher: CredentialCipher;

const TEST_KEY_ID = 'k1';
const TEST_KEK = Buffer.alloc(32, 7);

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 5 });
  cipher = new AesGcmCredentialCipher(new EnvKeyProvider(new Map([[TEST_KEY_ID, TEST_KEK]]), TEST_KEY_ID));
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

class FakeProbe implements CredentialValidationProbe {
  constructor(private readonly result: ProbeResult) {}
  readonly calls: { provider: ProviderId; apiKey: string }[] = [];
  async probe(provider: ProviderId, apiKey: { reveal(): string }): Promise<ProbeResult> {
    this.calls.push({ provider, apiKey: apiKey.reveal() });
    return this.result;
  }
}

interface Fixture {
  readonly workspaceId: string;
  readonly rootId: string;
  readonly adminCookie: string;
}

async function seedFixture(): Promise<Fixture> {
  const [owner] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const [admin] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`admin-${crypto.randomUUID()}@example.com`}, 'hash', 'Admin') RETURNING id
  `;
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${ws!.id}, 'user', ${admin!.id}, ${root!.id}, 'manage', 'allow')
  `;
  const { token } = await createSession(sql, { userId: admin!.id, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });

  return { workspaceId: ws!.id, rootId: root!.id, adminCookie: `${SESSION_COOKIE_NAME}=${token}` };
}

function buildApp(validationProbe: CredentialValidationProbe) {
  return createAiCredentialRoutes({ sql, cipher, validationProbe, sessionIdleTimeoutMinutes: 30 });
}

async function expectNoCredential(res: Response, secret: string): Promise<void> {
  const raw = await res.clone().text();
  expect(raw.includes(secret)).toBe(false);
}

describe('POST /workspaces/:workspaceId/ai-credentials', () => {
  test('a syntactically valid, provider-accepted key is persisted', async () => {
    const fixture = await seedFixture();
    const app = buildApp(new FakeProbe({ ok: true }));
    const apiKey = `sk-live-${crypto.randomUUID()}`;

    const res = await app.request(`/workspaces/${fixture.workspaceId}/ai-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.adminCookie },
      body: JSON.stringify({ provider: 'anthropic', apiKey }),
    });

    expect(res.status).toBe(201);
    await expectNoCredential(res, apiKey);
    const body = (await res.json()) as { ok: true; lastFour: string };
    expect(body.lastFour).toBe(apiKey.slice(-4));

    const [row] = await sql<{ ciphertext: Buffer }[]>`
      SELECT ciphertext FROM workspace_ai_credentials WHERE workspace_id = ${fixture.workspaceId} AND provider = 'anthropic'
    `;
    expect(row).toBeDefined();
    expect(row!.ciphertext.toString('utf8').includes(apiKey)).toBe(false);
  });

  test('a provider-rejected key returns a validation error and persists no row', async () => {
    const fixture = await seedFixture();
    const app = buildApp(new FakeProbe({ ok: false, errorCode: 'invalid_key' }));
    const apiKey = `sk-bad-${crypto.randomUUID()}`;

    const res = await app.request(`/workspaces/${fixture.workspaceId}/ai-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.adminCookie },
      body: JSON.stringify({ provider: 'anthropic', apiKey }),
    });

    expect(res.status).toBe(422);
    await expectNoCredential(res, apiKey);

    const rows = await sql`SELECT id FROM workspace_ai_credentials WHERE workspace_id = ${fixture.workspaceId} AND provider = 'anthropic'`;
    expect(rows).toHaveLength(0);
  });

  test("can() denies the write for a user with no manage grant, before any encryption", async () => {
    const fixture = await seedFixture();
    const [nobody] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name)
      VALUES (${`nobody-${crypto.randomUUID()}@example.com`}, 'hash', 'Nobody') RETURNING id
    `;
    const { token } = await createSession(sql, { userId: nobody!.id, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
    const probe = new FakeProbe({ ok: true });
    const app = buildApp(probe);

    const res = await app.request(`/workspaces/${fixture.workspaceId}/ai-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE_NAME}=${token}` },
      body: JSON.stringify({ provider: 'anthropic', apiKey: 'sk-anything' }),
    });

    expect(res.status).toBe(403);
    expect(probe.calls).toHaveLength(0);
  });

  test('a request-supplied workspace_id is ignored in favor of the authenticated subject\'s workspace', async () => {
    const fixtureA = await seedFixture();
    const fixtureB = await seedFixture();
    const app = buildApp(new FakeProbe({ ok: true }));
    const apiKey = `sk-live-${crypto.randomUUID()}`;

    const res = await app.request(`/workspaces/${fixtureA.workspaceId}/ai-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixtureA.adminCookie },
      body: JSON.stringify({ provider: 'anthropic', apiKey, workspaceId: fixtureB.workspaceId }),
    });

    expect(res.status).toBe(201);
    const rowsA = await sql`SELECT id FROM workspace_ai_credentials WHERE workspace_id = ${fixtureA.workspaceId} AND provider = 'anthropic'`;
    const rowsB = await sql`SELECT id FROM workspace_ai_credentials WHERE workspace_id = ${fixtureB.workspaceId} AND provider = 'anthropic'`;
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(0);
  });
});

describe('GET /workspaces/:workspaceId/ai-credentials', () => {
  test('fetching a workspace\'s AI settings never returns plaintext or ciphertext', async () => {
    const fixture = await seedFixture();
    const app = buildApp(new FakeProbe({ ok: true }));
    const apiKey = `sk-live-${crypto.randomUUID()}`;

    await app.request(`/workspaces/${fixture.workspaceId}/ai-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.adminCookie },
      body: JSON.stringify({ provider: 'anthropic', apiKey }),
    });

    const res = await app.request(`/workspaces/${fixture.workspaceId}/ai-credentials`, {
      headers: { cookie: fixture.adminCookie },
    });

    expect(res.status).toBe(200);
    await expectNoCredential(res, apiKey);
    const body = (await res.json()) as { credentials: { provider: string; lastFour: string; validatedAt: string | null }[] };
    expect(body.credentials).toHaveLength(1);
    expect(body.credentials[0]!.provider).toBe('anthropic');
    expect(body.credentials[0]!.lastFour).toBe(apiKey.slice(-4));
    expect(body.credentials[0]!.validatedAt).not.toBeNull();
    expect(Object.keys(body.credentials[0]!)).toEqual(['provider', 'lastFour', 'validatedAt']);
  });
});
