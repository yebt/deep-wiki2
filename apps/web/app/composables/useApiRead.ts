import type { AsyncDataOptions, NuxtApp } from '#app';

/** Why Nuxt is asking the cache — the third argument of `getCachedData`, which Nuxt does not export on its own. */
type CacheContext = Parameters<NonNullable<AsyncDataOptions<unknown>['getCachedData']>>[2];

/**
 * The outcome of one API read, as the read layer keeps it: the parsed
 * response, or the HTTP status the server answered with (`undefined` when
 * nothing came back). Never a thrown error — an error would be serialised
 * into the SSR payload by Nuxt's own reducer, which keeps `statusCode` but
 * drops ofetch's `response`, and `httpStatusOf` would then read every
 * server-side 404 as a network failure on the client.
 */
export type ApiReadOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly status: number | undefined };

export interface UseApiReadOptions {
  /**
   * Whether this read may run during server rendering at all (default
   * `true`). `false` for a read whose inputs are not known to be complete,
   * such as a diff with no revision ids in the URL.
   */
  readonly server?: boolean;
}

export interface UseApiReadResult<T> {
  /**
   * The current answer: the server's from the SSR payload, a previous
   * screen's from the client cache, or the last fetch's. `null` until one
   * exists — which is the only time a screen shows its skeleton.
   */
  readonly outcome: ComputedRef<ApiReadOutcome<T> | null>;
  /** A request is in flight — beside a kept outcome, never instead of it. */
  readonly pending: ComputedRef<boolean>;
  /**
   * Fetch again, bypassing the cache; concurrent calls share one request.
   * During hydration, with the server's answer already in the payload, it
   * resolves at once — the screen's mount-time `load()` must not repeat
   * the request the server just made. With a cached answer on screen, the
   * request leaves after the next frame: the answer paints first.
   */
  readonly load: () => Promise<void>;
}

/**
 * Whether the request being server-rendered carries a session cookie, in
 * which case the API accepts it and the read can be answered before the
 * document leaves the server. apps/web and apps/api are different origins
 * on the same host in development and e2e (`localhost:<web>` and
 * `localhost:<api>`), so the browser sends the host-scoped session cookie
 * to both and the Nuxt server can forward it (`useRequestHeaders`). On a
 * deployment where the API lives on another host, the cookie is scoped to
 * that host, never reaches the Nuxt server, and this is `false`: the read
 * then waits for the browser, exactly as before the data layer existed.
 */
export function ssrCanAuthenticate(): boolean {
  if (!import.meta.server) return true;
  const cookie = useRequestHeaders(['cookie']).cookie ?? '';
  return /(^|;\s*)session=[^;]+/.test(cookie);
}

/**
 * What a warm entry serves before any request: the payload's answer while
 * hydrating (whatever it is — the server rendered it, and the client must
 * render the same), and only a *successful* one afterwards. A failed
 * outcome cached from a previous screen would open the next one on an
 * error notice before its own request had a chance; it starts cold instead.
 *
 * Only the *initial* read of a screen is served from the cache. Nuxt
 * consults this on every `refresh()` too (`granularCachedData`), and a
 * cache hit there would turn `load()`'s revalidation into a no-op.
 */
function cachedOutcome<T>(key: string, nuxtApp: NuxtApp, ctx: CacheContext): ApiReadOutcome<T> | null | undefined {
  if (ctx.cause !== 'initial') return undefined;
  const payload = nuxtApp.payload.data as Record<string, unknown>;
  const stashed = nuxtApp.static.data as Record<string, unknown>;
  const cached = (payload[key] ?? stashed[key]) as ApiReadOutcome<T> | null | undefined;
  if (cached === undefined || cached === null) return undefined;
  if (nuxtApp.isHydrating || cached.ok) return cached;
  return undefined;
}

/**
 * One frame, so a screen that already has its answer paints it before the
 * refresh behind it is even dispatched. A hidden tab paints no frame, and
 * its refresh waits until it is looked at. Outside a browser, no wait.
 */
function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * The read layer: `useAsyncData` under a stable key, with the answer kept
 * in the Nuxt payload so a screen the person comes back to renders from
 * memory and refreshes behind the content, and — when the server can
 * authenticate — the answer server-rendered into the document itself.
 *
 * The composables on top of this (`usePageRead`, `useWorkspaceActivity`,
 * `usePageHistory`, …) keep their own status and error mapping; this
 * decides only where an answer lives and when it is fetched:
 *
 * - **Server**: fetched during SSR when the request carries a session
 *   cookie (`ssrCanAuthenticate`), so the read screen's article is in the
 *   HTML. A `401` there, or no response at all, is recorded as `null` —
 *   "nothing known" — rather than cached: the browser may well be able to
 *   authenticate where the server could not, and it fetches on mount.
 * - **Client, hydrating**: the payload's answer, no request.
 * - **Client, navigating**: a cached success renders at once; `load()`
 *   then revalidates in the background, after the next frame, with the
 *   old answer still on screen (`pending` beside `outcome`, never a
 *   skeleton over it).
 * - **Invalidation**: a write clears the keys it stales with
 *   `clearNuxtData` (`useSavePage`), and the next screen starts cold.
 *
 * `dedupe: 'defer'` shares one in-flight request between a screen's own
 * start and the `load()` it calls on mount.
 */
export function useApiRead<T>(key: string, run: () => Promise<T>, options: UseApiReadOptions = {}): UseApiReadResult<T> {
  const nuxtApp = useNuxtApp();
  // Nuxt binds a handler to a key once, for as long as the entry lives —
  // a second composable for the same key would run the first one's
  // fetcher. Every caller for a key fetches the same request, so the
  // latest fetcher is always the right one; per app, never module-level,
  // since on the server one module serves every request.
  const runners = ((nuxtApp as { _dwReadRunners?: Record<string, () => Promise<unknown>> })._dwReadRunners ??= {});
  runners[key] = run;

  async function settle(): Promise<ApiReadOutcome<T> | null> {
    try {
      return { ok: true, value: (await runners[key]!()) as T };
    } catch (error) {
      const status = httpStatusOf(error);
      if (import.meta.server && (status === undefined || status === 401)) return null;
      return { ok: false, status };
    }
  }

  // Whether the server answered this key before the document left it.
  // A key the server never fetched is `undefined` in the payload; one it
  // fetched is an outcome or `null`. The client must mirror the server's
  // choice exactly: Nuxt marks a component that prefetches as an async
  // boundary on both sides, which is what keeps `useId()` in step between
  // them — mirror it on one side only and every generated id after this
  // screen's setup hydrates against a different one.
  const payload = nuxtApp.payload.data as Record<string, unknown>;
  const prefetchedOnServer = import.meta.client && nuxtApp.isHydrating && payload[key] !== undefined;

  const { data, status, refresh } = useAsyncData<ApiReadOutcome<T> | null>(key, settle, {
    server: import.meta.server ? (options.server ?? true) && ssrCanAuthenticate() : !nuxtApp.isHydrating || prefetchedOnServer,
    // Inside a screen the read starts with the screen (the screen's own
    // `load()` on mount joins the same request); a bare call, as a test
    // makes, waits for `load()`.
    immediate: import.meta.server || getCurrentInstance() !== null,
    dedupe: 'defer',
    getCachedData: (cacheKey, app, ctx) => cachedOutcome<T>(cacheKey, app, ctx),
  });

  const outcome = computed<ApiReadOutcome<T> | null>(() => data.value ?? null);
  const pending = computed(() => status.value === 'pending');

  async function load(): Promise<void> {
    if (outcome.value !== null) {
      if (nuxtApp.isHydrating) return;
      await nextFrame();
    }
    await refresh();
  }

  return { outcome, pending, load };
}

/** The status every read composable derives before its own failure states. */
export type ReadStatus<Failure extends string> = 'idle' | 'loading' | 'success' | Failure;

/**
 * A composable's status over a read: `idle` before anything is known,
 * `loading` while the first answer is in flight, `success` once one
 * arrived, and — for a failed outcome — whatever `failure` maps the HTTP
 * status to (that mapping is each composable's own contract: `usePageRead`
 * tells 403 from 404, `usePageHistory` deliberately does not). A refresh
 * behind an answer already on screen is not `loading`: the answer stays.
 *
 * Writable, so a screen can settle a status itself without a request
 * (`diff.vue` marks a URL with no revision ids `not-found`); the override
 * holds until the next answer arrives.
 */
export function useReadStatus<Failure extends string>(
  read: UseApiReadResult<unknown>,
  failure: (status: number | undefined) => Failure,
): WritableComputedRef<ReadStatus<Failure>> {
  const derived = computed<ReadStatus<Failure>>(() => {
    const outcome = read.outcome.value;
    if (outcome === null) return read.pending.value ? 'loading' : 'idle';
    return outcome.ok ? 'success' : failure(outcome.status);
  });
  const override = ref<ReadStatus<Failure> | null>(null) as Ref<ReadStatus<Failure> | null>;
  watch(derived, () => {
    override.value = null;
  });
  return computed<ReadStatus<Failure>>({
    get: () => override.value ?? derived.value,
    set: (value) => {
      override.value = value;
    },
  });
}
