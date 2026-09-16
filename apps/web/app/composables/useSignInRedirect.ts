/**
 * The one rule for a signed-out visit to a signed-in screen: leave for
 * sign-in, and come back.
 *
 * Until 2026-09-16 every screen answered its own `401` with a card —
 * "Sign in to see your workspaces", "Sign in to manage members", "Sign in
 * to change registration", four copies of one sentence — and the frame's
 * screens answered it with "Cannot reach the server", which was not true.
 * A card that says "sign in" and then forgets where the person was is a
 * dead end with a button on it (docs/UI-CHECKLIST.md §3): after signing
 * in they landed on `/`, not on the page whose address they had followed.
 * The owner asked for a straight redirect (docs/TODO.md Findings,
 * 2026-09-16). This composable is that redirect, and `pages/login.vue` is
 * the return half: it reads the same query this writes and goes back
 * there once the sign-in succeeds, saying once that the session had
 * ended so the bounce is explained rather than silent.
 *
 * Two pure functions carry the contract so the page can test the return
 * half without a router, and so the query's name and the safety of what
 * it holds are stated exactly once:
 *
 * - `localReturnPath` — what `next` may carry. It is read straight off
 *   the address bar, so an absolute URL, a scheme-relative `//host`, a
 *   backslash Chrome would normalise to a slash, or anything not starting
 *   at this origin's root is refused: a sign-in must never end on another
 *   site. `/login` itself is refused too, so a return can never loop.
 * - `signInPath` — the address to leave for, with the return path encoded
 *   into `next`, or the bare screen when there is nowhere to return to.
 *
 * `redirectWhenSignedOut` is the whole of what a screen adds: hand it the
 * status ref of the request that loads the screen, and the moment it
 * reads `unauthenticated` the screen is left. `immediate`, because a
 * composable that already knows may have resolved before the screen
 * watched it. `replace`, because a history entry for a screen that only
 * bounces would put the bounce on the Back button.
 */
export const SIGN_IN_RETURN_QUERY = 'next';

const SIGN_IN_PATH = '/login';

/** A path on this origin that a sign-in may return to, or `null` for anything else. */
export function localReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // One leading slash, then anything that is not a second slash or a
  // backslash: the shape of a same-origin absolute path and nothing else.
  if (!/^\/(?![/\\])/.test(raw)) return null;
  if (raw === SIGN_IN_PATH || raw.startsWith(`${SIGN_IN_PATH}?`) || raw.startsWith(`${SIGN_IN_PATH}#`)) return null;
  return raw;
}

/** The sign-in screen's address, carrying where to come back to. */
export function signInPath(returnTo: string | null): string {
  return returnTo === null ? SIGN_IN_PATH : `${SIGN_IN_PATH}?${SIGN_IN_RETURN_QUERY}=${encodeURIComponent(returnTo)}`;
}

export interface UseSignInRedirectResult {
  /** Leave the current screen for sign-in, remembering it as the place to come back to. */
  readonly redirectToSignIn: () => Promise<void>;
  /** Leave for sign-in as soon as — or if already — `status` reads `unauthenticated`. */
  readonly redirectWhenSignedOut: (status: Ref<string> | ComputedRef<string>) => void;
}

export function useSignInRedirect(): UseSignInRedirectResult {
  const route = useRoute();

  async function redirectToSignIn(): Promise<void> {
    await navigateTo(signInPath(localReturnPath(route.fullPath)), { replace: true });
  }

  function redirectWhenSignedOut(status: Ref<string> | ComputedRef<string>): void {
    watch(
      status,
      (value) => {
        if (value === 'unauthenticated') void redirectToSignIn();
      },
      { immediate: true },
    );
  }

  return { redirectToSignIn, redirectWhenSignedOut };
}
