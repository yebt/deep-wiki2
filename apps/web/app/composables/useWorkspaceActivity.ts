import type { WorkspaceActivityResponse } from '@deep-wiki/contracts';
import { workspaceActivityKey } from '~/utils/api-keys';

export type { WorkspaceActivityResponse } from '@deep-wiki/contracts';

export type WorkspaceActivityStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'unauthenticated' | 'network-error';

/** Asked by the workspace's id or, as the dashboard does from its address, by its slug (`apps/api/src/routes/workspace-ref.ts`). */
export type WorkspaceActivityFetcher = (workspaceRef: string) => Promise<WorkspaceActivityResponse>;

export interface UseWorkspaceActivityResult {
  readonly status: Ref<WorkspaceActivityStatus>;
  readonly workspaceName: ComputedRef<string>;
  /** The workspace as the response names it — id, name and slug — once known. */
  readonly workspace: ComputedRef<WorkspaceActivityResponse['workspace'] | null>;
  readonly recent: ComputedRef<WorkspaceActivityResponse['recent']>;
  readonly mine: ComputedRef<WorkspaceActivityResponse['mine']>;
  readonly threads: ComputedRef<WorkspaceActivityResponse['threads']>;
  readonly message: ComputedRef<string>;
  /** Fetch, or — with the dashboard already on screen — refresh behind it. */
  readonly load: () => Promise<void>;
}

/**
 * `GET /workspaces/:ref/activity` — the dashboard's "what changed" and
 * "threads for you"; "who is here" is `usePresenceStream(null)`, the same
 * stream read and edit mode already open.
 *
 * Absence and denial collapse into one `not-found`, exactly as
 * `useBookHistory` does: the route answers both with a byte-identical 404,
 * and a distinct `forbidden` branch here would undo that on the one client
 * that happened to see a 403.
 *
 * The answer lives in the read layer (`useApiRead`, keyed by
 * `workspaceActivityKey`): server-rendered when the request can be
 * authenticated, kept across screens so coming back to the dashboard
 * renders the lists from memory and refreshes behind them, and cleared by
 * `useSavePage` — a save is the newest "what changed".
 */
export function useWorkspaceActivity(workspaceRef: string, fetcher?: WorkspaceActivityFetcher): UseWorkspaceActivityResult {
  const get =
    fetcher ??
    ((ref: string) => {
      const api = useApiClient();
      return api<WorkspaceActivityResponse>(`/workspaces/${ref}/activity`);
    });

  const read = useApiRead<WorkspaceActivityResponse>(workspaceActivityKey(workspaceRef), () => get(workspaceRef));
  const status = useReadStatus(read, (code) => {
    // Signed out: the screen's next move is sign-in, not a retry
    // (`useSignInRedirect`). Only the browser ever sees it — a 401 during
    // the server's render is "nothing known" (useApiRead).
    if (code === 401) return 'unauthenticated';
    return code === 403 || code === 404 ? 'not-found' : 'network-error';
  });

  const value = computed(() => (read.outcome.value?.ok ? read.outcome.value.value : null));
  const workspace = computed(() => value.value?.workspace ?? null);
  const workspaceName = computed(() => workspace.value?.name ?? '');
  const recent = computed(() => value.value?.recent ?? []);
  const mine = computed(() => value.value?.mine ?? []);
  const threads = computed(() => value.value?.threads ?? []);
  const message = computed(() => {
    if (status.value === 'unauthenticated') return 'Your session has ended.';
    if (status.value === 'not-found') return 'This workspace does not exist.';
    if (status.value === 'network-error') return 'Cannot reach the server. Check your connection and try again.';
    return '';
  });

  return { status, workspaceName, workspace, recent, mine, threads, message, load: read.load };
}
