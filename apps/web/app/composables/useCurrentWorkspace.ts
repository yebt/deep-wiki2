export interface UseCurrentWorkspaceResult {
  /** The workspace the person is in; `null` before any screen has named one. */
  readonly workspaceId: Ref<string | null>;
  readonly enter: (workspaceId: string) => void;
}

/** The cookie that remembers the last workspace the person was in — what `/` reads. */
export const LAST_WORKSPACE_COOKIE = 'dw-workspace';

/** A workspace id as the database mints them — anything else in the cookie is ignored, never routed to. */
const WORKSPACE_ID = /^[A-Za-z0-9-]{1,64}$/;

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

function lastWorkspaceCookie() {
  return useCookie<string | null>(LAST_WORKSPACE_COOKIE, {
    default: () => null,
    maxAge: ONE_YEAR_IN_SECONDS,
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * The workspace the cookie remembers, read fresh — what `/` routes on.
 * Read from the cookie rather than the shared state because the state is
 * initialised once per app, possibly before the cookie was there, and a
 * value that is not a workspace id as the database mints them is ignored,
 * never routed to.
 */
export function rememberedWorkspaceId(): string | null {
  const remembered = lastWorkspaceCookie().value;
  return remembered && WORKSPACE_ID.test(remembered) ? remembered : null;
}

/**
 * The one workspace the person is in (apps/web/PRODUCT.md: "the workspace
 * is chosen once and everything else happens inside it"). App state rather
 * than a screen's ref: a screen that learns its workspace from a response
 * — read mode names it from `GET /pages/:id` — hands it here, and the next
 * screen's sidebar starts from it instead of from nothing.
 *
 * `useState` for the live value, so every call site reads one ref and it
 * is serialised with the payload on SSR. Behind it, a **cookie**: Obsidian
 * reopens the last vault, and `/` sends the person to the last workspace
 * they were in (`middleware/last-workspace.ts`). A cookie rather than
 * `localStorage` because that redirect is resolved on the server, before
 * any screen renders — storage the browser alone can read would force a
 * client-side bounce through the workspace list first. The cookie is the
 * browser's, not the account's: the sidebar's width is remembered the same
 * way, and a workspace the next person at this browser may not open lands
 * on the dashboard's own "does not exist" state with the list one click
 * away, never on a leak.
 */
export function useCurrentWorkspace(): UseCurrentWorkspaceResult {
  const workspaceId = useState<string | null>('dw-current-workspace', rememberedWorkspaceId);

  function enter(id: string): void {
    if (workspaceId.value === id) return;
    workspaceId.value = id;
    lastWorkspaceCookie().value = id;
  }

  return { workspaceId, enter };
}
