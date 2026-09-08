import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { PresenceBroadcaster, PresenceEvent, PresenceSubscriber } from '@deep-wiki/core';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { createApp } from './index';
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
