export type DiffLayout = 'unified' | 'side-by-side';

export interface UseDiffLayoutResult {
  /** The person's preference. Whether it can be honoured at the current width is the component's call (`DiffBlockChanges`). */
  readonly layout: Ref<DiffLayout>;
  readonly set: (layout: DiffLayout) => void;
}

/** The cookie that remembers the choice, beside `dw-comments` and the sidebar's width. */
export const DIFF_LAYOUT_COOKIE = 'dw-diff-layout';

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

function layoutCookie() {
  return useCookie<DiffLayout>(DIFF_LAYOUT_COOKIE, {
    default: () => 'unified',
    maxAge: ONE_YEAR_IN_SECONDS,
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * How the diff screens lay out an edited block: one column with the
 * deletions and insertions inline ("unified"), or the before and after
 * texts beside each other ("side by side"). A display preference and
 * nothing more — per browser, in a cookie read before the first render
 * so the screen never flips after it has drawn — shared by the page diff
 * and the book diff through the one `DiffBlockChanges` component.
 */
export function useDiffLayout(): UseDiffLayoutResult {
  const layout = useState<DiffLayout>('dw-diff-layout', () => layoutCookie().value);

  function set(next: DiffLayout): void {
    layout.value = next;
    layoutCookie().value = next;
  }

  return { layout, set };
}
