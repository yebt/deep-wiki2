/**
 * Every address this app emits, in one place.
 *
 * The shape (owner decision, 2026-09-17, option b): a page lives at
 * `/w/<workspace-slug>/p/<uuid>`. The workspace's **slug** is in the URL
 * because it is the name a team chose and recognises; the node's **id**
 * stays because it never changes — a rename, a move to another chapter,
 * nothing breaks a link; and the hierarchy (shelf › book › chapter) is
 * the breadcrumb's job, not the address's, so a reorganised tree
 * invalidates nothing anyone bookmarked.
 *
 *   /w/<slug>                       the workspace's dashboard
 *   /w/<slug>/p/<id>                a page, read mode
 *   /w/<slug>/p/<id>/edit           edit mode
 *   /w/<slug>/p/<id>/history        its revisions
 *   /w/<slug>/p/<id>/diff?from&to   two of them compared
 *   /w/<slug>/b/<id>/history        a book's changesets
 *   /w/<slug>/b/<id>/diff?since     a changeset's pages compared
 *   /w/<slug>/members|settings|ai   the workspace's management screens
 *   /w/<slug>/trash                 what was deleted, for 30 days
 *   /workspaces, /workspaces/new    the chooser and the way to a new one
 *   /admin/registration, /account   the instance's and the person's own
 *
 * The sign-in family (`/login`, `/forgot-password`, …) is not a workspace
 * address and keeps its own home: `useSignInRedirect` spells `/login?next=`.
 *
 * The old shapes — `/pages/<id>[/…]`, `/books/<id>/…`, `/workspaces/<id>[/…]`
 * — are redirected by `middleware/legacy-routes.global.ts`, which reads
 * them through `parseLegacyPath` below; `error.vue` reads the new ones
 * through `parseAppPath`. **No screen spells a route by hand**: a second
 * copy of a shape is a second chance for it to drift, and
 * `routes.test.ts` walks `apps/web/app` for one (`handBuiltRouteStrings`).
 *
 * Dependency-free on purpose — no Nuxt auto-import, no `#app` — so the
 * e2e suite imports the same helpers and drives the same addresses.
 */

/** A workspace slug as `WorkspaceSlugSchema` accepts it: lowercase letters, digits, single hyphens. */
const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
/** A node or workspace id as the database mints them. */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const APP_WORKSPACE = new RegExp(`^/w/(${SLUG})(?:/(?!p/|b/)[^/]*)?/?$`);
const APP_NODE = new RegExp(`^/w/(${SLUG})/(p|b)/(${UUID})(?:/[a-z]+)?/?$`);

const LEGACY_PAGE = new RegExp(`^/pages/(${UUID})(?:/(edit|history|diff))?/?$`);
const LEGACY_BOOK = new RegExp(`^/books/(${UUID})/(history|diff)/?$`);
const LEGACY_WORKSPACE = new RegExp(`^/workspaces/(${UUID})(?:/(members|settings|ai))?/?$`);

export function workspacesUrl(): string {
  return '/workspaces';
}

export function newWorkspaceUrl(): string {
  return '/workspaces/new';
}

export function workspaceUrl(slug: string): string {
  return `/w/${slug}`;
}

export function membersUrl(slug: string): string {
  return `${workspaceUrl(slug)}/members`;
}

export function settingsUrl(slug: string): string {
  return `${workspaceUrl(slug)}/settings`;
}

export function aiUrl(slug: string): string {
  return `${workspaceUrl(slug)}/ai`;
}

/** The Trash screen (design.md Decision 8): the delete flow links here before the screen exists, so the address is minted once. */
export function trashUrl(slug: string): string {
  return `${workspaceUrl(slug)}/trash`;
}

export function pageUrl(slug: string, id: string): string {
  return `${workspaceUrl(slug)}/p/${id}`;
}

export function pageEditUrl(slug: string, id: string): string {
  return `${pageUrl(slug, id)}/edit`;
}

export function pageHistoryUrl(slug: string, id: string): string {
  return `${pageUrl(slug, id)}/history`;
}

export function pageDiffUrl(slug: string, id: string, revisions: { readonly from: string; readonly to: string }): string {
  return `${pageUrl(slug, id)}/diff?${new URLSearchParams({ from: revisions.from, to: revisions.to })}`;
}

export function bookHistoryUrl(slug: string, id: string): string {
  return `${workspaceUrl(slug)}/b/${id}/history`;
}

export function bookDiffUrl(slug: string, id: string, window?: { readonly since: string }): string {
  const base = `${workspaceUrl(slug)}/b/${id}/diff`;
  return window ? `${base}?${new URLSearchParams({ since: window.since })}` : base;
}

export function accountUrl(): string {
  return '/account';
}

export function registrationSettingsUrl(): string {
  return '/admin/registration';
}

export type ParsedAppPath =
  | { readonly kind: 'workspace'; readonly slug: string }
  | { readonly kind: 'page'; readonly slug: string; readonly id: string }
  | { readonly kind: 'book'; readonly slug: string; readonly id: string };

/**
 * What one of this app's addresses names — for the screen a bad address
 * lands on (`error.vue`), which offers the place the address was trying
 * to reach. `null` for anything that is not one of ours.
 */
export function parseAppPath(path: string): ParsedAppPath | null {
  const node = APP_NODE.exec(path);
  if (node) return { kind: node[2] === 'p' ? 'page' : 'book', slug: node[1]!, id: node[3]! };
  const workspace = APP_WORKSPACE.exec(path);
  if (workspace) return { kind: 'workspace', slug: workspace[1]! };
  return null;
}

export type LegacyNodeView = 'read' | 'edit' | 'history' | 'diff';
export type LegacyWorkspaceScreen = 'dashboard' | 'members' | 'settings' | 'ai';

export type ParsedLegacyPath =
  | { readonly kind: 'node'; readonly type: 'page' | 'book'; readonly id: string; readonly view: LegacyNodeView }
  | { readonly kind: 'workspace'; readonly id: string; readonly screen: LegacyWorkspaceScreen };

/**
 * The shapes every link had before 2026-09-17, so a bookmark, a pasted
 * link or a mail sent before the change still lands (`middleware/
 * legacy-routes.global.ts`). `/workspaces` and `/workspaces/new` are not
 * legacy — they stay — and read as `null` here.
 */
export function parseLegacyPath(path: string): ParsedLegacyPath | null {
  const page = LEGACY_PAGE.exec(path);
  if (page) return { kind: 'node', type: 'page', id: page[1]!, view: (page[2] as LegacyNodeView | undefined) ?? 'read' };
  const book = LEGACY_BOOK.exec(path);
  if (book) return { kind: 'node', type: 'book', id: book[1]!, view: book[2] as LegacyNodeView };
  const workspace = LEGACY_WORKSPACE.exec(path);
  if (workspace) return { kind: 'workspace', id: workspace[1]!, screen: (workspace[2] as LegacyWorkspaceScreen | undefined) ?? 'dashboard' };
  return null;
}

/** A string literal — quoted or template — that names one of this app's route families. */
const ROUTE_LITERAL = /(['"`])[^'"`\n]*?(?:\/w\/|\/pages\/|\/books\/|\/workspaces)[^'"`\n]*?\1/g;
/** What precedes a literal that is an API path, not a route: the API client, or the raw base URL that may also open the literal itself. */
const API_CALL = /(?:\bapi(?:<[^>]*>)?\(|\$fetch(?:<[^>]*>)?\(|apiBaseUrl|baseURL)/;
const API_ORIGIN = /apiBaseUrl/;
const LOOKBEHIND = 120;

/**
 * The route-shaped string literals in one source file that did not come
 * from this module — what `routes.test.ts` walks `apps/web/app` for.
 * Comments are stripped first (a doc comment naming `/pages/:id` is
 * prose), and a literal handed to the API client is the API's path, not
 * one of this app's routes.
 */
export function handBuiltRouteStrings(source: string): string[] {
  const stripped = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const hits: string[] = [];
  for (const match of stripped.matchAll(ROUTE_LITERAL)) {
    const before = stripped.slice(Math.max(0, match.index - LOOKBEHIND), match.index);
    if (API_CALL.test(before) || API_ORIGIN.test(match[0])) continue;
    hits.push(match[0]);
  }
  return hits;
}
