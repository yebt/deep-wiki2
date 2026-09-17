import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import HistoryPage from './history.vue';

const { useBookHistoryMock, useRouteMock, navigateToMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn(async () => {}),
  useBookHistoryMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { workspace: 'acme', id: 'book-1' } })),
}));

mockNuxtImport('useBookHistory', () => useBookHistoryMock);
mockNuxtImport('useRoute', () => useRouteMock);
mockNuxtImport('navigateTo', () => navigateToMock);

// Every screen now renders inside the workspace frame. Its sidebar — the
// tree, the switcher, the doors — is stubbed here so this file stays about
// the screen it names; `AppShell.test.ts` and `WorkspaceSidebar.test.ts`
// own the frame.
const FRAME_STUBS = { global: { stubs: { WorkspaceSidebar: true } } };

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(HistoryPage) }),
});

interface ChangesetRevision {
  id: string;
  pageId: string;
  createdAt: string;
}
interface Changeset {
  id: string;
  authorId: string | null;
  authorDisplayName: string | null;
  message: string | null;
  windowStart: string;
  windowEnd: string;
  revisions: ChangesetRevision[];
}

function mockHistory(overrides: Partial<{ status: string; changesets: Changeset[]; message: string; title: string; workspaceId: string | null }> = {}) {
  const load = vi.fn(async () => {});
  useBookHistoryMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    changesets: ref(overrides.changesets ?? []),
    message: ref(overrides.message ?? ''),
    title: ref(overrides.title ?? 'E2E Handbook'),
    workspaceId: ref(overrides.workspaceId === undefined ? 'ws-1' : overrides.workspaceId),
    load,
  });
  return load;
}

const TWO_CHANGESETS: Changeset[] = [
  {
    id: 'cs-2',
    authorId: 'user-1',
    authorDisplayName: 'Ada Lovelace',
    message: null,
    windowStart: '2026-01-02T00:00:00.000Z',
    windowEnd: '2026-01-02T00:10:00.000Z',
    revisions: [{ id: 'rev-3', pageId: 'page-1', createdAt: '2026-01-02T00:10:00.000Z' }],
  },
  {
    id: 'cs-1',
    authorId: 'user-1',
    authorDisplayName: 'Ada Lovelace',
    message: 'Initial draft of the handbook',
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-01-01T00:05:00.000Z',
    revisions: [
      { id: 'rev-1', pageId: 'page-1', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'rev-2', pageId: 'page-2', createdAt: '2026-01-01T00:05:00.000Z' },
    ],
  },
];

const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('book-history screen', () => {
  test('renders the loading skeleton, not a spinner, while the request is in flight', async () => {
    mockHistory({ status: 'loading' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.find('[data-testid="book-history-skeleton"]').exists()).toBe(true);
  });

  test('renders every changeset newest-first with its author, the pages it grouped, and its message when present', async () => {
    mockHistory({ status: 'success', changesets: TWO_CHANGESETS });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const items = component.findAll('main li');
    expect(items).toHaveLength(2);
    // Newest first: cs-2's row comes before cs-1's.
    expect(items[0]!.text()).toContain('Ada Lovelace');
    expect(items[0]!.text()).not.toContain('Initial draft');
    expect(items[1]!.text()).toContain('Initial draft of the handbook');
    // Grouping is real: the second changeset touched two distinct pages.
    expect(items[1]!.findAll('a[href="/w/acme/p/page-1"]')).toHaveLength(1);
    expect(items[1]!.findAll('a[href="/w/acme/p/page-2"]')).toHaveLength(1);
  });

  test("renders each changeset's timestamp in the viewer's own timezone, not UTC", async () => {
    process.env.TZ = 'America/New_York';
    mockHistory({ status: 'success', changesets: TWO_CHANGESETS });
    const inNewYork = await mountSuspended(PageInApp, FRAME_STUBS);
    expect(inNewYork.findAll('time')[0]!.text()).toMatch(/EST|EDT/);

    process.env.TZ = 'Asia/Tokyo';
    mockHistory({ status: 'success', changesets: TWO_CHANGESETS });
    const inTokyo = await mountSuspended(PageInApp, FRAME_STUBS);
    expect(inTokyo.findAll('time')[0]!.text()).toMatch(/GMT\+9/);
  });

  test('the <time> element carries the exact ISO instant', async () => {
    mockHistory({ status: 'success', changesets: TWO_CHANGESETS });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const times = component.findAll('time');
    expect(times[0]!.attributes('datetime')).toBe('2026-01-02T00:10:00.000Z');
  });

  test('each changeset links to the book diff since just before it started, never to a URL a keyboard user cannot reach', async () => {
    mockHistory({ status: 'success', changesets: TWO_CHANGESETS });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const link = component.findAll('a').find((a) => /view diff since/i.test(a.text()));
    expect(link).toBeTruthy();
    const href = link!.attributes('href')!;
    expect(href).toBe(`/w/acme/b/book-1/diff?since=${encodeURIComponent('2026-01-01T23:59:59.999Z')}`);
  });

  test('renders a single not-found state — absence and denial are indistinguishable here', async () => {
    mockHistory({ status: 'not-found' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/does not exist/i);
    expect(component.findAll('main li')).toHaveLength(0);
  });

  test('the empty state names the object and explains why, distinct from not-found', async () => {
    mockHistory({ status: 'success', changesets: [] });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/no changes yet/i);
  });

  test('renders a recoverable error state with a retry action that reloads', async () => {
    const load = mockHistory({ status: 'network-error', message: 'Cannot reach the server.' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const retry = component.get('button[data-testid="book-history-retry"]');
    await retry.trigger('click');

    expect(load).toHaveBeenCalled();
  });

  // One rule for a signed-out visit to a signed-in screen: leave for
  // sign-in with this address as the return path, and show no card here —
  // a card would be a dead end with a button on it (docs/UI-CHECKLIST.md §3).
  test('a signed-out visitor is sent to sign in, to come back here afterwards, and shown no card', async () => {
    mockHistory({ status: 'unauthenticated' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(navigateToMock).toHaveBeenCalledWith(expect.stringMatching(/^\/login(\?next=|$)/), { replace: true });
    expect(component.findAll('a').find((a) => /sign in/i.test(a.text()))).toBeUndefined();
  });

  test('a changeset with no message renders without a message line, not an empty quote', async () => {
    mockHistory({ status: 'success', changesets: [TWO_CHANGESETS[0]!] });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.get('main li').text()).not.toContain('""');
  });

  test('renders exactly one h1 for the screen', async () => {
    mockHistory({ status: 'success', changesets: TWO_CHANGESETS });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.findAll('h1')).toHaveLength(1);
  });

  // The route names the book and its workspace now. The heading says which
  // book this is, and the empty state — which used to explain why it could
  // not offer a way forward — offers one: the book's own place in the tree.
  test('names the book in the heading and offers the way back to its tree', async () => {
    mockHistory({ status: 'success', changesets: TWO_CHANGESETS });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.get('h1').text()).toContain('E2E Handbook');
    expect(component.find('a[href="/w/acme"]').exists()).toBe(true);
  });

  test('the empty state has a way forward: the tree the book lives in', async () => {
    mockHistory({ status: 'success', changesets: [] });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/no changes yet/i);
    // Scoped to `main`: the contextual bar carries the sidebar toggle's own
    // live region since 2026-09-15; the notice is the screen's, in the column.
    const notice = component.get('main [role="status"]');
    expect(notice.find('a[href="/w/acme"]').exists()).toBe(true);
  });

  /*
   * The screen opts into the workspace layout, so the sidebar around it is
   * the one the layout mounted and survives the navigation that brought
   * the person here (`apps/web/app/pages/pages/[id]/index.test.ts`'s own
   * convention — the record is read from the application's router).
   */
  test('stands inside the workspace layout', async () => {
    mockHistory({ status: 'success', changesets: TWO_CHANGESETS });
    await mountSuspended(PageInApp, FRAME_STUBS);
    const { useRouter } = await import('#imports');

    expect(useRouter().getRoutes().find((route) => route.path === '/w/:workspace()/b/:id()/history')?.meta.layout).toBe('workspace');
  });

  /*
   * The frame's breadcrumb now carries "workspace › shelf › book › History"
   * through the tree the sidebar already holds — its own first crumb is
   * already a link to `/workspaces/ws-1`. A second, hand-built "Workspace
   * home" button in the contextual bar duplicated that door (checklist
   * §4.1: a control matches the nearest existing one rather than inventing
   * a second); it is gone.
   */
  test('carries no separate "Workspace home" control now that the breadcrumb is one', async () => {
    mockHistory({ status: 'success', changesets: TWO_CHANGESETS });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.find('[aria-label="Workspace home"]').exists()).toBe(false);
  });

  /*
   * "Compare since…" — the newest changeset's own "View diff since here"
   * transition, exposed in the contextual bar so it needs no scroll to the
   * top row (checklist §4.1: the nearest existing control, generalised).
   */
  test('offers "Compare since…" in the contextual bar, to the diff since the newest changeset', async () => {
    mockHistory({ status: 'success', changesets: TWO_CHANGESETS });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const compare = component.get('header a[href^="/w/acme/b/book-1/diff?since="]');
    expect(compare.text()).toMatch(/compare since/i);
    expect(compare.attributes('href')).toBe(`/w/acme/b/book-1/diff?since=${encodeURIComponent('2026-01-01T23:59:59.999Z')}`);
  });

  test('offers no "Compare since…" control when there is nothing to compare', async () => {
    mockHistory({ status: 'success', changesets: [] });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.find('header a[href^="/w/acme/b/book-1/diff?since="]').exists()).toBe(false);
  });
});
