import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  accountUrl,
  aiUrl,
  bookDiffUrl,
  bookHistoryUrl,
  handBuiltRouteStrings,
  membersUrl,
  newWorkspaceUrl,
  pageDiffUrl,
  pageEditUrl,
  pageHistoryUrl,
  pageUrl,
  parseAppPath,
  parseLegacyPath,
  registrationSettingsUrl,
  settingsUrl,
  workspaceUrl,
  workspacesUrl,
} from './routes';

const SLUG = 'acme';
const ID = '0f3e2a9c-7b1d-4c5e-8a2f-1d2e3f4a5b6c';

/**
 * Every address the app emits comes from here (owner decision 2026-09-17,
 * option b): the workspace's slug in the URL, the node's id stable
 * underneath, the hierarchy left to the breadcrumb. One helper so no
 * screen spells a route by hand — the test at the bottom of this file is
 * what holds that.
 */
describe('route helpers', () => {
  test('the workspace family stands under /w/<slug>', () => {
    expect(workspaceUrl(SLUG)).toBe('/w/acme');
    expect(membersUrl(SLUG)).toBe('/w/acme/members');
    expect(settingsUrl(SLUG)).toBe('/w/acme/settings');
    expect(aiUrl(SLUG)).toBe('/w/acme/ai');
  });

  test('a page is /w/<slug>/p/<id>, and its views hang off it', () => {
    expect(pageUrl(SLUG, ID)).toBe(`/w/acme/p/${ID}`);
    expect(pageEditUrl(SLUG, ID)).toBe(`/w/acme/p/${ID}/edit`);
    expect(pageHistoryUrl(SLUG, ID)).toBe(`/w/acme/p/${ID}/history`);
    expect(pageDiffUrl(SLUG, ID, { from: 'rev-1', to: 'rev-2' })).toBe(`/w/acme/p/${ID}/diff?from=rev-1&to=rev-2`);
  });

  test('a book has history and diff under /w/<slug>/b/<id>, with the instant encoded', () => {
    expect(bookHistoryUrl(SLUG, ID)).toBe(`/w/acme/b/${ID}/history`);
    expect(bookDiffUrl(SLUG, ID, { since: '2026-01-01T00:00:00.000Z' })).toBe(`/w/acme/b/${ID}/diff?since=2026-01-01T00%3A00%3A00.000Z`);
    expect(bookDiffUrl(SLUG, ID)).toBe(`/w/acme/b/${ID}/diff`);
  });

  test('the addresses outside a workspace are unchanged', () => {
    expect(workspacesUrl()).toBe('/workspaces');
    expect(newWorkspaceUrl()).toBe('/workspaces/new');
    expect(accountUrl()).toBe('/account');
    expect(registrationSettingsUrl()).toBe('/admin/registration');
  });
});

/**
 * `error.vue` offers the person the place their address named; the
 * legacy middleware needs the same reading of the old shapes. Both read
 * the address through here, so neither carries a regex of its own.
 */
describe('parseAppPath', () => {
  test('reads the workspace family', () => {
    expect(parseAppPath('/w/acme')).toEqual({ kind: 'workspace', slug: 'acme' });
    expect(parseAppPath('/w/acme/')).toEqual({ kind: 'workspace', slug: 'acme' });
    expect(parseAppPath('/w/acme/members')).toEqual({ kind: 'workspace', slug: 'acme' });
  });

  test('reads a page and a book with their workspace', () => {
    expect(parseAppPath(`/w/acme/p/${ID}`)).toEqual({ kind: 'page', slug: 'acme', id: ID });
    expect(parseAppPath(`/w/acme/p/${ID}/edit`)).toEqual({ kind: 'page', slug: 'acme', id: ID });
    expect(parseAppPath(`/w/acme/b/${ID}/history`)).toEqual({ kind: 'book', slug: 'acme', id: ID });
  });

  test('reads nothing into an address that is not one of ours, or whose parts are not the shapes the database mints', () => {
    expect(parseAppPath('/w/')).toBeNull();
    expect(parseAppPath('/w/Not%20A%20Slug')).toBeNull();
    expect(parseAppPath('/w/acme/p/not-a-uuid')).toBeNull();
    expect(parseAppPath('/workspaces')).toBeNull();
    expect(parseAppPath('/this/route/does/not/exist')).toBeNull();
  });
});

describe('parseLegacyPath', () => {
  test('reads the pre-2026-09-17 shapes: /pages/<id>[/view], /books/<id>/view, /workspaces/<id>[/screen]', () => {
    expect(parseLegacyPath(`/pages/${ID}`)).toEqual({ kind: 'node', type: 'page', id: ID, view: 'read' });
    expect(parseLegacyPath(`/pages/${ID}/edit`)).toEqual({ kind: 'node', type: 'page', id: ID, view: 'edit' });
    expect(parseLegacyPath(`/pages/${ID}/history`)).toEqual({ kind: 'node', type: 'page', id: ID, view: 'history' });
    expect(parseLegacyPath(`/pages/${ID}/diff`)).toEqual({ kind: 'node', type: 'page', id: ID, view: 'diff' });
    expect(parseLegacyPath(`/books/${ID}/history`)).toEqual({ kind: 'node', type: 'book', id: ID, view: 'history' });
    expect(parseLegacyPath(`/books/${ID}/diff`)).toEqual({ kind: 'node', type: 'book', id: ID, view: 'diff' });
    expect(parseLegacyPath(`/workspaces/${ID}`)).toEqual({ kind: 'workspace', id: ID, screen: 'dashboard' });
    expect(parseLegacyPath(`/workspaces/${ID}/`)).toEqual({ kind: 'workspace', id: ID, screen: 'dashboard' });
    expect(parseLegacyPath(`/workspaces/${ID}/members`)).toEqual({ kind: 'workspace', id: ID, screen: 'members' });
    expect(parseLegacyPath(`/workspaces/${ID}/settings`)).toEqual({ kind: 'workspace', id: ID, screen: 'settings' });
    expect(parseLegacyPath(`/workspaces/${ID}/ai`)).toEqual({ kind: 'workspace', id: ID, screen: 'ai' });
  });

  test('the shapes that stay — the chooser, new, and anything else — are not legacy', () => {
    expect(parseLegacyPath('/workspaces')).toBeNull();
    expect(parseLegacyPath('/workspaces/')).toBeNull();
    expect(parseLegacyPath('/workspaces/new')).toBeNull();
    expect(parseLegacyPath(`/books/${ID}`)).toBeNull();
    expect(parseLegacyPath(`/pages/${ID}/unknown`)).toBeNull();
    expect(parseLegacyPath('/pages/not-a-uuid')).toBeNull();
    expect(parseLegacyPath(`/w/acme/p/${ID}`)).toBeNull();
  });
});

/**
 * A route spelled by hand anywhere else is a second copy of the shape,
 * and the copies drift — the string `/pages/<id>` existed in nineteen
 * files before the helper did. The API's own paths (`api('/pages/…')`)
 * are not routes of this app and are exempt; everything else that looks
 * like one of our addresses must come from `routes.ts`.
 */
describe('no hand-built route strings', () => {
  function walk(dir: string, into: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, into);
      else if (/\.(ts|vue)$/.test(entry) && !/\.test\.ts$/.test(entry)) into.push(full);
    }
    return into;
  }

  test('finds a hand-built route in a fixture, and lets an API path through', () => {
    expect(handBuiltRouteStrings("const a = `/pages/${id}`;")).toEqual(['`/pages/${id}`']);
    expect(handBuiltRouteStrings("<UButton :to=\"`/w/${slug}/members`\" />")).toEqual(['`/w/${slug}/members`']);
    expect(handBuiltRouteStrings("<UButton to=\"/workspaces\" />")).toEqual(['"/workspaces"']);
    expect(handBuiltRouteStrings("api<Page>(`/pages/${id}`)")).toEqual([]);
    expect(handBuiltRouteStrings("api(`/workspaces/${id}/members`)")).toEqual([]);
    expect(handBuiltRouteStrings("new EventSource(`${config.public.apiBaseUrl}/workspaces/${id}/presence/stream`)")).toEqual([]);
    expect(handBuiltRouteStrings("// a comment naming /pages/:id\n/* and /workspaces/:id */\n<!-- /w/<slug> -->")).toEqual([]);
  });

  test('apps/web/app spells no route by hand outside utils/routes.ts', () => {
    const root = join(import.meta.dirname, '..');
    const offenders: string[] = [];
    for (const file of walk(root)) {
      if (file.endsWith(join('utils', 'routes.ts'))) continue;
      for (const hit of handBuiltRouteStrings(readFileSync(file, 'utf8'))) {
        offenders.push(`${relative(root, file)}: ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
