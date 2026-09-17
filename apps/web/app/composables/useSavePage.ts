import { keysStaledBySave } from '~/utils/api-keys';

export type SavePageStatus = 'idle' | 'saving' | 'success' | 'stale' | 'not-canonical' | 'dead-anchor' | 'forbidden' | 'network-error';

export type SavePageFetcher = (nodeId: string, markdown: string, expectedContentHash: string | null) => Promise<{ contentHash: string; unchanged?: boolean }>;

/** One retired block anchor the save would have reintroduced (page-content spec / `DeadAnchorError`). */
export interface DeadAnchorInfo {
  readonly id: string;
  readonly status: 'tombstoned' | 'superseded';
}

export interface UseSavePageResult {
  readonly status: Ref<SavePageStatus>;
  readonly contentHash: Ref<string | null>;
  readonly canonical: Ref<string | null>;
  readonly corrected: Ref<string | null>;
  readonly anchors: Ref<readonly DeadAnchorInfo[]>;
  readonly message: Ref<string>;
  readonly save: (markdown: string, expectedContentHash: string | null) => Promise<void>;
}

/**
 * `PUT /pages/:id` (page-content spec: optimistic concurrency, D16).
 * `stale` (a concurrent save already happened), `not-canonical` (the
 * document is not its own fixed point, D1) and `dead-anchor` (the save
 * reintroduces a retired block anchor — `DeadAnchorError`, docs/TODO.md
 * Findings) are all 409s but three distinct, actionable states — a stale
 * save must reload before retrying, a not-canonical one is offered the
 * canonical text back, and a dead-anchor one is offered the document with
 * the retired anchor(s) stripped — rather than a bare "conflict" message.
 * The three are discriminated on the response's `error` field, never by
 * which of `canonical`/`corrected` happens to be present, so an
 * unrecognised `error` value (or a body without one) falls to `stale`
 * exactly as it did before this distinction existed — it does not invent
 * a fourth classification. Neither ever discards the caller's in-memory
 * buffer; that decision belongs to the page component, not this
 * composable.
 */
export function useSavePage(nodeId: string, fetcher?: SavePageFetcher): UseSavePageResult {
  const put =
    fetcher ??
    ((id: string, markdown: string, expectedContentHash: string | null) => {
      const api = useApiClient();
      return api<{ contentHash: string; unchanged: boolean }>(`/pages/${id}`, { method: 'PUT', body: { markdown, expectedContentHash } });
    });

  const status = ref<SavePageStatus>('idle');
  const contentHash = ref<string | null>(null);
  const canonical = ref<string | null>(null);
  const corrected = ref<string | null>(null);
  const anchors = ref<readonly DeadAnchorInfo[]>([]);
  const message = ref('');

  async function save(markdown: string, expectedContentHash: string | null): Promise<void> {
    status.value = 'saving';
    message.value = 'Saving…';

    try {
      const result = await put(nodeId, markdown, expectedContentHash);
      // `unchanged`: the bytes sent were the bytes stored, so the server
      // wrote nothing and minted no revision (revision-history spec via
      // `savePage()`). What is cached is still what is stored, and
      // "Saved." would confirm a revision that does not exist
      // (docs/UI-CHECKLIST.md §3, "Success — specifically").
      if (!result.unchanged) {
        // The read layer (`useApiRead`) keeps this page, its history and the
        // lists a new revision appears in; the next screen must fetch them.
        clearNuxtData(keysStaledBySave(nodeId));
      }
      contentHash.value = result.contentHash;
      canonical.value = null;
      corrected.value = null;
      anchors.value = [];
      status.value = 'success';
      message.value = result.unchanged ? 'Nothing changed since the last save.' : 'Saved.';
    } catch (error) {
      const code = httpStatusOf(error);
      if (code === 403) {
        status.value = 'forbidden';
        message.value = "You don't have permission to save this page anymore.";
      } else if (code === 409) {
        // Discriminate on `body.error` — the field the server actually
        // uses to distinguish its three 409 shapes — rather than on which
        // of `canonical`/`corrected` happens to be present. A bodyless 409
        // (docs/TODO.md Open Questions: "What a bodyless 409 should
        // mean") throws here on `body.error`, exactly as it threw on
        // `body.canonical` before this change: that failure mode is
        // unchanged, not a new one, and is not resolved in this branch.
        const body = responseBodyOf(error) as { error?: string; canonical?: string; corrected?: string; anchors?: readonly DeadAnchorInfo[] };
        if (body.error === 'not canonical' && typeof body.canonical === 'string') {
          canonical.value = body.canonical;
          status.value = 'not-canonical';
          message.value = 'This document is not in its canonical form.';
        } else if (body.error === 'dead anchor' && typeof body.corrected === 'string') {
          corrected.value = body.corrected;
          anchors.value = body.anchors ?? [];
          status.value = 'dead-anchor';
          message.value =
            'The pasted content carries an anchor for a block that was deleted or merged, so nothing was saved. Use the corrected document, with that anchor removed, to continue.';
        } else {
          status.value = 'stale';
          message.value = 'Someone else saved a newer version. Reload before saving again.';
        }
      } else {
        status.value = 'network-error';
        message.value = 'Cannot reach the server. Your changes are kept in this tab — try saving again.';
      }
    }
  }

  return { status, contentHash, canonical, corrected, anchors, message, save };
}
