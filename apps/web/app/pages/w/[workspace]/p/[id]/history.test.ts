import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import HistoryPage from './history.vue';

const { usePageHistoryMock, useRouteMock, useCurrentWorkspaceMock, useWorkspaceTreeMock, useWorkspaceDirectoryMock, navigateToMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn(async () => {}),
  usePageHistoryMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { workspace: 'acme', id: 'page-1' } })),
  useCurrentWorkspaceMock: vi.fn(),
  useWorkspaceTreeMock: vi.fn(),
  useWorkspaceDirectoryMock: vi.fn(),
}));

mockNuxtImport('usePageHistory', () => usePageHistoryMock);
mockNuxtImport('useRoute', () => useRouteMock);
mockNuxtImport('useCurrentWorkspace', () => useCurrentWorkspaceMock);
mockNuxtImport('useWorkspaceTree', () => useWorkspaceTreeMock);
mockNuxtImport('useWorkspaceDirectory', () => useWorkspaceDirectoryMock);
mockNuxtImport('navigateTo', () => navigateToMock);

/**
 * The frame's own collaborators, stubbed so this file stays about the
 * history screen. The history response names no workspace, so the frame
 * stands on the last one the person was in (`useCurrentWorkspace`), and
 * the tree places `page-1` under a shelf and a book — a page at the root
 * would let the breadcrumb test pass with the ancestors never rendered.
 */
function mockFrame() {
  useCurrentWorkspaceMock.mockReturnValue({ workspace: ref({ id: 'ws-1', slug: 'acme' }), workspaceId: ref('ws-1'), workspaceSlug: ref('acme'), enter: vi.fn() });
  useWorkspaceTreeMock.mockReturnValue({
    status: ref('success'),
    nodes: ref([]),
    rootId: ref('root-1'),
    message: ref(''),
    collapsedIds: computed(() => new Set<string>()),
    selectedId: ref(null),
    load: vi.fn(async () => {}),
    reorder: vi.fn(async () => true),
    toggleCollapsed: vi.fn(),
    reveal: vi.fn(),
    pathTo: (id: string) =>
      id === 'page-1'
        ? [
            { id: 'shelf-1', type: 'shelf', slug: 's', title: 'Engineering', position: 0, children: [] },
            { id: 'book-1', type: 'book', slug: 'b', title: 'Handbook', position: 0, children: [] },
            { id: 'page-1', type: 'page', slug: 'p', title: 'A Page', position: 0, children: [] },
          ]
        : [],
  });
  useWorkspaceDirectoryMock.mockReturnValue({
    status: ref('success'),
    workspaces: computed(() => [{ id: 'ws-1', name: 'Acme', slug: 'acme' }]),
    ensure: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    nameOf: (id: string) => (id === 'ws-1' ? 'Acme' : null),
    slugOf: (id: string) => (id === 'ws-1' ? 'acme' : null),
    idOf: (slug: string) => (slug === 'acme' ? 'ws-1' : null),
  });
}

// Every screen now renders inside the workspace frame. Its sidebar — the
// tree, the switcher, the doors — is stubbed here so this file stays about
// the screen it names; `AppShell.test.ts` and `WorkspaceSidebar.test.ts`
// own the frame.
const FRAME_STUBS = { global: { stubs: { WorkspaceSidebar: true } } };

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(HistoryPage) }),
});

interface Revision {
  id: string;
  authorId: string | null;
  authorDisplayName: string | null;
  createdAt: string;
  changesetId: string | null;
  contentHash: string;
}

function mockHistory(overrides: Partial<{ status: string; revisions: Revision[]; message: string }> = {}) {
  mockFrame();
  const load = vi.fn(async () => {});
  usePageHistoryMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    revisions: ref(overrides.revisions ?? []),
    message: ref(overrides.message ?? ''),
    load,
  });
  return load;
}

const TWO_REVISIONS: Revision[] = [
  { id: 'rev-2', authorId: 'user-1', authorDisplayName: 'Ada Lovelace', createdAt: '2026-01-02T00:00:00.000Z', changesetId: 'cs-1', contentHash: 'hash-2' },
  { id: 'rev-1', authorId: 'user-1', authorDisplayName: 'Ada Lovelace', createdAt: '2026-01-01T00:00:00.000Z', changesetId: null, contentHash: 'hash-1' },
];

const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('page-history screen', () => {
  // Presence only. The §3 guarantee that the skeleton occupies the loaded
  // box is a measurement, and happy-dom has no layout engine: its owner is
  // `e2e/history.spec.ts` ("the history skeleton occupies the box…").
  test('renders the loading skeleton, not a spinner, while the request is in flight', async () => {
    mockHistory({ status: 'loading' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.find('[data-testid="history-skeleton"]').exists()).toBe(true);
  });

  test('renders every revision newest-first with its author, timestamp and changeset membership', async () => {
    mockHistory({ status: 'success', revisions: TWO_REVISIONS });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const items = component.findAll('main li');
    expect(items).toHaveLength(2);
    expect(items[0]!.text()).toContain('Ada Lovelace');
    expect(items[0]!.text()).toContain('Part of a changeset');
    // The oldest revision (last in the newest-first list) has nothing
    // before it — a real state, not an edge case (revision-history spec).
    expect(items[1]!.text()).not.toContain('Part of a changeset');
    expect(items[1]!.text()).toMatch(/initial version/i);
  });

  test("renders each revision's timestamp in the viewer's own timezone, not UTC", async () => {
    // One instant, two viewers. 2026-01-02T00:00:00Z is still the evening
    // of the 1st in New York and mid-morning of the 2nd in Tokyo, so a
    // formatter stuck on UTC — or on whichever zone this machine happens
    // to sit in — cannot satisfy both halves.
    process.env.TZ = 'America/New_York';
    mockHistory({ status: 'success', revisions: TWO_REVISIONS });
    const inNewYork = await mountSuspended(PageInApp, FRAME_STUBS);
    expect(inNewYork.findAll('time')[0]!.text()).toBe('Jan 1, 2026, 7:00 PM EST');

    process.env.TZ = 'Asia/Tokyo';
    mockHistory({ status: 'success', revisions: TWO_REVISIONS });
    const inTokyo = await mountSuspended(PageInApp, FRAME_STUBS);
    expect(inTokyo.findAll('time')[0]!.text()).toBe('Jan 2, 2026, 9:00 AM GMT+9');
  });

  test('the <time> element carries the exact ISO instant, whatever the viewer sees', async () => {
    // The localised string is for a human; `datetime` is the value that
    // must survive the display choice — an assistive technology, a copied
    // row, or a later diff view reads this, not the rendering above it.
    process.env.TZ = 'Asia/Tokyo';
    mockHistory({ status: 'success', revisions: TWO_REVISIONS });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const times = component.findAll('time');
    expect(times).toHaveLength(2);
    expect(times[0]!.attributes('datetime')).toBe('2026-01-02T00:00:00.000Z');
    expect(times[1]!.attributes('datetime')).toBe('2026-01-01T00:00:00.000Z');
    // …and the attribute is not simply an echo of the visible text.
    expect(times[0]!.attributes('datetime')).not.toBe(times[0]!.text());
  });

  test('a page with exactly one revision renders it as the initial version, not a comparison target', async () => {
    mockHistory({ status: 'success', revisions: [TWO_REVISIONS[1]!] });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const items = component.findAll('main li');
    expect(items).toHaveLength(1);
    expect(items[0]!.text()).toMatch(/initial version/i);
    expect(items[0]!.find('button[aria-disabled="true"]').exists()).toBe(false);
  });

  // Task 10.3 wired this control — it now links to the diff view between
  // this revision and the one right before it, rather than being inert.
  test('the compare control links to the diff view between this revision and the one right before it', async () => {
    mockHistory({ status: 'success', revisions: TWO_REVISIONS });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const compare = component.get('a[href*="/diff"]');
    expect(compare.text()).toMatch(/compare with previous/i);
    // Newest-first: row 0 is rev-2, and "previous" is rev-1, the row right
    // after it — never the oldest revision on a longer list.
    expect(compare.attributes('href')).toBe(`/w/acme/p/page-1/diff?from=rev-1&to=rev-2`);
    expect(compare.attributes('aria-disabled')).toBeUndefined();
  });

  test('an author-less revision renders a named fallback, never a blank row', async () => {
    mockHistory({
      status: 'success',
      revisions: [{ id: 'rev-1', authorId: null, authorDisplayName: null, createdAt: '2026-01-01T00:00:00.000Z', changesetId: null, contentHash: 'hash-1' }],
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.get('main li').text()).toMatch(/unknown author/i);
  });

  test('renders a single not-found state — absence and denial are indistinguishable here', async () => {
    mockHistory({ status: 'not-found' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/does not exist/i);
    expect(component.findAll('main li')).toHaveLength(0);
  });


  // docs/UI-CHECKLIST.md §3, "never a dead end": the denied and not-found
  // notices were prose with no link (audit, 2026-09-14) while `error.vue`
  // offers "Your workspaces" and "Sign in". They now give the same two
  // doors; the copy that keeps absence and denial indistinguishable is
  // `error.vue`'s reviewed paragraph, verbatim, so one copy exists.
  test('the not-found notice offers the workspaces list and sign-in, with the error screen’s copy', async () => {
    mockHistory({ status: 'not-found' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.find('main a[href="/workspaces"]').exists()).toBe(true);
    expect(component.find('main a[href="/login"]').exists()).toBe(true);
    expect(component.text()).toMatch(/deliberately doesn't say which/);
  });

  // Revisions minted before `savePage()` refused byte-identical saves
  // (docs/TODO.md Findings, 2026-09-17) store the same bytes as the one
  // before them. The row is real history and stays; what it offers is
  // honest: it says so, and "Compare with previous" is unavailable with
  // that reason rather than a link to a diff that shows nothing
  // (docs/UI-CHECKLIST.md §3 "Disabled — explains why", §5 `aria-disabled`).
  test('a revision storing the same bytes as the previous one says so, and its compare control is unavailable with the reason', async () => {
    mockHistory({
      status: 'success',
      revisions: [
        { id: 'rev-3', authorId: 'user-1', authorDisplayName: 'Ada', createdAt: '2026-01-03T00:00:00.000Z', changesetId: null, contentHash: 'hash-2' },
        ...TWO_REVISIONS,
      ],
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const items = component.findAll('main li');
    expect(items).toHaveLength(3);
    expect(items[0]!.text()).toMatch(/same content as the previous revision/i);
    expect(items[0]!.find('a[href*="/diff"]').exists()).toBe(false);
    const compare = items[0]!.findAll('button, a').find((el) => /compare with previous/i.test(el.text()))!;
    expect(compare.attributes('aria-disabled')).toBe('true');
    const tooltipTexts = component.findAllComponents({ name: 'UTooltip' }).map((tooltip) => String(tooltip.props('text')));
    expect(tooltipTexts.some((text) => /nothing to compare/i.test(text))).toBe(true);
    // The genuinely different neighbour below keeps its link.
    expect(items[1]!.text()).not.toMatch(/same content as the previous revision/i);
    expect(items[1]!.find('a[href="/pages/page-1/diff?from=rev-1&to=rev-2"]').exists()).toBe(true);
  });

  test('the app bar’s way to the page is "Read page" with the eye, the same chrome edit mode uses', async () => {
    mockHistory({ status: 'success' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    // In the bar's actions, not its breadcrumb — the page crumb links to
    // the same address, and is the frame's, not this screen's.
    const back = component.get('header [data-slot="right"] a[href="/w/acme/p/page-1"]');
    expect(back.text()).toBe('Read page');
  });

  test('the empty state names the object and offers a path forward, distinct from not-found', async () => {
    mockHistory({ status: 'success', revisions: [] });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/no revisions yet/i);
    expect(component.find('a[href*="/edit"]').exists()).toBe(true);
  });

  test('renders a recoverable error state with a retry action that reloads', async () => {
    const load = mockHistory({ status: 'network-error', message: 'Cannot reach the server.' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const retry = component.get('button[data-testid="history-retry"]');
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

  // One `<h1>` in every state, for the accessibility tree; visibly, the
  // screen's identity is the breadcrumb's, so the heading is `sr-only` and
  // no heading block — no title repeated, no supporting sentence — stands
  // between the bar and the list (the document-frame residue the owner
  // reacted to on 2026-09-15). The notices keep their `h2`.
  test('renders exactly one h1 for the screen, for the accessibility tree only, in every state', async () => {
    const states: Parameters<typeof mockHistory>[0][] = [
      { status: 'success', revisions: TWO_REVISIONS },
      { status: 'success', revisions: [] },
      { status: 'not-found' },
      { status: 'loading' },
    ];
    for (const state of states) {
      mockHistory(state);
      const component = await mountSuspended(PageInApp, FRAME_STUBS);

      const headings = component.findAll('h1');
      expect(headings, state!.status).toHaveLength(1);
      expect(headings[0]!.text()).toBe('Revision history');
      expect(headings[0]!.classes(), 'the heading is for assistive technology; the breadcrumb is the visible identity').toContain('sr-only');
      expect(component.get('main').text()).not.toMatch(/Every saved version of this page/);
      component.unmount();
    }
  });

  /*
   * The screen opts into the workspace layout, so the sidebar around it is
   * the one the layout mounted and the tree keeps its scroll when the
   * person arrives here from the read screen. The record is read from the
   * application's router; that the sidebar survives is `e2e/frame.spec.ts`'s.
   */
  test('stands inside the workspace layout', async () => {
    mockHistory({ status: 'success', revisions: TWO_REVISIONS });
    await mountSuspended(PageInApp, FRAME_STUBS);
    const { useRouter } = await import('#imports');

    expect(useRouter().getRoutes().find((route) => route.path === '/w/:workspace()/p/:id()/history')?.meta.layout).toBe('workspace');
  });

  // Where the person is: workspace › shelf › book › page — through the
  // tree, since the history response names no workspace and no title —
  // then the trailing crumb this screen adds. The page crumb is the link
  // back to reading it; "History" is where they are.
  test('the breadcrumb walks from the workspace to the page and ends in a History crumb', async () => {
    mockHistory({ status: 'success', revisions: TWO_REVISIONS });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const nav = component.get('nav[aria-label="Where you are"]');
    const crumbs = nav.findAll('li').map((li) => li.text()).filter(Boolean);
    expect(crumbs).toEqual(['Acme', 'Engineering', 'Handbook', 'A Page', 'History']);
    expect(nav.find('a[href="/w/acme/p/page-1"]').exists()).toBe(true);
  });

  // The bar's actions: this screen's one way out, and nothing of the
  // frame's (the doors are in the sidebar). The compare controls are each
  // row's own, in the column.
  test('the contextual bar carries only "Read page"; each row keeps its own compare action in the column', async () => {
    mockHistory({ status: 'success', revisions: TWO_REVISIONS });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const actions = component.get('header [data-slot="right"]');
    expect(actions.findAll('a').map((a) => a.attributes('href'))).toEqual(['/w/acme/p/page-1']);
    expect(actions.find('a[href*="/diff"]').exists()).toBe(false);
    expect(component.get('main li a[href*="/diff"]').text()).toMatch(/compare with previous/i);
  });
});
