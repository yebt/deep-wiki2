import type { EditorViewMode } from '~/utils/editor-view';

export interface UseEditorViewResult {
  /** The view edit mode shows: the live document, or its markdown source. */
  readonly view: Ref<EditorViewMode>;
  readonly set: (view: EditorViewMode) => void;
}

/** The cookie that remembers the choice, beside `dw-comments` and the sidebar's width. */
export const EDITOR_VIEW_COOKIE = 'dw-editor-view';

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

function viewCookie() {
  return useCookie<EditorViewMode>(EDITOR_VIEW_COOKIE, {
    default: () => 'visual',
    maxAge: ONE_YEAR_IN_SECONDS,
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * Which of edit mode's two views a person last chose (owner decision,
 * 2026-09-17, "source mode, like Obsidian"): the live ProseMirror
 * document, or the same document as raw markdown in a text area. Per
 * browser, in a cookie like the comments toggle, read before the first
 * render so the screen opens in the view the person left it in.
 *
 * **A display preference and nothing more.** The edit session's markdown
 * is the truth in either view; what is saved, locked, heartbeaten and
 * confirmed on leaving is the screen's and does not change with the
 * view (`pages/[id]/edit.vue`). Whether the *switch* is allowed is
 * `~/utils/editor-view`'s decision — a non-canonical source stays in
 * source — and this only remembers the view that was granted.
 */
export function useEditorView(): UseEditorViewResult {
  const view = useState<EditorViewMode>('dw-editor-view', () => viewCookie().value === 'source' ? 'source' : 'visual');

  function set(next: EditorViewMode): void {
    view.value = next;
    viewCookie().value = next;
  }

  return { view, set };
}
