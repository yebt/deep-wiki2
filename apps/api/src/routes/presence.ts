/**
 * The editing-presence SSE stream (editing-presence spec;
 * versioning-and-collaboration design.md Decision 5, "Presence and SSE").
 * Presence is per-*page* but fans out per-*workspace* — the natural
 * implementation is gating once at connect time on workspace membership,
 * which is exactly the wrong one: every candidate event is re-authorised
 * against the subscriber's own `read` grant on that event's page,
 * immediately before it would be written, so a permission revoked
 * mid-stream takes effect on the very next event rather than at the next
 * reconnect. The unauthorised subscriber sees no event, no page id, no
 * page title, no count — not even a narrower leak that drops the title
 * while still naming the id.
 *
 * Correctness never depends on the in-memory broadcaster alone: this
 * route also polls the `presence` view on a fixed cadence, so an editor
 * visible only to a different API process still reaches this connection
 * within one tick, never never.
 *
 * Two cadences, deliberately apart. The **keep-alive** (`SSE_KEEP_ALIVE_SECONDS`)
 * is a comment frame whose only job is to be bytes on the wire: `Bun.serve`
 * closes a connection that has been idle for ten seconds (its default
 * `idleTimeout`), which is what dropped every stream every ~10 s with
 * `ERR_INCOMPLETE_CHUNKED_ENCODING` in the browser until 2026-09-16, and a
 * reverse proxy's read timeout counts the same silence. The **poll**
 * (`pollSeconds`, `PAGE_LOCK_HEARTBEAT_SECONDS` in production) is a
 * database read and keeps the slower interval the two used to share.
 */
import { can, isWorkspaceMember, listActivePresence } from '@deep-wiki/db';
import type { PresenceBroadcaster, PresenceEvent } from '@deep-wiki/core';
import { ErrorResponseSchema, PresenceEventSchema } from '@deep-wiki/contracts';
import { Hono } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';
import type { PresenceStreamRegistry } from '../presence/registry';

/**
 * How often a `: keep-alive` comment is written to an open stream. Bounded
 * above by `Bun.serve`'s default `idleTimeout` of 10 seconds — a connection
 * with no bytes in either direction for that long is closed by the server
 * (measured on Bun 1.4.2: a stream written every 12 s died at ~20 s with
 * "timed out a request after 10 seconds"; one written every 5 s stayed open
 * for the whole 25 s it was watched). Half the timeout leaves room for a
 * tick that lands late under load. A comment frame is invisible to
 * `EventSource` consumers, so nothing client-side has to know about it.
 * Not configurable: it is a property of the server the API runs on, not of
 * the deployment.
 */
export const SSE_KEEP_ALIVE_SECONDS = 5;

export interface PresenceRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes: number;
  readonly broadcaster: PresenceBroadcaster;
  readonly pageLockTtlSeconds: number;
  /** Poll-fallback interval over the `presence` view, in seconds — `PAGE_LOCK_HEARTBEAT_SECONDS` in production. */
  readonly pollSeconds: number;
  /** Keep-alive comment interval, in seconds. Defaults to `SSE_KEEP_ALIVE_SECONDS`; tests shorten it. */
  readonly keepAliveSeconds?: number;
  /** The wait between ticks. Injected by tests that drive the clock by hand; real time otherwise. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Registered with so a server shutdown can close every open stream. Optional — tests that do not care about shutdown may omit it. */
  readonly registry?: PresenceStreamRegistry;
}

interface NodeTitleRow {
  title: string;
}

interface UserNameRow {
  display_name: string;
}

function presenceKey(event: PresenceEvent): string {
  return `${event.pageId}:${event.userId}:${event.since}`;
}

export function createPresenceRoutes(deps: PresenceRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes });
  const keepAliveMs = (deps.keepAliveSeconds ?? SSE_KEEP_ALIVE_SECONDS) * 1000;
  const pollMs = deps.pollSeconds * 1000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  app.get('/workspaces/:workspaceId/presence/stream', auth, async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const session = c.get('session');

    // Membership only opens the stream — it authorises nothing about any
    // individual page's presence event, which is re-checked per event
    // below. This is the coarse "may this caller connect at all" gate.
    const member = await isWorkspaceMember(deps.sql, { workspaceId, userId: session.userId });
    if (!member) {
      return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);
    }

    return streamSSE(c, async (stream: SSEStreamingApi) => {
      let closed = false;
      const sentKeys = new Set<string>();

      stream.onAbort(() => {
        closed = true;
      });

      const unregisterFromShutdown = deps.registry?.register(() => {
        stream.abort();
      });

      const relay = async (event: PresenceEvent, options: { readonly dedupe: boolean }): Promise<void> => {
        if (closed) return;
        const key = presenceKey(event);
        if (options.dedupe && sentKeys.has(key)) return;

        // Per-event authorisation, re-evaluated for every candidate event
        // — never a connect-time snapshot (design.md Decision 5,
        // "Per-event authorisation"). This is the only decision point, so
        // a revocation takes effect on the very next event.
        const authorized = await can(deps.sql, {
          subjectType: 'user',
          subjectId: session.userId,
          resourceId: event.pageId,
          action: 'read',
        });
        if (!authorized) return; // silently dropped — no "hidden event" signal either

        if (closed) return;
        const [node] = await deps.sql<NodeTitleRow[]>`SELECT title FROM nodes WHERE id = ${event.pageId}`;
        if (!node) return; // the page was deleted meanwhile

        const [author] = await deps.sql<UserNameRow[]>`SELECT display_name FROM users WHERE id = ${event.userId}`;

        if (closed) return;
        sentKeys.add(key);
        await stream.writeSSE({
          event: 'presence',
          data: JSON.stringify(
            PresenceEventSchema.parse({
              mode: 'editing',
              pageId: event.pageId,
              pageTitle: node.title,
              userId: event.userId,
              userDisplayName: author?.display_name ?? '',
              since: event.since,
            }),
          ),
        });
      };

      const unsubscribe = deps.broadcaster.subscribe(workspaceId, (event) => {
        void relay(event, { dedupe: false });
      });

      // Multiple-API-processes fallback (design.md Decision 5): a read of
      // the `presence` view, no write, catching whatever an in-memory
      // broadcast on a different process could never have delivered here.
      // Deduped against `sentKeys` so it never repeats what the live
      // broadcast (or an earlier tick) already told this connection.
      const pollTick = async (): Promise<void> => {
        const rows = await listActivePresence(deps.sql, { workspaceId, ttlSeconds: deps.pageLockTtlSeconds });
        for (const row of rows) {
          await relay(
            { workspaceId, pageId: row.pageId, userId: row.userId, since: row.since.toISOString() },
            { dedupe: true },
          );
        }
      };

      try {
        // Signals the connection is live before anything else. Tests
        // synchronise on this frame so a `publish()` issued right after
        // the request resolves is never lost to the subscribe-
        // registration race — the subscription above is already
        // registered by the time this is written.
        await stream.write(': connected\n\n');
        await pollTick();

        // The keep-alive drives the loop; the poll rides on every Nth tick.
        // Counted in ticks rather than read from a clock so a tick that
        // lands late never skips a poll, and so a test can drive it.
        let sinceLastPollMs = 0;
        while (!closed) {
          await sleep(keepAliveMs);
          if (closed) break;
          await stream.write(': keep-alive\n\n');
          sinceLastPollMs += keepAliveMs;
          if (sinceLastPollMs >= pollMs) {
            sinceLastPollMs = 0;
            await pollTick();
          }
        }
      } finally {
        unsubscribe();
        unregisterFromShutdown?.();
      }
    });
  });

  return app;
}
