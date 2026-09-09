export type LockHeartbeatStatus = 'idle' | 'ok' | 'lost' | 'network-error';

export type LockHeartbeatFetcher = (nodeId: string) => Promise<{ status: 'ok' | 'lost' }>;

/**
 * `PAGE_LOCK_HEARTBEAT_SECONDS` (packages/contracts/src/env.ts, mirrored
 * into env.example) is a server-side default this client has no runtime
 * config surface for yet; 20s matches that default exactly (design.md
 * "Heartbeat | `PATCH …/lock` every 20 s"). Recorded here rather than
 * silently duplicated: if the server default ever changes, this constant
 * needs updating with it until a public runtime-config value exists.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;

export interface UseLockHeartbeatOptions {
  readonly intervalMs?: number;
}

export interface UseLockHeartbeatResult {
  readonly status: Ref<LockHeartbeatStatus>;
  readonly start: () => Promise<void>;
  readonly stop: () => void;
}

/**
 * `PATCH /pages/:id/lock` (document-modes spec: "Heartbeat Keeps The
 * Lock Alive"). `start()` sends one heartbeat immediately (so the UI
 * knows the lock's fate without waiting a full interval) and then repeats
 * every `intervalMs`; `stop()` — called on unmount and on "lost" — clears
 * the timer so a displaced editor's tab does not keep silently polling.
 */
export function useLockHeartbeat(nodeId: string, fetcher?: LockHeartbeatFetcher, options: UseLockHeartbeatOptions = {}): UseLockHeartbeatResult {
  const config = useRuntimeConfig();
  const patch =
    fetcher ??
    ((id: string) => $fetch<{ status: 'ok' | 'lost' }>(`${config.public.apiBaseUrl}/pages/${id}/lock`, { method: 'PATCH', credentials: 'include' }));

  const status = ref<LockHeartbeatStatus>('idle');
  let timer: ReturnType<typeof setInterval> | undefined;

  async function beat(): Promise<void> {
    try {
      const result = await patch(nodeId);
      status.value = result.status;
      if (result.status === 'lost') stop();
    } catch {
      status.value = 'network-error';
    }
  }

  async function start(): Promise<void> {
    await beat();
    timer = setInterval(() => void beat(), options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  }

  function stop(): void {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  return { status, start, stop };
}
