export interface UseCommentsVisibilityResult {
  /** `true` when the read screen draws no comment marks and offers no thread panel. */
  readonly hidden: Ref<boolean>;
  readonly toggle: () => void;
}

/** The cookie that remembers the choice, beside the sidebar's width and its collapse. */
export const COMMENTS_VISIBILITY_COOKIE = 'dw-comments';

type CommentsVisibility = 'shown' | 'hidden';

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

function visibilityCookie() {
  return useCookie<CommentsVisibility>(COMMENTS_VISIBILITY_COOKIE, {
    default: () => 'shown',
    maxAge: ONE_YEAR_IN_SECONDS,
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * Whether the read screen shows its comment overlay — the marks beside
 * anchored blocks and the thread panel they open. The owner asked for the
 * comments to be toggleable the way the sidebar is (docs/UI-CHECKLIST.md
 * Review Log, 2026-09-15), and this is that preference: per browser, in a
 * cookie like the sidebar's width, read before the first render so the
 * marks never flash by on a page that has them hidden.
 *
 * **It is a display preference and nothing more.** Hiding changes nothing
 * about what is requested — `GET /pages/:id/comments` is still made on
 * every read, so the count on the toggle and the orphan chip stay honest
 * — and nothing about what a read-only caller sees: the API answers them
 * `{ threads: [] }` and the client draws nothing for them either way. The
 * toggle itself is offered only to someone with threads to hide.
 */
export function useCommentsVisibility(): UseCommentsVisibilityResult {
  const hidden = useState<boolean>('dw-comments-hidden', () => visibilityCookie().value === 'hidden');

  function toggle(): void {
    hidden.value = !hidden.value;
    visibilityCookie().value = hidden.value ? 'hidden' : 'shown';
  }

  return { hidden, toggle };
}
