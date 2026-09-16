import { mentionedIdsIn, type ConfirmedMention } from '../utils/mention-trigger';

/** What a new thread is about: the block, the selection inside it if any, and the text to show while the server answers. */
export interface NewThreadTarget {
  readonly blockId: string;
  /** The visible text the reader selected; `null` for a comment on the block as a whole. */
  readonly quote: string | null;
  /** What the provisional thread quotes meanwhile — the selection, or the block's own visible text. */
  readonly excerpt: string;
}

export interface NewThreadRequest extends NewThreadTarget {
  readonly body: string;
  readonly mentionedUserIds: readonly string[];
}

export type NewThreadStatus = 'closed' | 'composing' | 'posting' | 'failed';

export interface UseNewThreadDeps {
  /** `usePageComments().create` — the optimistic write; `ok: false` means the composer stays open. */
  readonly create: (input: NewThreadRequest) => Promise<{ readonly ok: boolean; readonly blockId?: string }>;
}

export interface UseNewThreadResult {
  readonly status: Ref<NewThreadStatus>;
  readonly target: Ref<NewThreadTarget | null>;
  readonly body: Ref<string>;
  /** Mentions confirmed from the menu; only those still named in `body` are sent. */
  readonly mentions: Ref<ConfirmedMention[]>;
  readonly canPost: ComputedRef<boolean>;
  readonly begin: (target: NewThreadTarget) => void;
  readonly cancel: () => void;
  readonly post: () => Promise<boolean>;
}

/**
 * The composer's state machine, apart from any markup (docs/UI-CHECKLIST.md
 * §3): closed → composing (from a gutter "+", a selection's "Comment", or
 * the panel) → posting → closed on success, or → failed with the text
 * kept, so a retry posts what the person wrote. `begin` while composing
 * retargets and keeps the draft — moving the cursor to another paragraph
 * should not throw away a sentence; `begin` while posting is ignored,
 * because the post in flight is about the earlier target.
 */
export function useNewThread(deps: UseNewThreadDeps): UseNewThreadResult {
  const status = ref<NewThreadStatus>('closed');
  const target = ref<NewThreadTarget | null>(null);
  const body = ref('');
  const mentions = ref<ConfirmedMention[]>([]);

  const canPost = computed(() => status.value !== 'posting' && body.value.trim().length > 0 && target.value !== null);

  function begin(next: NewThreadTarget): void {
    if (status.value === 'posting') return;
    target.value = next;
    status.value = 'composing';
  }

  function cancel(): void {
    status.value = 'closed';
    target.value = null;
    body.value = '';
    mentions.value = [];
  }

  async function post(): Promise<boolean> {
    if (!canPost.value || !target.value) return false;
    status.value = 'posting';
    const outcome = await deps.create({
      ...target.value,
      body: body.value.trim(),
      mentionedUserIds: mentionedIdsIn(body.value, mentions.value),
    });
    if (!outcome.ok) {
      status.value = 'failed';
      return false;
    }
    cancel();
    return true;
  }

  return { status, target, body, mentions, canPost, begin, cancel, post };
}
