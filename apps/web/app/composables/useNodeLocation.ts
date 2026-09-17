import type { NodeLocationResponse, NodeWorkspace } from '@deep-wiki/contracts';
import { nodeLocationKey } from '~/utils/api-keys';

/**
 * Where a node screen says its node lives, from its own response. The six
 * node responses name their workspace by id and slug
 * (`NodeWorkspaceSchema`, 2026-09-17), so the screen tells `AppShell`
 * and the shell asks nothing more: `pending` while the read is on its
 * way, `located` once it answers, `unknown` when it will not — refused,
 * absent, failed — and the screen answers that itself. `nodeLocationOf`
 * builds it from a read's status and the workspace pair its value names.
 */
export type NodeLocation =
  | { readonly state: 'pending' }
  | { readonly state: 'located'; readonly workspace: NodeWorkspace }
  | { readonly state: 'unknown' };

const PENDING: NodeLocation = { state: 'pending' };
const UNKNOWN: NodeLocation = { state: 'unknown' };

export function nodeLocationOf(status: string, workspace: NodeWorkspace | null | undefined): NodeLocation {
  if (workspace) return { state: 'located', workspace };
  return status === 'idle' || status === 'loading' ? PENDING : UNKNOWN;
}

export type NodeLocationStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'unauthenticated' | 'network-error';

export type NodeLocationFetcher = (nodeId: string) => Promise<NodeLocationResponse>;

export interface UseNodeLocationResult {
  readonly status: ComputedRef<NodeLocationStatus>;
  /** Where the node lives, once known; `null` before, and for a node the API will not locate. */
  readonly location: ComputedRef<NodeLocationResponse | null>;
  readonly load: () => Promise<void>;
}

/**
 * `GET /nodes/:id/location` — which workspace a node lives in, by id and
 * by slug. The address `/w/<slug>/p/<id>` names a place twice, and the
 * two must agree: `AppShell` shows not-found when the slug is not the
 * node's, so a hand-edited or mis-pasted address cannot show a page under
 * another workspace's name.
 *
 * Since 2026-09-17 a node screen's own response names the workspace
 * (`NodeLocation` above) and the shell asks this for nothing; it stays
 * for a screen about a node whose response does not — none today — and
 * the endpoint itself for the legacy redirect (`middleware/legacy-routes.ts`),
 * which has no screen response to read it from. Before, it ran beside
 * every node screen's read: one request more per screen, and the edit
 * route's budget of 500 measured 501.
 *
 * In the read layer (`useApiRead`) under `nodeLocationKey`: answered on
 * the server beside the page, kept across screens — a node's workspace
 * never changes. Absence and denial are one 404 here by the route's own
 * contract, so this composable has no `forbidden`; the screen inside
 * keeps its own, more honest, answer for a direct request.
 */
export function useNodeLocation(nodeId: string | null, fetcher?: NodeLocationFetcher): UseNodeLocationResult {
  if (nodeId === null) {
    return { status: computed(() => 'idle'), location: computed(() => null), load: async () => {} };
  }
  const get =
    fetcher ??
    ((id: string) => {
      const api = useApiClient();
      return api<NodeLocationResponse>(`/nodes/${id}/location`);
    });

  const read = useApiRead<NodeLocationResponse>(nodeLocationKey(nodeId), () => get(nodeId));
  const status = useReadStatus(read, (code) => {
    if (code === 401) return 'unauthenticated';
    if (code === 404) return 'not-found';
    return 'network-error';
  });
  const location = computed(() => (read.outcome.value?.ok ? read.outcome.value.value : null));

  return { status: computed(() => status.value), location, load: read.load };
}
