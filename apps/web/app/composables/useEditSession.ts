export type EditSessionStatus = 'idle' | 'loading' | 'ready' | 'refused' | 'locked' | 'forbidden' | 'not-found' | 'network-error';

export interface EditSessionReady {
  readonly markdown: string;
  readonly title: string;
  readonly workspaceId: string;
  readonly lock: { readonly holderUserId: string; readonly acquiredAt: string; readonly heartbeatAt: string };
}

export interface EditSessionRefusal {
  readonly reason: 'unsupported_construct' | 'not_byte_identical' | 'locked';
  readonly construct?: string;
  readonly line?: number;
  readonly holder?: { readonly userId: string; readonly acquiredAt: string; readonly heartbeatAt: string };
  readonly offeredExits: readonly ('read_only' | 'normalise' | 'take_over')[];
}

export type EditSessionFetcher = (nodeId: string) => Promise<EditSessionReady>;

export interface UseEditSessionResult {
  readonly status: Ref<EditSessionStatus>;
  readonly session: Ref<EditSessionReady | null>;
  readonly refusal: Ref<EditSessionRefusal | null>;
  readonly message: Ref<string>;
  readonly load: () => Promise<void>;
  readonly takeOver: () => Promise<void>;
}

/**
 * `GET /pages/:id/edit-session` (document-modes spec: the probe-and-lock
 * request; "Take Over" transfers via a second, explicit call to
 * `POST /pages/:id/lock/take-over`). `locked` and `refused` are two
 * distinct states, never folded into one generic "409" — a refused
 * document (setext heading, indented code) and a page someone else is
 * editing have different exits and different UI (document-modes: "Take
 * Over And Open Read-Only Are Always Both Offered" only applies to the
 * `locked` case).
 */
export function useEditSession(nodeId: string, fetcher?: EditSessionFetcher, takeOverFetcher?: EditSessionFetcher): UseEditSessionResult {
  const config = useRuntimeConfig();
  const get =
    fetcher ??
    ((id: string) => $fetch<EditSessionReady>(`${config.public.apiBaseUrl}/pages/${id}/edit-session`, { credentials: 'include' }));
  const postTakeOver =
    takeOverFetcher ??
    ((id: string) => $fetch<EditSessionReady>(`${config.public.apiBaseUrl}/pages/${id}/lock/take-over`, { method: 'POST', credentials: 'include' }));

  const status = ref<EditSessionStatus>('idle');
  const session = ref<EditSessionReady | null>(null);
  const refusal = ref<EditSessionRefusal | null>(null);
  const message = ref('');

  function applyResult(result: EditSessionReady): void {
    session.value = result;
    refusal.value = null;
    status.value = 'ready';
    message.value = '';
  }

  function applyFailure(error: unknown): void {
    const code = httpStatusOf(error);
    if (code === 403) {
      status.value = 'forbidden';
      message.value = "You don't have access to edit this page.";
    } else if (code === 404) {
      status.value = 'not-found';
      message.value = 'This page does not exist.';
    } else if (code === 409) {
      const body = responseBodyOf(error) as EditSessionRefusal;
      refusal.value = body;
      status.value = body.reason === 'locked' ? 'locked' : 'refused';
    } else {
      status.value = 'network-error';
      message.value = 'Cannot reach the server. Check your connection and try again.';
    }
  }

  async function load(): Promise<void> {
    status.value = 'loading';
    try {
      applyResult(await get(nodeId));
    } catch (error) {
      applyFailure(error);
    }
  }

  async function takeOver(): Promise<void> {
    status.value = 'loading';
    try {
      applyResult(await postTakeOver(nodeId));
    } catch (error) {
      applyFailure(error);
    }
  }

  return { status, session, refusal, message, load, takeOver };
}
