/**
 * Client for `GET /workspaces/:workspaceId/presence/stream` (editing-presence
 * spec; design.md Decision 5). Presence is `editing`-only — there is no
 * `viewing` mode to render, by design (packages/contracts/src/presence.ts).
 *
 * The stream is workspace-scoped and fans out every editing session in the
 * workspace, filtered per subscriber server-side before an event ever
 * leaves — this composable additionally narrows to the one `pageId` it was
 * built for and drops everything else without ever rendering or storing it,
 * so a page this screen never opened never accumulates state here either
 * (never caching an event for a page it cannot, or does not currently,
 * show).
 *
 * There is no explicit "stopped editing" event (design.md: "no expiry
 * column, no sweeper, no second TTL" — presence is derived from the lock,
 * evaluated on read). Liveness is therefore inferred client-side exactly the
 * way the server infers it: an active editor's heartbeat republishes its
 * presence event on every heartbeat tick (`PAGE_LOCK_HEARTBEAT_SECONDS`,
 * mirrored in `useLockHeartbeat.ts` as 20s — the broadcaster relay is
 * `dedupe: false`, so a live connection gets a fresh event every tick), so
 * as long as the editor keeps heartbeating this composable keeps seeing
 * fresh events for them. An entry not refreshed within `expiryMs`
 * (mirroring `PAGE_LOCK_TTL_SECONDS`'s default of 120s — the same number the
 * lock itself uses to decide it has expired, per "Stale Presence Expires
 * Visibly, Tied To The Lock TTL") is dropped, which is what makes a closed
 * laptop stop showing as "editing" without the server ever saying so
 * explicitly.
 *
 * Transport degrades in two layers, both real rather than cosmetic:
 *   1. `EventSource` drops -> reconnect with exponential backoff, capped.
 *   2. `EventSource` unavailable at all -> fall back to periodically
 *      fetching the same endpoint and reading whatever SSE frames arrive
 *      before the response is released, on `pollIntervalMs`. The server
 *      already does its own poll-tick over the `presence` view on every
 *      keep-alive (design.md "Multiple API processes"), so a bounded read
 *      of the response body catches that same snapshot without holding a
 *      connection open — the client-side analogue of the same "correctness
 *      never depends on a live push" property the server design has.
 */

const DEFAULT_RECONNECT_BASE_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 20_000;
/**
 * Mirrors `PAGE_LOCK_TTL_SECONDS`'s server default (env.example / D5's
 * `readLockStatus`), exactly as `useLockHeartbeat.ts`'s
 * `DEFAULT_HEARTBEAT_INTERVAL_MS` mirrors `PAGE_LOCK_HEARTBEAT_SECONDS`.
 * There is no public runtime-config surface for either yet; if the server
 * default ever changes, this needs updating with it.
 */
const DEFAULT_EXPIRY_MS = 120_000;
const DEFAULT_EXPIRY_TICK_MS = 5_000;

export interface PresencePageEntry {
  readonly pageId: string;
  readonly pageTitle: string;
  readonly userId: string;
  readonly userDisplayName: string;
  /** ISO timestamp the lock (and therefore this presence) was acquired. */
  readonly since: string;
}

interface RawPresenceEvent {
  readonly mode: 'editing';
  readonly pageId: string;
  readonly pageTitle: string;
  readonly userId: string;
  readonly userDisplayName: string;
  readonly since: string;
}

export interface PresenceEventSourceLike {
  addEventListener(type: 'presence' | 'error' | 'open', handler: (event: { readonly data?: string }) => void): void;
  close(): void;
}

export type CreatePresenceEventSource = (url: string) => PresenceEventSourceLike;
export type PollPresenceOnce = (url: string) => Promise<readonly RawPresenceEvent[]>;

export type PresenceConnectionMode = 'idle' | 'sse' | 'poll' | 'reconnecting';

export interface UsePresenceStreamOptions {
  readonly createEventSource?: CreatePresenceEventSource;
  readonly pollOnce?: PollPresenceOnce;
  readonly reconnectBaseMs?: number;
  readonly reconnectMaxMs?: number;
  readonly pollIntervalMs?: number;
  readonly expiryMs?: number;
  readonly expiryTickMs?: number;
  /** Pause the connection while the tab is hidden; see the cost note on the read screen (index.vue). Defaults to true. */
  readonly pauseWhenHidden?: boolean;
  /** Test-only: skip the `EventSource` feature check and go straight to the poll fallback. */
  readonly forcePollFallback?: boolean;
}

export interface UsePresenceStreamResult {
  /** Unexpired `editing` presence for this composable's one page. */
  readonly editors: Ref<readonly PresencePageEntry[]>;
  readonly connectionMode: Ref<PresenceConnectionMode>;
  readonly start: (workspaceId: string) => void;
  readonly stop: () => void;
}

function parsePresenceFrames(text: string): RawPresenceEvent[] {
  const events: RawPresenceEvent[] = [];
  for (const frame of text.split('\n\n')) {
    if (!frame.includes('event: presence')) continue;
    const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
    if (!dataLine) continue;
    try {
      events.push(JSON.parse(dataLine.slice('data: '.length)) as RawPresenceEvent);
    } catch {
      // A malformed frame is dropped, never surfaced as a crash or a
      // fabricated editor.
    }
  }
  return events;
}

function defaultCreateEventSource(url: string): PresenceEventSourceLike {
  return new EventSource(url, { withCredentials: true }) as unknown as PresenceEventSourceLike;
}

function defaultPollOnce(url: string): Promise<readonly RawPresenceEvent[]> {
  return fetch(url, { credentials: 'include' })
    .then(async (response) => {
      const reader = response.body?.getReader();
      if (!reader) return [];
      const decoder = new TextDecoder();
      let buffer = '';
      // A bounded read, not a held-open connection: enough time for the
      // route's initial `: connected` frame and its immediate poll tick
      // (design.md "Termination" / "Multiple API processes"), then release.
      const deadline = Date.now() + 2_000;
      try {
        while (Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      return parsePresenceFrames(buffer);
    })
    .catch(() => []);
}

/**
 * `pageId` is the one page this consumer shows — read and edit mode — or
 * `null` for every page in the workspace, which is what the dashboard's
 * "editing now" column asks for. Either way nothing is filtered here that
 * the server did not already authorise per event; the page filter is only
 * about what this screen has a place to render.
 */
export function usePresenceStream(pageId: string | null, options: UsePresenceStreamOptions = {}): UsePresenceStreamResult {
  const config = useRuntimeConfig();
  const createSource = options.createEventSource ?? defaultCreateEventSource;
  const poll = options.pollOnce ?? defaultPollOnce;
  const reconnectBaseMs = options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS;
  const reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const expiryMs = options.expiryMs ?? DEFAULT_EXPIRY_MS;
  const expiryTickMs = options.expiryTickMs ?? DEFAULT_EXPIRY_TICK_MS;
  const pauseWhenHidden = options.pauseWhenHidden ?? true;

  const editors = ref<readonly PresencePageEntry[]>([]);
  const connectionMode = ref<PresenceConnectionMode>('idle');

  const roster = new Map<string, { entry: PresencePageEntry; lastSeenAt: number }>();
  let currentWorkspaceId: string | null = null;
  let source: PresenceEventSourceLike | null = null;
  let reconnectDelay = reconnectBaseMs;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let expiryTimer: ReturnType<typeof setInterval> | undefined;
  let visibilityHandler: (() => void) | undefined;
  let running = false;

  function recomputeEditors(): void {
    const cutoff = Date.now() - expiryMs;
    const fresh: PresencePageEntry[] = [];
    for (const [key, tracked] of roster) {
      if (tracked.lastSeenAt <= cutoff) {
        roster.delete(key);
      } else {
        fresh.push(tracked.entry);
      }
    }
    editors.value = fresh;
  }

  function onRawEvent(raw: RawPresenceEvent): void {
    if (pageId !== null && raw.pageId !== pageId) return; // never surfaced — not this page
    // One person on two pages is two entries: the key is the pair, not the person.
    roster.set(`${raw.pageId}:${raw.userId}`, {
      entry: { pageId: raw.pageId, pageTitle: raw.pageTitle, userId: raw.userId, userDisplayName: raw.userDisplayName, since: raw.since },
      lastSeenAt: Date.now(),
    });
    recomputeEditors();
  }

  function streamUrl(workspaceId: string): string {
    return `${config.public.apiBaseUrl}/workspaces/${workspaceId}/presence/stream`;
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  }

  function clearPollTimer(): void {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  function closeSource(): void {
    source?.close();
    source = null;
  }

  function scheduleReconnect(workspaceId: string): void {
    connectionMode.value = 'reconnecting';
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaxMs);
      connectSse(workspaceId);
    }, reconnectDelay);
  }

  function connectSse(workspaceId: string): void {
    closeSource();
    const es = createSource(streamUrl(workspaceId));
    source = es;
    es.addEventListener('open', () => {
      reconnectDelay = reconnectBaseMs;
      connectionMode.value = 'sse';
    });
    es.addEventListener('presence', (event) => {
      if (!event.data) return;
      try {
        onRawEvent(JSON.parse(event.data) as RawPresenceEvent);
      } catch {
        // A malformed frame is dropped, never a crash.
      }
    });
    es.addEventListener('error', () => {
      if (!running) return;
      scheduleReconnect(workspaceId);
    });
    // `EventSource` has no reliable "connected" signal in every
    // environment this composable's fake stands in for, so a first
    // successful construction is treated as live immediately; `open`
    // above corrects it if the real transport confirms it later.
    connectionMode.value = 'sse';
  }

  function connectPoll(workspaceId: string): void {
    connectionMode.value = 'poll';
    const url = streamUrl(workspaceId);
    const tick = (): void => {
      void poll(url).then((events) => {
        for (const raw of events) onRawEvent(raw);
      });
    };
    tick();
    clearPollTimer();
    pollTimer = setInterval(tick, pollIntervalMs);
  }

  function eventSourceAvailable(): boolean {
    if (options.forcePollFallback) return false;
    // An explicitly injected factory is itself the statement that SSE is
    // available — this is what makes the SSE path testable without a real
    // (or environment-provided) global `EventSource`. The production
    // default path, with no injected factory, still checks the real thing.
    if (options.createEventSource) return true;
    return typeof EventSource !== 'undefined';
  }

  function connect(workspaceId: string): void {
    if (eventSourceAvailable()) connectSse(workspaceId);
    else connectPoll(workspaceId);
  }

  function disconnect(): void {
    clearReconnectTimer();
    clearPollTimer();
    closeSource();
  }

  function start(workspaceId: string): void {
    running = true;
    currentWorkspaceId = workspaceId;
    reconnectDelay = reconnectBaseMs;
    roster.clear();
    editors.value = [];

    if (pauseWhenHidden && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      connectionMode.value = 'idle';
    } else {
      connect(workspaceId);
    }

    if (expiryTimer === undefined) expiryTimer = setInterval(recomputeEditors, expiryTickMs);

    if (pauseWhenHidden && typeof document !== 'undefined' && visibilityHandler === undefined) {
      visibilityHandler = () => {
        if (!running || currentWorkspaceId === null) return;
        if (document.visibilityState === 'hidden') {
          disconnect();
          connectionMode.value = 'idle';
        } else {
          connect(currentWorkspaceId);
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    }
  }

  function stop(): void {
    running = false;
    currentWorkspaceId = null;
    disconnect();
    if (expiryTimer !== undefined) {
      clearInterval(expiryTimer);
      expiryTimer = undefined;
    }
    if (visibilityHandler !== undefined && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = undefined;
    }
    roster.clear();
    editors.value = [];
    connectionMode.value = 'idle';
  }

  return { editors, connectionMode, start, stop };
}
