/**
 * The editing-presence SSE stream (editing-presence spec;
 * versioning-and-collaboration design.md Decision 5). The highest-risk
 * requirement in the whole change: presence fans out per-workspace but
 * must never disclose a page's existence to a subscriber who cannot read
 * it, evaluated fresh on every event rather than once at connect.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { acquireLock, can, createSession } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import type { PresenceBroadcaster, PresenceEvent, PresenceSubscriber } from '@deep-wiki/core';
import { PresenceEventSchema } from '@deep-wiki/contracts';
import postgres from 'postgres';
import { expectNoDisclosure } from '../../testing/expect-no-disclosure';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { PresenceStreamRegistry } from '../presence/registry';
import { createPresenceRoutes } from './presence';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 10 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

const TTL_SECONDS = 120;

class TestBroadcaster implements PresenceBroadcaster {
  private readonly subscribersByWorkspace = new Map<string, Set<PresenceSubscriber>>();

  publish(event: PresenceEvent): void {
    for (const subscriber of this.subscribersByWorkspace.get(event.workspaceId) ?? []) {
      subscriber(event);
    }
  }

  subscribe(workspaceId: string, subscriber: PresenceSubscriber): () => void {
    const set = this.subscribersByWorkspace.get(workspaceId) ?? new Set();
    set.add(subscriber);
    this.subscribersByWorkspace.set(workspaceId, set);
    return () => set.delete(subscriber);
  }

  subscriberCount(workspaceId: string): number {
    return this.subscribersByWorkspace.get(workspaceId)?.size ?? 0;
  }
}

interface Fixture {
  readonly workspaceId: string;
  readonly pageId: string;
  readonly pageTitle: string;
  readonly editorUserId: string;
  readonly readerUserId: string;
  readonly readerCookie: string;
  readonly outsiderCookie: string;
  readonly nonMemberCookie: string;
}

async function seedUser(displayName: string): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`${displayName.toLowerCase()}-${crypto.randomUUID()}@example.com`}, 'hash', ${displayName})
    RETURNING id
  `;
  return user!.id;
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function buildFixture(): Promise<Fixture> {
  const owner = await seedUser('Owner');
  const editor = await seedUser('Editor');
  const reader = await seedUser('Reader');
  const outsider = await seedUser('Outsider'); // a workspace member without read on the target page
  const nonMember = await seedUser('NonMember'); // not a member of the workspace at all

  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  const pageTitle = `Secret Page ${crypto.randomUUID()}`;
  const [page] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, ${pageTitle}) RETURNING id
  `;
  await sql`
    INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
    VALUES (${page!.id}, ${ws!.id}, '# Hello', 'hash-1')
  `;
  // A sibling page, unrelated to the target page's ancestry, so a grant
  // here makes `outsider` a workspace member without inheriting read on
  // the target — a grant on `root` would inherit down through the
  // ancestor walk and defeat the whole point of this fixture.
  const [siblingPage] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'page', '', 1, ${`sibling-${crypto.randomUUID()}`}, 'Sibling Page') RETURNING id
  `;

  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${ws!.id}, 'user', ${reader}, ${page!.id}, 'read', 'allow')
  `;
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${ws!.id}, 'user', ${outsider}, ${siblingPage!.id}, 'read', 'allow')
  `;

  return {
    workspaceId: ws!.id,
    pageId: page!.id,
    pageTitle,
    editorUserId: editor,
    readerUserId: reader,
    readerCookie: await cookieFor(reader),
    outsiderCookie: await cookieFor(outsider),
    nonMemberCookie: await cookieFor(nonMember),
  };
}

function buildApp(deps: {
  broadcaster: PresenceBroadcaster;
  registry?: PresenceStreamRegistry;
  keepAliveSeconds?: number;
}) {
  return createPresenceRoutes({
    sql,
    sessionIdleTimeoutMinutes: 30,
    broadcaster: deps.broadcaster,
    pageLockTtlSeconds: TTL_SECONDS,
    keepAliveSeconds: deps.keepAliveSeconds ?? 30,
    registry: deps.registry,
  });
}

/**
 * A small stateful SSE frame reader over one stream's body. Keeps a
 * remainder buffer across calls so a chunk boundary landing mid-frame (or
 * two frames arriving in the same chunk, e.g. a keep-alive comment
 * immediately followed by a `presence` event from the same poll tick)
 * never gets miscounted or dropped.
 */
/**
 * The minimal shape `FrameReader` needs — deliberately looser than
 * `ReadableStreamDefaultReader<Uint8Array>` itself, whose DOM-lib and
 * Bun-augmented-global forms disagree on extra members (`readMany`) and
 * are not structurally assignable to one another.
 */
interface RawStreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
}

class FrameReader {
  private buffer = '';
  private readonly decoder = new TextDecoder();
  /** Every raw byte this reader has ever decoded, regardless of framing — the non-disclosure check scans this, not a single frame. */
  private transcriptText = '';

  constructor(private readonly reader: RawStreamReader) {}

  /** Everything received on this stream so far, for a whole-transcript disclosure scan rather than a single selected field. */
  transcript(): string {
    return this.transcriptText;
  }

  /** The next single SSE frame (comment or `event:`/`data:` block), or `null` on stream end / timeout. */
  async next(timeoutMs = 2000): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const idx = this.buffer.indexOf('\n\n');
      if (idx !== -1) {
        const frame = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        if (frame.trim().length > 0) return frame;
        continue;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const outcome = await Promise.race([
        this.reader.read().then((result) => ({ timedOut: false as const, result })),
        new Promise<{ timedOut: true }>((resolve) => setTimeout(() => resolve({ timedOut: true }), remaining)),
      ]);
      if (outcome.timedOut) return null;
      if (outcome.result.done) return null;
      const chunk = this.decoder.decode(outcome.result.value, { stream: true });
      this.buffer += chunk;
      this.transcriptText += chunk;
    }
  }

  /** Reads frames until one is a `presence` event, or returns `null` once `timeoutMs` has elapsed with none seen. */
  async nextPresenceFrame(timeoutMs = 2000): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const frame = await this.next(remaining);
      if (frame === null) return null;
      if (frame.includes('event: presence')) return frame;
      // else: a plain comment (": connected" / ": keep-alive") — keep waiting.
    }
  }
}

function payloadOf(frame: string): unknown {
  const dataLine = frame
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .join('\n');
  return JSON.parse(dataLine);
}

describe('GET /workspaces/:workspaceId/presence/stream — membership gate', () => {
  test('a subject who is not a member of the workspace cannot open the stream', async () => {
    const fixture = await buildFixture();
    const app = buildApp({ broadcaster: new TestBroadcaster() });

    const res = await app.request(`/workspaces/${fixture.workspaceId}/presence/stream`, {
      headers: { cookie: fixture.nonMemberCookie },
    });

    expect(res.status).toBe(403);
  });
});

describe('GET /workspaces/:workspaceId/presence/stream — per-subscriber non-disclosure', () => {
  test('a workspace member without read on the page receives no event naming it, not even the id with the title omitted', async () => {
    const fixture = await buildFixture();
    const broadcaster = new TestBroadcaster();
    const app = buildApp({ broadcaster });

    const res = await app.request(`/workspaces/${fixture.workspaceId}/presence/stream`, {
      headers: { cookie: fixture.outsiderCookie },
    });
    const fr = new FrameReader(res.body!.getReader());
    // Synchronise on the connection-open marker before publishing, so the
    // publish below cannot race the subscription's own registration.
    await fr.next();

    const since = new Date().toISOString();
    broadcaster.publish({ workspaceId: fixture.workspaceId, pageId: fixture.pageId, userId: fixture.editorUserId, since });

    const frame = await fr.nextPresenceFrame(700);

    expect(frame).toBeNull();
    // Scans everything actually received on the wire — the full
    // transcript and the headers, not a single selected field — for the
    // hidden page's id or title, exactly as `apps/api/testing/
    // expect-no-disclosure.ts` requires.
    expectNoDisclosure(fr.transcript(), { id: fixture.pageId, title: fixture.pageTitle }, res.headers);
  });

  test('a workspace member with read on the page receives the event naming the user, page and since', async () => {
    const fixture = await buildFixture();
    const broadcaster = new TestBroadcaster();
    const app = buildApp({ broadcaster });

    const res = await app.request(`/workspaces/${fixture.workspaceId}/presence/stream`, {
      headers: { cookie: fixture.readerCookie },
    });
    const fr = new FrameReader(res.body!.getReader());
    await fr.next(); // ": connected"

    const since = new Date().toISOString();
    broadcaster.publish({ workspaceId: fixture.workspaceId, pageId: fixture.pageId, userId: fixture.editorUserId, since });

    const frame = await fr.nextPresenceFrame();
    expect(frame).not.toBeNull();
    const payload = PresenceEventSchema.parse(payloadOf(frame!));
    expect(payload.pageId).toBe(fixture.pageId);
    expect(payload.pageTitle).toBe(fixture.pageTitle);
    expect(payload.userId).toBe(fixture.editorUserId);
    expect(payload.mode).toBe('editing');
  });

  test('filtering is per subscriber from the same broadcast, not a single workspace-wide relay both would receive', async () => {
    const fixture = await buildFixture();
    const broadcaster = new TestBroadcaster();
    const app = buildApp({ broadcaster });

    const readerRes = await app.request(`/workspaces/${fixture.workspaceId}/presence/stream`, {
      headers: { cookie: fixture.readerCookie },
    });
    const outsiderRes = await app.request(`/workspaces/${fixture.workspaceId}/presence/stream`, {
      headers: { cookie: fixture.outsiderCookie },
    });
    const readerFr = new FrameReader(readerRes.body!.getReader());
    const outsiderFr = new FrameReader(outsiderRes.body!.getReader());
    await readerFr.next();
    await outsiderFr.next();

    const since = new Date().toISOString();
    // One publish, both subscribers registered on the same broadcast.
    broadcaster.publish({ workspaceId: fixture.workspaceId, pageId: fixture.pageId, userId: fixture.editorUserId, since });

    const readerFrame = await readerFr.nextPresenceFrame();
    expect(readerFrame).not.toBeNull();

    const outsiderFrame = await outsiderFr.nextPresenceFrame(700);
    expect(outsiderFrame).toBeNull();
  });
});

describe('per-event authorisation is re-evaluated on every candidate event', () => {
  test('revoking read mid-stream withholds the next event, not just skips an initial check', async () => {
    const fixture = await buildFixture();
    const broadcaster = new TestBroadcaster();
    const app = buildApp({ broadcaster });

    const res = await app.request(`/workspaces/${fixture.workspaceId}/presence/stream`, {
      headers: { cookie: fixture.readerCookie },
    });
    const fr = new FrameReader(res.body!.getReader());
    await fr.next(); // ": connected"

    const firstSince = new Date().toISOString();
    broadcaster.publish({ workspaceId: fixture.workspaceId, pageId: fixture.pageId, userId: fixture.editorUserId, since: firstSince });
    const firstFrame = await fr.nextPresenceFrame();
    expect(firstFrame).not.toBeNull();

    // Revoke *after* a successful, authorised first event — proving this
    // is not merely a connect-time check that happened to run once.
    await sql`
      DELETE FROM permissions WHERE workspace_id = ${fixture.workspaceId} AND resource_id = ${fixture.pageId}
        AND subject_type = 'user' AND action = 'read'
    `;
    const stillAuthorized = await can(sql, {
      subjectType: 'user',
      subjectId: fixture.readerUserId,
      resourceId: fixture.pageId,
      action: 'read',
    });
    expect(stillAuthorized).toBe(false);

    const secondSince = new Date(Date.now() + 1000).toISOString(); // distinct key from the first event
    broadcaster.publish({ workspaceId: fixture.workspaceId, pageId: fixture.pageId, userId: fixture.editorUserId, since: secondSince });

    const secondFrame = await fr.nextPresenceFrame(700);
    expect(secondFrame).toBeNull();
  });
});

describe('multiple-API-processes poll fallback', () => {
  test('presence discovered only through the DB view is delivered even though the broadcaster is never published to', async () => {
    const fixture = await buildFixture();
    // A broadcaster this test never calls `publish` on at all — proves
    // delivery came from the poll path alone, not from bypassing an
    // in-memory relay that happened to still be wired.
    const broadcaster = new TestBroadcaster();
    const app = buildApp({ broadcaster, keepAliveSeconds: 30 });

    const lock = await acquireLock(sql, {
      nodeId: fixture.pageId,
      workspaceId: fixture.workspaceId,
      userId: fixture.editorUserId,
      ttlSeconds: TTL_SECONDS,
    });

    const res = await app.request(`/workspaces/${fixture.workspaceId}/presence/stream`, {
      headers: { cookie: fixture.readerCookie },
    });
    const fr = new FrameReader(res.body!.getReader());
    await fr.next(); // ": connected"

    // The initial poll tick runs immediately on connect, before the first
    // keep-alive sleep — so this arrives without waiting out a real
    // interval, while still having come from nothing but the view.
    const frame = await fr.nextPresenceFrame();
    expect(frame).not.toBeNull();
    const payload = PresenceEventSchema.parse(payloadOf(frame!));
    expect(payload.pageId).toBe(fixture.pageId);
    expect(payload.since).toBe(lock.acquiredAt.toISOString());
    expect(broadcaster.subscriberCount(fixture.workspaceId)).toBeGreaterThan(0); // subscribed, but never the delivery source
  });

  test('a later keep-alive tick discovers presence that started after connect', async () => {
    const fixture = await buildFixture();
    const broadcaster = new TestBroadcaster();
    const app = buildApp({ broadcaster, keepAliveSeconds: 0.05 });

    const res = await app.request(`/workspaces/${fixture.workspaceId}/presence/stream`, {
      headers: { cookie: fixture.readerCookie },
    });
    const fr = new FrameReader(res.body!.getReader());
    await fr.next(); // ": connected" — no presence yet, none exists

    await acquireLock(sql, {
      nodeId: fixture.pageId,
      workspaceId: fixture.workspaceId,
      userId: fixture.editorUserId,
      ttlSeconds: TTL_SECONDS,
    });

    const frame = await fr.nextPresenceFrame(3000);
    expect(frame).not.toBeNull();
  });
});

describe('termination', () => {
  test('a client disconnect unsubscribes the stream from the broadcaster', async () => {
    const fixture = await buildFixture();
    const broadcaster = new TestBroadcaster();
    const app = buildApp({ broadcaster });

    const res = await app.request(`/workspaces/${fixture.workspaceId}/presence/stream`, {
      headers: { cookie: fixture.readerCookie },
    });
    const reader = res.body!.getReader();
    const fr = new FrameReader(reader);
    await fr.next(); // ": connected"
    expect(broadcaster.subscriberCount(fixture.workspaceId)).toBe(1);

    await reader.cancel();
    // Cancelling the reader aborts the stream; give the abort subscriber
    // a tick to run before asserting cleanup happened.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(broadcaster.subscriberCount(fixture.workspaceId)).toBe(0);
  });

  test('a server shutdown closes every open stream, not just one', async () => {
    const fixture = await buildFixture();
    const broadcaster = new TestBroadcaster();
    const registry = new PresenceStreamRegistry();
    const app = buildApp({ broadcaster, registry });

    const resA = await app.request(`/workspaces/${fixture.workspaceId}/presence/stream`, {
      headers: { cookie: fixture.readerCookie },
    });
    const resB = await app.request(`/workspaces/${fixture.workspaceId}/presence/stream`, {
      headers: { cookie: fixture.outsiderCookie },
    });
    const readerA = resA.body!.getReader();
    const readerB = resB.body!.getReader();
    await new FrameReader(readerA).next();
    await new FrameReader(readerB).next();
    expect(broadcaster.subscriberCount(fixture.workspaceId)).toBe(2);

    registry.closeAll();

    const [doneA, doneB] = await Promise.all([readerA.read().then((r) => r.done), readerB.read().then((r) => r.done)]);

    expect(doneA).toBe(true);
    expect(doneB).toBe(true);
  });
});
