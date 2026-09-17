/**
 * The addresses every link had before 2026-09-17 still land.
 *
 * Pages lived at `/pages/<id>`, books at `/books/<id>/history`, a
 * workspace at `/workspaces/<id>`. The owner's decision (option b) moved
 * them under the workspace's slug — `/w/<slug>/p/<id>` — and a bookmark,
 * a link in a mail sent last week or an address pasted into a chat must
 * not become a dead end because of it (docs/UI-CHECKLIST.md §3). So the
 * old shapes are real routes (`nuxt.config.ts`, `pages:extend`) that carry
 * this middleware and render nothing of their own: the person is moved to
 * the new address once and for good — `301`, so a browser and a crawler
 * rewrite what they hold — with any query the address carried kept.
 *
 * **Where the thing lives is the API's answer, never a guess.** A page id
 * says nothing about its workspace; `GET /nodes/:id/location` does, by id
 * and by slug, and only for a node the caller may read. A workspace id
 * resolves through `GET /workspaces` — the list of what the caller may
 * open, already the answer to "which workspaces exist for you" — so
 * neither resolver is an oracle: an unreadable page and a nonexistent one
 * both get the API's one 404, and both land here on the not-found screen
 * with nothing to tell them apart (§3, "permission-denied does not leak
 * existence"). A `/pages/<id>` whose id names a book is not found either;
 * the old address said what kind of thing it pointed at, and that is part
 * of what it named.
 *
 * Signed out, the API answers 401 and the person is sent to sign in with
 * the *old* address as the place to come back to — it resolves on the
 * return, once the cookie is there (`useSignInRedirect`'s contract, spelled
 * with its own `signInPath`). On the server that cookie is forwarded only
 * when the request carried it (`ssrCanAuthenticate`); when the API lives
 * on another host and the server cannot see it, the resolution is left to
 * the browser, which runs this same middleware on hydration.
 */
import type { NodeLocationResponse, WorkspaceListResponse } from '@deep-wiki/contracts';
import { ssrCanAuthenticate } from '~/composables/useApiRead';
import { localReturnPath, signInPath } from '~/composables/useSignInRedirect';
import { httpStatusOf } from '~/utils/fetch-error';
import {
  aiUrl,
  bookDiffUrl,
  bookHistoryUrl,
  membersUrl,
  pageDiffUrl,
  pageEditUrl,
  pageHistoryUrl,
  pageUrl,
  parseLegacyPath,
  settingsUrl,
  workspaceUrl,
  type ParsedLegacyPath,
} from '~/utils/routes';

/** The new address for an old one, before its query is put back. */
function newAddress(legacy: ParsedLegacyPath, slug: string): string {
  if (legacy.kind === 'workspace') {
    switch (legacy.screen) {
      case 'members':
        return membersUrl(slug);
      case 'settings':
        return settingsUrl(slug);
      case 'ai':
        return aiUrl(slug);
      default:
        return workspaceUrl(slug);
    }
  }
  if (legacy.type === 'book') {
    // The query — `?since=` — is put back verbatim below; the helper's own
    // parameter would double-encode it.
    return legacy.view === 'diff' ? bookDiffUrl(slug, legacy.id) : bookHistoryUrl(slug, legacy.id);
  }
  switch (legacy.view) {
    case 'edit':
      return pageEditUrl(slug, legacy.id);
    case 'history':
      return pageHistoryUrl(slug, legacy.id);
    case 'diff':
      // Same as the book diff: `?from=&to=` is the address's own and is put back as it was.
      return pageDiffUrl(slug, legacy.id, { from: '', to: '' }).split('?')[0]!;
    default:
      return pageUrl(slug, legacy.id);
  }
}

/** Where the old address's thing lives now — its workspace's slug — or `null` when the API will not say. */
async function resolveSlug(api: ReturnType<typeof useApiClient>, legacy: ParsedLegacyPath): Promise<string | null> {
  if (legacy.kind === 'workspace') {
    const { workspaces } = await api<WorkspaceListResponse>('/workspaces');
    return workspaces.find((workspace) => workspace.id === legacy.id)?.slug ?? null;
  }
  const location = await api<NodeLocationResponse>(`/nodes/${legacy.id}/location`);
  return location.type === legacy.type ? location.workspaceSlug : null;
}

export default defineNuxtRouteMiddleware(async (to) => {
  const legacy = parseLegacyPath(to.path);
  if (!legacy) return;
  // The server cannot ask on the person's behalf without their cookie;
  // the browser will, on hydration, with its own.
  if (import.meta.server && !ssrCanAuthenticate()) return;

  const query = to.fullPath.slice(to.path.length);
  try {
    const slug = await resolveSlug(useApiClient(), legacy);
    if (slug === null) return abortNavigation(createError({ statusCode: 404, statusMessage: 'Not found' }));
    return navigateTo(`${newAddress(legacy, slug)}${query}`, { redirectCode: 301, replace: true });
  } catch (error) {
    const status = httpStatusOf(error);
    if (status === 401) return navigateTo(signInPath(localReturnPath(to.fullPath)), { replace: true });
    if (status === 403 || status === 404) return abortNavigation(createError({ statusCode: 404, statusMessage: 'Not found' }));
    return abortNavigation(createError({ statusCode: 503, statusMessage: 'The server could not be reached' }));
  }
});
