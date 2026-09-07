export type TreeStatus = 'idle' | 'loading' | 'success' | 'forbidden' | 'not-found' | 'network-error';

export interface TreeNode {
  readonly id: string;
  readonly type: string;
  readonly slug: string;
  readonly title: string;
  readonly position: number;
  readonly children: readonly TreeNode[];
}

export type FetchTree = (workspaceId: string) => Promise<{ rootId: string; nodes: readonly TreeNode[] }>;
export type ReorderFetcher = (nodeId: string, newParentId: string, newIndex: number) => Promise<{ ok: boolean }>;

interface ResponseError {
  readonly response: { readonly status?: number };
}

function isResponseError(error: unknown): error is ResponseError {
  return typeof error === 'object' && error !== null && 'response' in error;
}

export interface UseTreeDeps {
  readonly fetchTree?: FetchTree;
  readonly reorderFetcher?: ReorderFetcher;
}

export interface UseTreeResult {
  readonly status: Ref<TreeStatus>;
  readonly nodes: Ref<readonly TreeNode[]>;
  readonly rootId: Ref<string | null>;
  readonly message: Ref<string>;
  readonly load: () => Promise<void>;
  /** Returns whether the reorder succeeded; the tree is only reloaded on success, so a rejected drag never has to be manually reverted. */
  readonly reorder: (nodeId: string, newParentId: string, newIndex: number) => Promise<boolean>;
}

/**
 * `GET /workspaces/:id/tree` + `PATCH /nodes/:id/position`
 * (navigation-tree spec: "Tree Displays Only Readable Nodes", "Drag
 * Reorder Writes Back To Position", "Reordering Requires Write Or Manage
 * Permission"). The tree endpoint already filters through `can()`
 * server-side — this composable adds no client-side filtering — and a
 * reorder the server rejects (no write grant, cross-workspace target)
 * never touches local state, so a denied drag visibly snaps back rather
 * than looking like it silently succeeded.
 */
export function useTree(workspaceId: string, deps: UseTreeDeps = {}): UseTreeResult {
  const config = useRuntimeConfig();
  const fetchTree: FetchTree =
    deps.fetchTree ?? ((ws) => $fetch(`${config.public.apiBaseUrl}/workspaces/${ws}/tree`, { credentials: 'include' }));
  const reorderFetcher: ReorderFetcher =
    deps.reorderFetcher ??
    ((nodeId, newParentId, newIndex) =>
      $fetch(`${config.public.apiBaseUrl}/nodes/${nodeId}/position`, {
        method: 'PATCH',
        credentials: 'include',
        body: { newParentId, newIndex },
      }));

  const status = ref<TreeStatus>('idle');
  const nodes = ref<readonly TreeNode[]>([]);
  const rootId = ref<string | null>(null);
  const message = ref('');

  async function load(): Promise<void> {
    status.value = 'loading';
    try {
      const result = await fetchTree(workspaceId);
      nodes.value = result.nodes;
      rootId.value = result.rootId;
      status.value = 'success';
      message.value = '';
    } catch (error) {
      if (!isResponseError(error)) {
        status.value = 'network-error';
        message.value = 'Cannot reach the server. Check your connection and try again.';
        return;
      }
      const code = error.response.status;
      if (code === 403) {
        status.value = 'forbidden';
        message.value = "You don't have access to this workspace's tree.";
      } else if (code === 404) {
        status.value = 'not-found';
        message.value = 'This workspace does not exist.';
      } else {
        status.value = 'network-error';
        message.value = 'Cannot reach the server. Check your connection and try again.';
      }
    }
  }

  async function reorder(nodeId: string, newParentId: string, newIndex: number): Promise<boolean> {
    try {
      await reorderFetcher(nodeId, newParentId, newIndex);
      await load();
      return true;
    } catch {
      return false;
    }
  }

  return { status, nodes, rootId, message, load, reorder };
}
