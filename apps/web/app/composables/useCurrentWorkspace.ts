import {
  LAST_WORKSPACE_COOKIE,
  parseWorkspaceCookieValue,
  rememberWorkspaceCookieValue,
  type RememberedWorkspace,
} from '~/utils/workspace-cookie';

/** A workspace as this app names it: the id the API is keyed by, and the slug every address carries. */
export type CurrentWorkspace = RememberedWorkspace;

export interface UseCurrentWorkspaceResult {
  /** The workspace the person is in; `null` before any screen has named one. */
  readonly workspace: Ref<CurrentWorkspace | null>;
  readonly workspaceId: ComputedRef<string | null>;
  readonly workspaceSlug: ComputedRef<string | null>;
  readonly enter: (workspace: CurrentWorkspace) => void;
}

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
 * value that is not an id and a slug as the database mints them is
 * ignored, never routed to (`utils/workspace-cookie.ts` owns the format).
 */
export function rememberedWorkspace(): CurrentWorkspace | null {
  return parseWorkspaceCookieValue(lastWorkspaceCookie().value);
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
 *
 * Two names, held together: the **id** the API is keyed by (the sidebar's
 * tree, the presence stream) and the **slug** every address carries
 * (`utils/routes.ts`). `/` needs the slug to build `/w/<slug>`, and it is
 * decided on the server from the cookie alone, so the cookie carries both.
 */
export function useCurrentWorkspace(): UseCurrentWorkspaceResult {
  const workspace = useState<CurrentWorkspace | null>('dw-current-workspace', rememberedWorkspace);

  function enter(next: CurrentWorkspace): void {
    const current = workspace.value;
    if (current && current.id === next.id && current.slug === next.slug) return;
    workspace.value = { id: next.id, slug: next.slug };
    lastWorkspaceCookie().value = rememberWorkspaceCookieValue(next);
  }

  return {
    workspace,
    workspaceId: computed(() => workspace.value?.id ?? null),
    workspaceSlug: computed(() => workspace.value?.slug ?? null),
    enter,
  };
}
