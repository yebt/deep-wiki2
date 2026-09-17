/**
 * How the browser remembers the workspace the person was last in — the
 * cookie `/` reopens on (`middleware/last-workspace.ts`) and
 * `useCurrentWorkspace` writes. Dependency-free so the e2e suite can
 * write the same bytes the app does and a test never guesses the format.
 *
 * Two names travel together, `<id>:<slug>`: the **id** the API is keyed
 * by (the sidebar's tree, the presence stream) and the **slug** every
 * address carries (`utils/routes.ts`). `/` needs the slug to build
 * `/w/<slug>` and is decided on the server from this cookie alone, so the
 * cookie carries both; neither name may contain the separator, so the
 * split is exact. A cookie from before 2026-09-17 carried the id alone
 * and remembers nothing now — the next workspace the person opens writes
 * the pair.
 */

/** A workspace as this app names it: the id the API is keyed by, and the slug every address carries. */
export interface RememberedWorkspace {
  readonly id: string;
  readonly slug: string;
}

/** The cookie that remembers the last workspace the person was in — what `/` reads. */
export const LAST_WORKSPACE_COOKIE = 'dw-workspace';

/** A workspace id as the database mints them — anything else in the cookie is ignored, never routed to. */
const WORKSPACE_ID = /^[A-Za-z0-9-]{1,64}$/;
/** A workspace slug as `WorkspaceSlugSchema` accepts it — the shape `/w/<slug>` is built from. */
const WORKSPACE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const COOKIE_SEPARATOR = ':';

export function rememberWorkspaceCookieValue(workspace: RememberedWorkspace): string {
  return `${workspace.id}${COOKIE_SEPARATOR}${workspace.slug}`;
}

/** The pair a cookie value spells, or `null` for anything that is not a well-formed id and slug. */
export function parseWorkspaceCookieValue(value: string | null | undefined): RememberedWorkspace | null {
  if (!value) return null;
  const separator = value.indexOf(COOKIE_SEPARATOR);
  if (separator < 0) return null;
  const id = value.slice(0, separator);
  const slug = value.slice(separator + 1);
  return WORKSPACE_ID.test(id) && WORKSPACE_SLUG.test(slug) ? { id, slug } : null;
}
