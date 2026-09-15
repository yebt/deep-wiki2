import type { WorkspaceActivityResponse } from '@deep-wiki/contracts';

export type { WorkspaceActivityResponse } from '@deep-wiki/contracts';

export type WorkspaceActivityStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'network-error';

export type WorkspaceActivityFetcher = (workspaceId: string) => Promise<WorkspaceActivityResponse>;

export interface UseWorkspaceActivityResult {
  readonly status: Ref<WorkspaceActivityStatus>;
  readonly workspaceName: Ref<string>;
  readonly recent: Ref<WorkspaceActivityResponse['recent']>;
  readonly mine: Ref<WorkspaceActivityResponse['mine']>;
  readonly threads: Ref<WorkspaceActivityResponse['threads']>;
  readonly message: Ref<string>;
  readonly load: () => Promise<void>;
}

/**
 * `GET /workspaces/:id/activity` — the dashboard's "what changed" and
 * "threads for you"; "who is here" is `usePresenceStream(null)`, the same
 * stream read and edit mode already open.
 *
 * Absence and denial collapse into one `not-found`, exactly as
 * `useBookHistory` does: the route answers both with a byte-identical 404,
 * and a distinct `forbidden` branch here would undo that on the one client
 * that happened to see a 403.
 */
export function useWorkspaceActivity(workspaceId: string, fetcher?: WorkspaceActivityFetcher): UseWorkspaceActivityResult {
  const get =
    fetcher ??
    ((id: string) => {
      const config = useRuntimeConfig();
      return $fetch<WorkspaceActivityResponse>(`${config.public.apiBaseUrl}/workspaces/${id}/activity`, { credentials: 'include' });
    });

  const status = ref<WorkspaceActivityStatus>('idle');
  const workspaceName = ref('');
  const recent = ref<WorkspaceActivityResponse['recent']>([]);
  const mine = ref<WorkspaceActivityResponse['mine']>([]);
  const threads = ref<WorkspaceActivityResponse['threads']>([]);
  const message = ref('');

  async function load(): Promise<void> {
    status.value = 'loading';
    try {
      const response = await get(workspaceId);
      workspaceName.value = response.workspace.name;
      recent.value = response.recent;
      mine.value = response.mine;
      threads.value = response.threads;
      status.value = 'success';
      message.value = '';
    } catch (error) {
      const code = httpStatusOf(error);
      if (code === 403 || code === 404) {
        status.value = 'not-found';
        message.value = 'This workspace does not exist.';
      } else {
        status.value = 'network-error';
        message.value = 'Cannot reach the server. Check your connection and try again.';
      }
    }
  }

  return { status, workspaceName, recent, mine, threads, message, load };
}
