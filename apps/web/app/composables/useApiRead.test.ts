import { beforeAll, describe, expect, test, vi } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { clearNuxtData, useNuxtApp } from '#imports';
import { useApiRead, useReadStatus, type UseApiReadResult } from './useApiRead';

/**
 * The read layer every read composable stands on: one `useAsyncData` entry
 * per stable key, the answer kept in the Nuxt payload across screens, a
 * background refresh that never blanks what is already on screen.
 *
 * Keys are unique per test: an entry is app-wide by design (that is the
 * cache), so two tests sharing a key would share an answer. `open` runs the
 * composable inside an effect scope the way a screen's `setup` does, and
 * `leave` stops that scope the way leaving the screen unmounts it — the
 * entry then re-reads the payload on the next screen, which is the path
 * under test.
 */
/** The frame `load()` lets paint before a refresh behind an answer on screen. */
function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function open<T>(key: string, run: () => Promise<T>): { read: UseApiReadResult<T>; leave: () => void } {
  const scope = effectScope();
  const read = scope.run(() => useApiRead(key, run))!;
  return { read, leave: () => scope.stop() };
}

describe('useApiRead', () => {
  // The test app never leaves hydration on its own (there is no server
  // render to resolve): every test below is a client-side navigation unless
  // it says otherwise.
  beforeAll(() => {
    useNuxtApp().isHydrating = false;
  });

  test('starts without an outcome and settles a successful fetch into one', async () => {
    const run = vi.fn(async () => ({ title: 'One' }));
    const { read } = open('api-read:success', run);

    expect(read.outcome.value).toBeNull();
    expect(read.pending.value).toBe(false);

    const promise = read.load();
    expect(read.pending.value).toBe(true);
    await promise;

    expect(read.pending.value).toBe(false);
    expect(read.outcome.value).toEqual({ ok: true, value: { title: 'One' } });
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('a response with a status settles into a failed outcome carrying that status, never a thrown error', async () => {
    const { read } = open('api-read:403', async () => {
      throw { response: { status: 403 } };
    });

    await read.load();

    expect(read.outcome.value).toEqual({ ok: false, status: 403 });
  });

  test('a failure with no response settles into a failed outcome with no status', async () => {
    const { read } = open('api-read:network', async () => {
      throw new Error('fetch failed');
    });

    await read.load();

    expect(read.outcome.value).toEqual({ ok: false, status: undefined });
  });

  // The cache: the next screen asking for the same key reads the payload
  // back and has its answer before anything is fetched.
  test('a second call with a warm payload has the outcome at once and does not fetch', async () => {
    const first = vi.fn(async () => ({ title: 'Warm' }));
    const warm = open('api-read:warm', first);
    await warm.read.load();
    warm.leave();
    expect(first).toHaveBeenCalledTimes(1);

    const second = vi.fn(async () => ({ title: 'Never' }));
    const { read } = open('api-read:warm', second);

    expect(read.outcome.value).toEqual({ ok: true, value: { title: 'Warm' } });
    expect(read.pending.value).toBe(false);
    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
  });

  // Stale-while-revalidate: `load()` on a warm entry fetches again in the
  // background, and the cached answer stays in place until the new one lands.
  test('load() on a warm entry refetches without dropping the cached outcome meanwhile', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const run = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { title: 'First' };
      await held;
      return { title: 'Second' };
    });
    const { read } = open('api-read:revalidate', run);
    await read.load();

    const refresh = read.load();
    // The answer on screen paints first: nothing leaves until the next frame.
    expect(read.pending.value).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    await frame();
    expect(read.pending.value).toBe(true);
    expect(read.outcome.value).toEqual({ ok: true, value: { title: 'First' } });

    release();
    await refresh;
    expect(read.outcome.value).toEqual({ ok: true, value: { title: 'Second' } });
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('concurrent loads share one request', async () => {
    const run = vi.fn(async () => ({ title: 'Once' }));
    const { read } = open('api-read:dedupe', run);

    await Promise.all([read.load(), read.load(), read.load()]);

    expect(run).toHaveBeenCalledTimes(1);
  });

  // A failed answer is not worth keeping: the next screen that asks starts
  // clean and fetches, rather than opening on yesterday's error notice.
  test('a failed outcome is not served from the cache to a later screen', async () => {
    const failed = open('api-read:failed-once', async () => {
      throw { response: { status: 404 } };
    });
    await failed.read.load();
    failed.leave();

    const run = vi.fn(async () => ({ title: 'Back' }));
    const { read } = open('api-read:failed-once', run);

    expect(read.outcome.value).toBeNull();
    await read.load();
    expect(read.outcome.value).toEqual({ ok: true, value: { title: 'Back' } });
  });

  // Hydration: the server's answer is the answer. The screen's mount-time
  // `load()` must not send the same request the server just did.
  test('load() during hydration keeps the payload outcome and does not fetch', async () => {
    const nuxtApp = useNuxtApp();
    const server = open('api-read:hydrating', async () => ({ title: 'Server' }));
    await server.read.load();
    server.leave();

    const run = vi.fn(async () => ({ title: 'Client' }));
    const { read } = open('api-read:hydrating', run);
    nuxtApp.isHydrating = true;
    try {
      await read.load();
    } finally {
      nuxtApp.isHydrating = false;
    }

    expect(run).not.toHaveBeenCalled();
    expect(read.outcome.value).toEqual({ ok: true, value: { title: 'Server' } });
  });

  test('load() during hydration with nothing in the payload fetches', async () => {
    const nuxtApp = useNuxtApp();
    const run = vi.fn(async () => ({ title: 'Client' }));
    const { read } = open('api-read:hydrating-empty', run);
    nuxtApp.isHydrating = true;
    try {
      await read.load();
    } finally {
      nuxtApp.isHydrating = false;
    }

    expect(run).toHaveBeenCalledTimes(1);
    expect(read.outcome.value).toEqual({ ok: true, value: { title: 'Client' } });
  });

  // Invalidation: a write clears the key; the next screen starts cold.
  test('clearNuxtData on the key empties the cache so the next screen fetches', async () => {
    const first = vi.fn(async () => ({ title: 'Before' }));
    const before = open('api-read:cleared', first);
    await before.read.load();
    before.leave();

    clearNuxtData('api-read:cleared');

    const second = vi.fn(async () => ({ title: 'After' }));
    const { read } = open('api-read:cleared', second);
    expect(read.outcome.value).toBeNull();
    await read.load();
    expect(second).toHaveBeenCalledTimes(1);
    expect(read.outcome.value).toEqual({ ok: true, value: { title: 'After' } });
  });
});

describe('useReadStatus', () => {
  beforeAll(() => {
    useNuxtApp().isHydrating = false;
  });

  test('is idle, then loading, then success, and maps a failed outcome through the composable\'s own rule', async () => {
    const { read } = open('read-status:flow', async () => {
      throw { response: { status: 404 } };
    });
    const status = useReadStatus(read, (code) => (code === 404 ? 'not-found' : 'network-error'));

    expect(status.value).toBe('idle');
    const promise = read.load();
    expect(status.value).toBe('loading');
    await promise;
    expect(status.value).toBe('not-found');
  });

  test('a refresh behind an answer on screen is not loading', async () => {
    let calls = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { read } = open('read-status:refresh', async () => {
      calls += 1;
      if (calls > 1) await held;
      return { n: calls };
    });
    const status = useReadStatus(read, () => 'network-error');
    await read.load();

    const refresh = read.load();
    await frame();
    expect(read.pending.value).toBe(true);
    expect(status.value).toBe('success');
    release();
    await refresh;
  });

  test('a screen can write the status, and the next answer clears the override', async () => {
    const { read } = open('read-status:override', async () => ({ ok: 1 }));
    const status = useReadStatus(read, (): 'network-error' | 'not-found' => 'network-error');

    status.value = 'not-found';
    expect(status.value).toBe('not-found');

    await read.load();
    await nextTick();
    expect(status.value).toBe('success');
  });
});
