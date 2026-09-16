/**
 * Client for `GET /workspaces/:workspaceId/presence/stream` (editing-presence
 * spec; design.md Decision 5). Presence is `editing`-only — there is no
 * `viewing` mode to render, by design (packages/contracts/src/presence.ts).
 *
 * The stream is workspace-scoped and fans out every editing session in the
 * workspace, filtered per subscriber server-side before an event ever
 * leaves — this composable additionally narrows to the one `pageId` it was
 * built for and drops everything else from what it renders. Nothing is
 * filtered here that the server did not already authorise per event; the
 * page filter is only about what this screen has a place to show.
 *
 * **One connection per workspace, shared by every screen in it** (since
 * 2026-09-16). Until then each screen owned its own `EventSource`, so a hop
 * from one page to the next closed the stream in `onBeforeUnmount` and
 * opened a new one once the next response had named the workspace — a
 * fresh connection, membership check and poll of the presence view on
 * every click. The connection now lives in a module-level registry keyed
 * by workspace: `start()` subscribes this screen to it (creating it on the
 * first ask), `stop()` unsubscribes, and a connection nobody has wanted
 * for `lingerMs` closes. The linger is what carries it across a hop, whose
 * gap is the next screen's response. The roster is the connection's —
 * every page the server let this person see — and each subscriber reads
 * its own page out of it, which is also why a hop shows who is editing at
 * once instead of after their next heartbeat.
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
 *      already does its own poll-tick over the `presence` view on connect
 *      and on its poll cadence (design.md "Multiple API processes"), so a
 *      bounded read of the response body catches that same snapshot without
 *      holding a connection open — the client-side analogue of the same
 *      "correctness never depends on a live push" property the server
 *      design has.
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
/**
 * How long a workspace's connection outlives its last subscriber. A hop
 * between two screens in the same workspace is one `stop()` at unmount and
 * one `start()` once the next screen's response has named the workspace —
 * milliseconds in production, seconds on a loaded dev server — and the
 * connection must still be there for the second. Long enough for the
 * slowest hop measured on 2026-09-16, short enough that leaving the
 * workspace for the list costs one idle stream for a few seconds.
 */
const DEFAULT_LINGER_MS = 10_000;

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
  /** How long the workspace's connection outlives its last subscriber — the window a hop has to reclaim it. */
  readonly lingerMs?: number;
  /** Pause the connection while the tab is hidden; see the cost note on the read screen (index.vue). Defaults to true. */
  readonly pauseWhenHidden?: boolean;
  /** Test-only: skip the `EventSource` feature check and go straight to the poll fallback. */
  readonly forcePollFallback?: boolean;
}

export interface UsePresenceStreamResult {
  /** Unexpired `editing` presence for this composable's one page. */
  readonly editors: ComputedRef<readonly PresencePageEntry[]>;
  readonly connectionMode: ComputedRef<PresenceConnectionMode>;
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

/** Everything a connection needs that the first subscriber to ask for it decided. */
interface ConnectionSettings {
  readonly url: string;
  readonly createSource: CreatePresenceEventSource;
  readonly poll: PollPresenceOnce;
  readonly useSse: boolean;
  readonly reconnectBaseMs: number;
  readonly reconnectMaxMs: number;
  readonly pollIntervalMs: number;
  readonly expiryMs: number;
  readonly expiryTickMs: number;
  readonly lingerMs: number;
  readonly pauseWhenHidden: boolean;
}

/**
 * One workspace's live connection: the transport, its reconnect and poll
 * timers, the roster of everyone the server said is editing, and the
 * screens currently reading it. Owned by the module-level registry below,
 * never by a screen.
 */
class PresenceConnection {
  /** Every unexpired entry the server let this person see, workspace-wide. Subscribers filter it. */
  readonly snapshot = shallowRef<readonly PresencePageEntry[]>([]);
  readonly mode = ref<PresenceConnectionMode>('idle');
  private readonly roster = new Map<string, { entry: PresencePageEntry; lastSeenAt: number }>();
  private subscribers = 0;
  private source: PresenceEventSourceLike | null = null;
  private reconnectDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private readonly expiryTimer: ReturnType<typeof setInterval>;
  private lingerTimer: ReturnType<typeof setTimeout> | undefined;
  private visibilityHandler: (() => void) | undefined;
  private closed = false;

  constructor(
    readonly workspaceId: string,
    private readonly settings: ConnectionSettings,
    private readonly onClosed: () => void,
  ) {
    this.reconnectDelay = settings.reconnectBaseMs;
    this.expiryTimer = setInterval(() => this.recompute(), settings.expiryTickMs);

    if (settings.pauseWhenHidden && typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        if (this.closed) return;
        if (document.visibilityState === 'hidden') {
          this.disconnect();
          this.mode.value = 'idle';
        } else {
          this.connect();
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    if (settings.pauseWhenHidden && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.mode.value = 'idle';
    } else {
      this.connect();
    }
  }

  /** A screen starts reading this connection; a pending close is called off. */
  subscribe(): void {
    this.subscribers += 1;
    if (this.lingerTimer !== undefined) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = undefined;
    }
  }

  /** A screen stops reading; the last one out starts the linger clock rather than closing at once. */
  unsubscribe(): void {
    this.subscribers = Math.max(0, this.subscribers - 1);
    if (this.subscribers > 0 || this.closed) return;
    if (this.settings.lingerMs <= 0) {
      this.close();
      return;
    }
    this.lingerTimer = setTimeout(() => this.close(), this.settings.lingerMs);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.lingerTimer !== undefined) clearTimeout(this.lingerTimer);
    clearInterval(this.expiryTimer);
    this.disconnect();
    if (this.visibilityHandler !== undefined && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    this.roster.clear();
    this.snapshot.value = [];
    this.mode.value = 'idle';
    this.onClosed();
  }

  private recompute(): void {
    const cutoff = Date.now() - this.settings.expiryMs;
    const fresh: PresencePageEntry[] = [];
    for (const [key, tracked] of this.roster) {
      if (tracked.lastSeenAt <= cutoff) {
        this.roster.delete(key);
      } else {
        fresh.push(tracked.entry);
      }
    }
    this.snapshot.value = fresh;
  }

  private onRawEvent(raw: RawPresenceEvent): void {
    // One person on two pages is two entries: the key is the pair, not the person.
    this.roster.set(`${raw.pageId}:${raw.userId}`, {
      entry: { pageId: raw.pageId, pageTitle: raw.pageTitle, userId: raw.userId, userDisplayName: raw.userDisplayName, since: raw.since },
      lastSeenAt: Date.now(),
    });
    this.recompute();
  }

  private connect(): void {
    if (this.settings.useSse) this.connectSse();
    else this.connectPoll();
  }

  private disconnect(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.source?.close();
    this.source = null;
  }

  private scheduleReconnect(): void {
    this.mode.value = 'reconnecting';
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.settings.reconnectMaxMs);
      this.connectSse();
    }, this.reconnectDelay);
  }

  private connectSse(): void {
    this.source?.close();
    const es = this.settings.createSource(this.settings.url);
    this.source = es;
    es.addEventListener('open', () => {
      this.reconnectDelay = this.settings.reconnectBaseMs;
      this.mode.value = 'sse';
    });
    es.addEventListener('presence', (event) => {
      if (!event.data) return;
      try {
        this.onRawEvent(JSON.parse(event.data) as RawPresenceEvent);
      } catch {
        // A malformed frame is dropped, never a crash.
      }
    });
    es.addEventListener('error', () => {
      if (this.closed || this.source !== es) return;
      this.scheduleReconnect();
    });
    // `EventSource` has no reliable "connected" signal in every
    // environment this composable's fake stands in for, so a first
    // successful construction is treated as live immediately; `open`
    // above corrects it if the real transport confirms it later.
    this.mode.value = 'sse';
  }

  private connectPoll(): void {
    this.mode.value = 'poll';
    const tick = (): void => {
      void this.settings.poll(this.settings.url).then((events) => {
        if (this.closed) return;
        for (const raw of events) this.onRawEvent(raw);
      });
    };
    tick();
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(tick, this.settings.pollIntervalMs);
  }
}

/** The live connections, one per workspace, for this browser tab. */
const connections = new Map<string, PresenceConnection>();

function acquireConnection(workspaceId: string, settings: ConnectionSettings): PresenceConnection {
  let connection = connections.get(workspaceId);
  if (!connection) {
    connection = new PresenceConnection(workspaceId, settings, () => {
      if (connections.get(workspaceId) === connection) connections.delete(workspaceId);
    });
    connections.set(workspaceId, connection);
  }
  connection.subscribe();
  return connection;
}

/**
 * Closes every workspace connection at once, linger or not. For tests,
 * which otherwise hand a lingering fake from one case to the next; nothing
 * in the product calls it — a screen that leaves a workspace lets the
 * connection linger for the next screen, by design.
 */
export function closePresenceStreams(): void {
  for (const connection of [...connections.values()]) connection.close();
  connections.clear();
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

  function eventSourceAvailable(): boolean {
    if (options.forcePollFallback) return false;
    // An explicitly injected factory is itself the statement that SSE is
    // available — this is what makes the SSE path testable without a real
    // (or environment-provided) global `EventSource`. The production
    // default path, with no injected factory, still checks the real thing.
    if (options.createEventSource) return true;
    return typeof EventSource !== 'undefined';
  }

  function settingsFor(workspaceId: string): ConnectionSettings {
    return {
      url: `${config.public.apiBaseUrl}/workspaces/${workspaceId}/presence/stream`,
      createSource: options.createEventSource ?? defaultCreateEventSource,
      poll: options.pollOnce ?? defaultPollOnce,
      useSse: eventSourceAvailable(),
      reconnectBaseMs: options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS,
      reconnectMaxMs: options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS,
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      expiryMs: options.expiryMs ?? DEFAULT_EXPIRY_MS,
      expiryTickMs: options.expiryTickMs ?? DEFAULT_EXPIRY_TICK_MS,
      lingerMs: options.lingerMs ?? DEFAULT_LINGER_MS,
      pauseWhenHidden: options.pauseWhenHidden ?? true,
    };
  }

  /** The workspace connection this screen is subscribed to, if any. */
  const connection = shallowRef<PresenceConnection | null>(null);

  const editors = computed<readonly PresencePageEntry[]>(() => {
    const live = connection.value;
    if (!live) return [];
    const all = live.snapshot.value;
    return pageId === null ? all : all.filter((entry) => entry.pageId === pageId);
  });

  const connectionMode = computed<PresenceConnectionMode>(() => connection.value?.mode.value ?? 'idle');

  function stop(): void {
    const live = connection.value;
    if (!live) return;
    connection.value = null;
    live.unsubscribe();
  }

  function start(workspaceId: string): void {
    if (connection.value?.workspaceId === workspaceId) return;
    stop();
    connection.value = acquireConnection(workspaceId, settingsFor(workspaceId));
  }

  return { editors, connectionMode, start, stop };
}
