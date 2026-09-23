import type { RenamedNode } from './useTree';
import { classifyWriteRefusal } from './useTreeRowEditor';

/**
 * The page's own title, renamed where it is read (owner decision,
 * 2026-09-23: "El title, se edita y es el mismo title del page, como en
 * obsidian").
 *
 * ── One name, one path ─────────────────────────────────────────────────
 *
 * A page's title is `nodes.title` (docs/SPECS.md) and the way to change
 * it is `PATCH /nodes/:id` — the tree's own rename. This composable asks
 * it from the page instead of from the row, and classifies its refusals
 * with the tree's own `classifyWriteRefusal`, so the two surfaces cannot
 * drift into two rules about the same write. What is *not* here is any
 * notion of the title living in the markdown: the body is the document's
 * bytes and the title is the node's name, and moving one into the other
 * would rewrite the canonical bytes of every page in the workspace
 * (docs/TODO.md Open Questions, 2026-09-23).
 *
 * ── The state machine ──────────────────────────────────────────────────
 *
 *   closed ──start──▶ editing ──commit──▶ (optimistic: closed, new name)
 *      ▲                 ▲                          │
 *      └──cancel─────────┴────── refused (409) ◀─────┘
 *
 * The rename is **optimistic**, the way a dropped row is where it was
 * dropped before the server has answered (`useTree`): the new name is the
 * page's name at once, in the heading, the breadcrumb and the tab title
 * together. Only a refusal puts the old one back, and then:
 *
 * - **A duplicate sibling (409)** is fixed by typing, so the field comes
 *   back with the typed text still in it and the server's own sentence
 *   beside it — never a rename behind the person's back.
 * - **Anything else** — no permission, the node gone, a dead connection —
 *   cannot be fixed in that field, so the field stays closed and the
 *   reason stands under the heading.
 *
 * A refusal that arrives after the person has started typing again is
 * dropped: it is about a name they no longer have on screen.
 */

export type RenameFetcher = (nodeId: string, title: string) => Promise<RenamedNode>;

export interface UsePageTitleDeps {
  readonly nodeId: string;
  /** `PATCH /nodes/:id`. The tree's row editor issues the identical request from the row. */
  readonly rename?: RenameFetcher;
  /** Called with the server's answer, once, so the screen can patch the tree and stale the page's read. */
  readonly onRenamed?: (renamed: RenamedNode) => void;
}

export interface UsePageTitleResult {
  /** The field is open. */
  readonly editing: ComputedRef<boolean>;
  /** The text in the field. */
  readonly value: Ref<string>;
  /** The refusal to show: beside the field while it is open, under the heading when it is not. */
  readonly error: Ref<string | null>;
  /** A rename is in flight. */
  readonly saving: ComputedRef<boolean>;
  /** The name to draw, given the one the screen's own response carries. */
  readonly shownTitle: (stored: string) => string;
  readonly start: (current: string) => void;
  readonly setValue: (next: string) => void;
  readonly cancel: () => void;
  readonly commit: () => Promise<void>;
}

export function usePageTitle(deps: UsePageTitleDeps): UsePageTitleResult {
  const editing = ref(false);
  const saving = ref(false);
  const value = ref('');
  const error = ref<string | null>(null);
  /** The name the person gave, shown from the moment they gave it until a refusal takes it back. */
  const applied = ref<string | null>(null);
  /** The name the field opened on: a commit that matches it writes nothing. */
  const opened = ref('');

  /**
   * Which attempt a settled request belongs to. A refusal for a name the
   * person has moved on from must not reopen a field over the one they
   * are in.
   */
  let generation = 0;

  function renameNode(nodeId: string, title: string): Promise<RenamedNode> {
    if (deps.rename) return deps.rename(nodeId, title);
    const config = useRuntimeConfig();
    return $fetch(`${config.public.apiBaseUrl}/nodes/${nodeId}`, { method: 'PATCH', credentials: 'include', body: { title } });
  }

  function start(current: string): void {
    generation += 1;
    editing.value = true;
    saving.value = false;
    // The caller passes the name it is *showing* (`shownTitle`), which is
    // the optimistic one while a rename is in flight — so the field always
    // opens on the name the person can see.
    opened.value = current;
    value.value = current;
    error.value = null;
  }

  function setValue(next: string): void {
    value.value = next;
    // Typing clears the refusal: it was about the name that was sent.
    error.value = null;
  }

  function cancel(): void {
    generation += 1;
    editing.value = false;
    error.value = null;
  }

  async function commit(): Promise<void> {
    if (!editing.value) return;
    const title = value.value.trim();
    // A blank name writes nothing and keeps the field, as the tree's row
    // editor does: Enter on an empty box is not a request.
    if (title.length === 0) return;
    if (title === opened.value.trim()) {
      generation += 1;
      editing.value = false;
      error.value = null;
      return;
    }

    const mine = ++generation;
    const previous = applied.value;
    editing.value = false;
    saving.value = true;
    error.value = null;
    applied.value = title;

    try {
      const renamed = await renameNode(deps.nodeId, title);
      if (generation !== mine) return;
      saving.value = false;
      applied.value = renamed.title;
      deps.onRenamed?.(renamed);
    } catch (thrown) {
      if (generation !== mine) return;
      saving.value = false;
      applied.value = previous;
      const refusal = classifyWriteRefusal(thrown, 'rename');
      error.value = refusal.message;
      if (refusal.keepsField) {
        editing.value = true;
        value.value = title;
      }
    }
  }

  return {
    editing: computed(() => editing.value),
    value,
    error,
    saving: computed(() => saving.value),
    shownTitle: (stored: string) => applied.value ?? stored,
    start,
    setValue,
    cancel,
    commit,
  };
}
