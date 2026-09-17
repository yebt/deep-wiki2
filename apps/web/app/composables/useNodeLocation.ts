import type { NodeLocationResponse } from '@deep-wiki/contracts';
import { nodeLocationKey } from '~/utils/api-keys';

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
 * two must agree: `AppShell` asks this beside the screen's own read and
 * shows not-found when the slug is not the node's, so a hand-edited or
 * mis-pasted address cannot show a page under another workspace's name.
 *
 * In the read layer (`useApiRead`) under `nodeLocationKey`: answered on
 * the server beside the page, kept across screens — a node's workspace
 * never changes — and never a request that delays the screen's own, since
 * the two run side by side. Absence and denial are one 404 here by the
 * route's own contract, so this composable has no `forbidden`; the screen
 * inside keeps its own, more honest, answer for a direct request.
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
