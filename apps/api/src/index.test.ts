import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type {
  BlobStore,
  MailSender,
  PasswordHasher,
  PresenceBroadcaster,
  PresenceEvent,
  PresenceSubscriber,
  Result,
} from '@deep-wiki/core';
import { ok } from '@deep-wiki/core';
import { createSession } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { AesGcmCredentialCipher } from './adapters/ai/cipher/aes-gcm-cipher';
import { EnvKeyProvider } from './adapters/ai/key-provider/env-key-provider';
import type { MailDispatcher } from './adapters/mail/background-mail-dispatcher';
import generateFixture from './ai/gateway/providers/__fixtures__/anthropic-generate.json';
import { jsonFetch } from './ai/gateway/providers/test-support';
import { createVercelAiValidationProbe } from './ai/gateway/validation-probe';
import { SESSION_COOKIE_NAME } from './middleware/session';
import { PresenceStreamRegistry } from './presence/registry';
import { composeApp, createApp } from './index';
import { createDiffRoutes } from './routes/diff';
import { createPresenceRoutes } from './routes/presence';
import { createRevisionRoutes } from './routes/revisions';

const WEB_ORIGIN = 'http://localhost:4173';

describe('GET /health', () => {
  test('returns 200', async () => {
    const res = await createApp({ appUrl: WEB_ORIGIN }).request('/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  // Regression: /health was registered at module scope while the CORS
  // middleware was installed later, and Hono applies `use()` only to routes
  // registered after it. /health answered 200 with no Access-Control-Allow-Origin
  // and the browser refused to read it, while every other route worked.
  test('carries the CORS headers the browser needs, like every other route', async () => {
    const res = await createApp({ appUrl: WEB_ORIGIN }).request('/health', {
      headers: { Origin: WEB_ORIGIN },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WEB_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  test('an origin that is not the configured app is not allowed', async () => {
    const res = await createApp({ appUrl: WEB_ORIGIN }).request('/health', {
      headers: { Origin: 'http://evil.example' },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('http://evil.example');
  });

  // Found by e2e/comments.spec.ts on 2026-09-14: a browser's preflight for
  // `PATCH /comments/:id/resolved` was answered without PATCH in
  // Access-Control-Allow-Methods, so the browser never sent the request and
  // the panel reported a dead connection. Every PATCH the client makes —
  // the lock heartbeat, node rename and reorder, thread resolution — was
  // blocked the same way, while every server-side test passed, because
  // `app.request()` never preflights. This preflight is what a browser
  // actually sends.
  test('a preflight for PATCH is allowed, like the other methods the client uses', async () => {
    const res = await createApp({ appUrl: WEB_ORIGIN }).request('/comments/thread/resolved', {
      method: 'OPTIONS',
      headers: { Origin: WEB_ORIGIN, 'Access-Control-Request-Method': 'PATCH' },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')?.split(',').map((method) => method.trim())).toContain('PATCH');
  });
});

class NoopBroadcaster implements PresenceBroadcaster {
  publish(_event: PresenceEvent): void {}
  subscribe(_workspaceId: string, _subscriber: PresenceSubscriber): () => void {
    return () => {};
  }
}

// design.md Decision 5, "Where the endpoint lives and how it is mounted":
// the exact regression /health once had — a route registered at module
// scope, before CORS, answers with no Access-Control-Allow-Origin. The
// presence stream MUST be mounted the same way every other route factory
// is: `app.route('/', createPresenceRoutes(deps))` onto `createApp()`'s
// already-CORS-wrapped output, never at module scope.
describe('GET /workspaces/:workspaceId/presence/stream — mounted like every other route', () => {
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

  test('carries the CORS headers the browser needs, exactly like /health', async () => {
    const app = createApp({ appUrl: WEB_ORIGIN });
    app.route(
      '/',
      createPresenceRoutes({
        sql,
        sessionIdleTimeoutMinutes: 30,
        broadcaster: new NoopBroadcaster(),
        pageLockTtlSeconds: 120,
        keepAliveSeconds: 20,
      }),
    );

    const res = await app.request('/workspaces/00000000-0000-0000-0000-000000000000/presence/stream', {
      headers: { Origin: WEB_ORIGIN },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WEB_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  // Phase 9's route mounting repeats the same pattern check against
  // history and diff, per tasks.md 9.5.
  test('GET /pages/:id/history also carries the CORS headers, mounted the same way', async () => {
    const app = createApp({ appUrl: WEB_ORIGIN });
    app.route('/', createRevisionRoutes({ sql, sessionIdleTimeoutMinutes: 30 }));

    const res = await app.request('/pages/00000000-0000-0000-0000-000000000000/history', {
      headers: { Origin: WEB_ORIGIN },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WEB_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  test('GET /pages/:id/diff also carries the CORS headers, mounted the same way', async () => {
    const app = createApp({ appUrl: WEB_ORIGIN });
    app.route('/', createDiffRoutes({ sql, sessionIdleTimeoutMinutes: 30 }));

    const res = await app.request('/pages/00000000-0000-0000-0000-000000000000/diff?from=a&to=b', {
      headers: { Origin: WEB_ORIGIN },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WEB_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });
});

// Regression, second occurrence: Phase 1 shipped `admin`, `invitations`
// and `uploads` fully implemented and unit-tested while `createApp()`'s
// caller never mounted them. Phase 5 shipped `ai-credentials` the exact
// same way. Every test up to here calls the route factory directly and
// never traverses `composeApp()` — this suite is the one that does,
// through `app.request()`, so a route the composition root forgets fails
// here rather than in a browser.
class NoopMailSender implements MailSender {
  async send(): Promise<Result<void, { reason: string }>> {
    return ok(undefined);
  }
}

class NoopMailDispatcher implements MailDispatcher {
  dispatch(): void {}
}

class NoopPasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    return `hashed:${plaintext}`;
  }
  async verify(): Promise<boolean> {
    return false;
  }
}

class NoopBlobStore implements BlobStore {
  async put(): Promise<Result<void, { reason: string }>> {
    return ok(undefined);
  }
  async get(): Promise<Result<Uint8Array, { reason: string }>> {
    return ok(new Uint8Array());
  }
  async delete(): Promise<Result<void, { reason: string }>> {
    return ok(undefined);
  }
}

describe('composeApp — the credential route and its real gateway-backed probe, reached through app.request()', () => {
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

  test('a provider-accepted key persists through the fully composed app, never through the route factory', async () => {
    const [owner] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name)
      VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
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
      VALUES (${ws!.id}, 'user', ${owner!.id}, ${root!.id}, 'manage', 'allow')
    `;
    const { token } = await createSession(sql, { userId: owner!.id, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });

    const app = composeApp(
      {
        sql,
        mailSender: new NoopMailSender(),
        mailDispatcher: new NoopMailDispatcher(),
        passwordHasher: new NoopPasswordHasher(),
        blobStore: new NoopBlobStore(),
        smtpConfigHash: 'test-hash',
        presenceBroadcaster: new NoopBroadcaster(),
        presenceStreamRegistry: new PresenceStreamRegistry(),
        cipher: new AesGcmCredentialCipher(new EnvKeyProvider(new Map([['k1', Buffer.alloc(32, 7)]]), 'k1')),
        // The real Vercel AI SDK-backed probe (`./ai/gateway/validation-probe.ts`),
        // fixture-replayed — this is what proves the gateway's own provider
        // adapters are reachable from a running server, not only from their
        // own unit tests.
        validationProbe: createVercelAiValidationProbe(jsonFetch(200, generateFixture)),
      },
      {
        appUrl: WEB_ORIGIN,
        sessionIdleTimeoutMinutes: 30,
        sessionAbsoluteTimeoutDays: 30,
        passwordResetTtlMinutes: 30,
        invitationTtlDays: 7,
        maxUploadBytes: 1024,
        pageLockTtlSeconds: 120,
        pageLockHeartbeatSeconds: 20,
        changesetWindowMinutes: 30,
      },
    );

    const apiKey = `sk-live-${crypto.randomUUID()}`;
    const res = await app.request(`/workspaces/${ws!.id}/ai-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE_NAME}=${token}` },
      body: JSON.stringify({ provider: 'anthropic', apiKey }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: true; lastFour: string };
    expect(body.lastFour).toBe(apiKey.slice(-4));

    const [row] = await sql<{ ciphertext: Buffer }[]>`
      SELECT ciphertext FROM workspace_ai_credentials WHERE workspace_id = ${ws!.id} AND provider = 'anthropic'
    `;
    expect(row).toBeDefined();
    expect(row!.ciphertext.toString('utf8').includes(apiKey)).toBe(false);
  });
});
