/**
 * `GET /workspaces` — the list of workspaces this caller may open, which
 * is where navigation into the product begins.
 *
 * The endpoint filters through `can()` server-side; this composable adds
 * no client-side filtering, and there is nothing here that decides what
 * may be seen. A workspace the caller cannot read never arrives.
 *
 * **Reading none is a success, not an error.** `{ workspaces: [] }` comes
 * back with a 200 and lands in `success` with an empty list, so the screen
 * renders its "nothing here" state rather than a failure. This is the
 * normal state of a member who has been invited and not yet granted
 * anything, and reporting it as a fault would be both wrong and alarming.
 *
 * `401` is its own state rather than another network error, because the
 * user's next action differs: sign in, not retry.
 */
export type WorkspaceListStatus = 'idle' | 'loading' | 'success' | 'unauthenticated' | 'network-error';

export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export type FetchWorkspaces = () => Promise<{ workspaces: readonly WorkspaceSummary[] }>;

interface ResponseError {
  readonly response: { readonly status?: number };
}

function isResponseError(error: unknown): error is ResponseError {
  return typeof error === 'object' && error !== null && 'response' in error;
}

export interface UseWorkspacesDeps {
  readonly fetchWorkspaces?: FetchWorkspaces;
}

export interface UseWorkspacesResult {
  readonly status: Ref<WorkspaceListStatus>;
  readonly workspaces: Ref<readonly WorkspaceSummary[]>;
  readonly message: Ref<string>;
  readonly load: () => Promise<void>;
}

export function useWorkspaces(deps: UseWorkspacesDeps = {}): UseWorkspacesResult {
  const config = useRuntimeConfig();
  const fetchWorkspaces: FetchWorkspaces =
    deps.fetchWorkspaces ?? (() => $fetch(`${config.public.apiBaseUrl}/workspaces`, { credentials: 'include' }));

  const status = ref<WorkspaceListStatus>('idle');
  const workspaces = ref<readonly WorkspaceSummary[]>([]);
  const message = ref('');

  async function load(): Promise<void> {
    status.value = 'loading';
    try {
      const result = await fetchWorkspaces();
      workspaces.value = result.workspaces;
      status.value = 'success';
      message.value = '';
    } catch (error) {
      workspaces.value = [];
      if (isResponseError(error) && error.response.status === 401) {
        status.value = 'unauthenticated';
        message.value = 'Your session has ended.';
        return;
      }
      status.value = 'network-error';
      message.value = 'Cannot reach the server. Check your connection and try again.';
    }
  }

  return { status, workspaces, message, load };
}
