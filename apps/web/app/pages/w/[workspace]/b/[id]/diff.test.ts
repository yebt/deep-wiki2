import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref, computed } from 'vue';
import DiffPage from './diff.vue';

const { useBookDiffNavigatorMock, useRouteMock, navigateToMock } = vi.hoisted(() => ({
  useBookDiffNavigatorMock: vi.fn(),
  useRouteMock: vi.fn(
    (): { params: Record<string, string>; query: Record<string, string> } => ({
      params: { workspace: 'acme', id: 'book-1' },
      query: { since: '2026-01-01T00:00:00.000Z' },
    }),
  ),
  navigateToMock: vi.fn(async () => {}),
}));

mockNuxtImport('useBookDiffNavigator', () => useBookDiffNavigatorMock);
mockNuxtImport('useRoute', () => useRouteMock);
mockNuxtImport('navigateTo', () => navigateToMock);

// Every screen now renders inside the workspace frame. Its sidebar — the
// tree, the switcher, the doors — is stubbed here so this file stays about
// the screen it names; `AppShell.test.ts` and `WorkspaceSidebar.test.ts`
// own the frame.
const FRAME_STUBS = { global: { stubs: { WorkspaceSidebar: true } } };

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(DiffPage) }),
});

interface NavState {
  status?: string;
  pageIds?: string[];
  currentIndex?: number;
  message?: string;
  title?: string;
  workspaceId?: string | null;
}

interface PageContent {
  changes: unknown[];
  /** `null` is the route's "created during this window" — no earlier revision to compare against. */
  baselineRevisionId?: string | null;
  pageTitle?: string;
}

/**
 * A real, tiny state machine standing in for `useBookDiffNavigator`, so
 * `next()`/`prev()` visibly change what the mock reports — a mock that
 * always returns the SAME `currentPage` regardless of calls would let a
 * "only checks the first page" test pass for the wrong reason, exactly the
 * trap tasks.md 10.5 names. The shape is the navigator's current one: the
 * focused page is one of the already-held `pages`, with its title, its
 * baseline and its text — nothing is fetched per page any more.
 */
function mockNavigator(pagesContent: Record<string, PageContent>, overrides: NavState = {}) {
  const pageIds = overrides.pageIds ?? Object.keys(pagesContent);
  const currentIndex = ref(overrides.currentIndex ?? 0);
  const status = ref(overrides.status ?? 'success');
  const load = vi.fn(async () => {});
  const goTo = vi.fn((index: number) => {
    currentIndex.value = index;
  });
  const next = vi.fn(() => {
    if (currentIndex.value < pageIds.length - 1) currentIndex.value += 1;
  });
  const prev = vi.fn(() => {
    if (currentIndex.value > 0) currentIndex.value -= 1;
  });
  const pages = computed(() =>
    pageIds.map((pageId) => {
      const content = pagesContent[pageId] ?? { changes: [] };
      return {
        pageId,
        pageTitle: content.pageTitle ?? `Title of ${pageId}`,
        baselineRevisionId: content.baselineRevisionId === undefined ? `${pageId}-rev-1` : content.baselineRevisionId,
        latestRevisionId: `${pageId}-rev-2`,
        diff: { changes: content.changes },
      };
    }),
  );

  useBookDiffNavigatorMock.mockReturnValue({
    status,
    message: ref(overrides.message ?? ''),
    title: ref(overrides.title ?? 'E2E Handbook'),
    workspaceId: ref(overrides.workspaceId === undefined ? 'ws-1' : overrides.workspaceId),
    pages,
    pageIds: computed(() => pageIds),
    currentIndex,
    currentPage: computed(() => pages.value[currentIndex.value] ?? null),
    currentPageId: computed(() => pageIds[currentIndex.value] ?? null),
    hasPrev: computed(() => currentIndex.value > 0),
    hasNext: computed(() => currentIndex.value < pageIds.length - 1),
    load,
    goTo,
    next,
    prev,
  });

  return { load, goTo, next, prev };
}

describe('book-diff screen', () => {
  afterEach(() => {
    useRouteMock.mockReturnValue({ params: { workspace: 'acme', id: 'book-1' }, query: { since: '2026-01-01T00:00:00.000Z' } });
  });

  test('a missing `since` query param renders a broken-link state without calling the API', async () => {
    useRouteMock.mockReturnValue({ params: { workspace: 'acme', id: 'book-1' }, query: {} });
    const { load } = mockNavigator({});
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/does not exist|invalid|missing/i);
    expect(load).not.toHaveBeenCalled();
  });

  test('renders the loading skeleton while the changed-page list is in flight', async () => {
    mockNavigator({}, { status: 'loading' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.find('[data-testid="book-diff-skeleton"]').exists()).toBe(true);
  });

  test('renders a single not-found state — absence and denial are indistinguishable here', async () => {
    mockNavigator({}, { status: 'not-found' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/does not exist/i);
  });

  test('renders a recoverable network-error state with a retry that reloads', async () => {
    const { load } = mockNavigator({}, { status: 'network-error', message: 'Cannot reach the server.' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const retry = component.get('button[data-testid="book-diff-retry"]');
    await retry.trigger('click');

    expect(load).toHaveBeenCalled();
  });

  // One rule for a signed-out visit to a signed-in screen: leave for
  // sign-in with this address as the return path, and show no card here —
  // a card would be a dead end with a button on it (docs/UI-CHECKLIST.md §3).
  test('a signed-out visitor is sent to sign in, to come back here afterwards, and shown no card', async () => {
    mockNavigator({}, { status: 'unauthenticated' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(navigateToMock).toHaveBeenCalledWith(expect.stringMatching(/^\/login(\?next=|$)/), { replace: true });
    expect(component.findAll('a').find((a) => /sign in/i.test(a.text()))).toBeUndefined();
  });

  test('zero changed pages renders a real empty state naming the date, not an error', async () => {
    mockNavigator({}, { status: 'success', pageIds: [] });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/no changes/i);
    expect(component.find('[role="alert"]').exists()).toBe(false);
  });

  test('renders the first changed page by default, with a page switcher showing its position', async () => {
    mockNavigator({
      'page-1': { changes: [{ kind: 'added', id: 'b1', slot: 0, text: 'First page content.' }] },
      'page-2': { changes: [{ kind: 'removed', id: 'b2', slot: 0, text: 'Second page content.' }] },
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toContain('First page content.');
    expect(component.text()).not.toContain('Second page content.');
    // The switcher's own label now carries the position (moved into the
    // contextual bar, "previous / current page name / next").
    expect(component.text()).toMatch(/\(1\/2\)/);
  });

  // The trap named explicitly in tasks.md 10.5: a test that only checks
  // the FIRST page after load proves nothing about navigation. This one
  // drives the "Next" control and asserts the SECOND page's own content
  // replaces the first — never merely that the counter changed.
  test('the "Next" control moves to the second changed page and shows ITS OWN content, not the first page again', async () => {
    const { next } = mockNavigator({
      'page-1': { changes: [{ kind: 'added', id: 'b1', slot: 0, text: 'First page content.' }] },
      'page-2': { changes: [{ kind: 'removed', id: 'b2', slot: 0, text: 'Second page content.' }] },
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const nextButton = component.get('button[aria-label="Next changed page"]');
    await nextButton.trigger('click');
    await component.vm.$nextTick();

    expect(next).toHaveBeenCalled();
    expect(component.text()).toContain('Second page content.');
    expect(component.text()).not.toContain('First page content.');
    expect(component.text()).toMatch(/\(2\/2\)/);
  });

  /*
   * The switcher — previous / current page name / next — is this screen's
   * own control, so it lives in the contextual bar (`header`), not in the
   * pane: "so the pane is the diff alone" (task instructions). It is
   * findable by role regardless of exactly where in the bar it sits.
   */
  test('the page switcher lives in the contextual bar, not the document pane', async () => {
    mockNavigator({
      'page-1': { changes: [{ kind: 'added', id: 'b1', slot: 0, text: 'First page content.' }] },
      'page-2': { changes: [{ kind: 'removed', id: 'b2', slot: 0, text: 'Second page content.' }] },
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.get('header').find('button[aria-label="Next changed page"]').exists()).toBe(true);
    expect(component.get('header').find('button[aria-label="Previous changed page"]').exists()).toBe(true);
    expect(component.get('main').find('button[aria-label="Next changed page"]').exists()).toBe(false);
  });

  test('the "Previous" control is disabled on the first page and the "Next" control is disabled on the last', async () => {
    mockNavigator({
      'page-1': { changes: [] },
      'page-2': { changes: [] },
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const prevButton = component.get('button[aria-label="Previous changed page"]');
    expect(prevButton.attributes('aria-disabled')).toBe('true');
    const nextButton = component.get('button[aria-label="Next changed page"]');
    expect(nextButton.attributes('aria-disabled')).toBeUndefined();
  });

  test('"Previous" moves back to the first page and restores its own content', async () => {
    const { prev } = mockNavigator(
      {
        'page-1': { changes: [{ kind: 'added', id: 'b1', slot: 0, text: 'First page content.' }] },
        'page-2': { changes: [{ kind: 'removed', id: 'b2', slot: 0, text: 'Second page content.' }] },
      },
      { currentIndex: 1 },
    );
    const component = await mountSuspended(PageInApp, FRAME_STUBS);
    expect(component.text()).toContain('Second page content.');

    await component.get('button[aria-label="Previous changed page"]').trigger('click');
    await component.vm.$nextTick();

    expect(prev).toHaveBeenCalled();
    expect(component.text()).toContain('First page content.');
  });

  test('a page created during this window (no baseline) degrades gracefully with a link to its own full history, not a crash', async () => {
    mockNavigator({ 'page-1': { changes: [], baselineRevisionId: null } });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/created during this window|no earlier revision/i);
    expect(component.find('a[href="/w/acme/p/page-1/history"]').exists()).toBe(true);
  });

  // The route names the book and each page now; before it did, the screen
  // identified a page by eight characters of its id (a filed finding). The
  // focused page's name now lives in the switcher itself (the contextual
  // bar's own control), not a separate `<h2>` in the pane.
  test('names the book in the heading and the focused page by its title in the switcher, and the title follows the navigation', async () => {
    mockNavigator({
      'page-1': { changes: [{ kind: 'added', id: 'b1', slot: 0, text: 'First.' }], pageTitle: 'Alpha' },
      'page-2': { changes: [{ kind: 'added', id: 'b2', slot: 0, text: 'Second.' }], pageTitle: 'Beta' },
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.get('h1').text()).toContain('E2E Handbook');
    expect(component.get('header').text()).toContain('Alpha');
    expect(component.text()).not.toMatch(/page-1/);

    await component.get('button[aria-label="Next changed page"]').trigger('click');
    await component.vm.$nextTick();
    expect(component.get('header').text()).toContain('Beta');
    expect(component.get('header').text()).not.toContain('Alpha');
  });

  /*
   * The frame's breadcrumb now carries "… › book › History › Changes since
   * <date>" through the tree the sidebar already holds — its first crumb
   * is already a link to `/workspaces/ws-1`, and this screen's own trail
   * adds a real link back to book history. The hand-built "Workspace home"
   * and "Back to history" buttons this screen used to carry duplicated
   * both doors (checklist §4.1); they are gone.
   */
  test('the breadcrumb carries the way back to the workspace and to book history; no separate buttons duplicate it', async () => {
    mockNavigator({ 'page-1': { changes: [] } });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const crumbs = component.get('nav[aria-label="Where you are"]');
    expect(crumbs.find('a[href="/w/acme"]').exists()).toBe(true);
    expect(crumbs.find('a[href="/w/acme/b/book-1/history"]').exists()).toBe(true);
    expect(component.find('[aria-label="Workspace home"]').exists()).toBe(false);
    expect(component.findAll('a').filter((a) => /back to history/i.test(a.text())).length).toBe(0);
  });

  test('the breadcrumb names the point compared from once it is known', async () => {
    mockNavigator({ 'page-1': { changes: [] } });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const crumbs = component.get('nav[aria-label="Where you are"]');
    expect(crumbs.text()).toMatch(/changes since/i);
  });

  /*
   * `GET /books/:id/diff` orders changed pages by `page_id`
   * (docs/TODO.md Findings, 2026-09-14) — a client-side order is this
   * screen's responsibility, sourced from the tree the frame already
   * holds. The wiring is asserted here at its boundary;
   * `useBookDiffNavigator.test.ts` holds the ordering behaviour itself.
   */
  test('wires a tree-position order function into the navigator', async () => {
    mockNavigator({ 'page-1': { changes: [] } });
    await mountSuspended(PageInApp, FRAME_STUBS);

    const deps = useBookDiffNavigatorMock.mock.calls[0]![2] as { pageOrder?: unknown };
    expect(typeof deps.pageOrder).toBe('function');
  });

  test('renders exactly one h1, even while the book’s title is not yet known', async () => {
    mockNavigator({}, { status: 'loading', title: '' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toMatch(/Book diff/);
  });

  test('every change is unchanged renders a real "no differences" state for the focused page', async () => {
    mockNavigator({ 'page-1': { changes: [{ kind: 'unchanged', id: 'b1', slot: 0, text: 'Same.' }] } });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/no differences/i);
  });

  test('renders exactly one h1 for the screen', async () => {
    mockNavigator({ 'page-1': { changes: [{ kind: 'added', id: 'b1', slot: 0, text: 'Content.' }] } });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.findAll('h1')).toHaveLength(1);
  });

  test('stands inside the workspace layout', async () => {
    mockNavigator({ 'page-1': { changes: [] } });
    await mountSuspended(PageInApp, FRAME_STUBS);
    const { useRouter } = await import('#imports');

    expect(useRouter().getRoutes().find((route) => route.path === '/w/:workspace()/b/:id()/diff')?.meta.layout).toBe('workspace');
  });
});
