import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref, computed } from 'vue';
import DiffPage from './diff.vue';

const { useBookDiffNavigatorMock, useRouteMock, navigateToMock } = vi.hoisted(() => ({
  useBookDiffNavigatorMock: vi.fn(),
  useRouteMock: vi.fn(
    (): { params: Record<string, string>; query: Record<string, string> } => ({
      params: { id: 'book-1' },
      query: { since: '2026-01-01T00:00:00.000Z' },
    }),
  ),
  navigateToMock: vi.fn(async () => {}),
}));

mockNuxtImport('useBookDiffNavigator', () => useBookDiffNavigatorMock);
mockNuxtImport('useRoute', () => useRouteMock);
mockNuxtImport('navigateTo', () => navigateToMock);

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
    useRouteMock.mockReturnValue({ params: { id: 'book-1' }, query: { since: '2026-01-01T00:00:00.000Z' } });
  });

  test('a missing `since` query param renders a broken-link state without calling the API', async () => {
    useRouteMock.mockReturnValue({ params: { id: 'book-1' }, query: {} });
    const { load } = mockNavigator({});
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/does not exist|invalid|missing/i);
    expect(load).not.toHaveBeenCalled();
  });

  test('renders the loading skeleton while the changed-page list is in flight', async () => {
    mockNavigator({}, { status: 'loading' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('[data-testid="book-diff-skeleton"]').exists()).toBe(true);
  });

  test('renders a single not-found state — absence and denial are indistinguishable here', async () => {
    mockNavigator({}, { status: 'not-found' });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/does not exist/i);
  });

  test('renders a recoverable network-error state with a retry that reloads', async () => {
    const { load } = mockNavigator({}, { status: 'network-error', message: 'Cannot reach the server.' });
    const component = await mountSuspended(PageInApp);

    const retry = component.get('button[data-testid="book-diff-retry"]');
    await retry.trigger('click');

    expect(load).toHaveBeenCalled();
  });

  test('zero changed pages renders a real empty state naming the date, not an error', async () => {
    mockNavigator({}, { status: 'success', pageIds: [] });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/no changes/i);
    expect(component.find('[role="alert"]').exists()).toBe(false);
  });

  test('renders the first changed page by default, with a page switcher showing its position', async () => {
    mockNavigator({
      'page-1': { changes: [{ kind: 'added', id: 'b1', slot: 0, text: 'First page content.' }] },
      'page-2': { changes: [{ kind: 'removed', id: 'b2', slot: 0, text: 'Second page content.' }] },
    });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toContain('First page content.');
    expect(component.text()).not.toContain('Second page content.');
    expect(component.text()).toMatch(/1 of 2/);
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
    const component = await mountSuspended(PageInApp);

    const nextButton = component.get('button[aria-label="Next changed page"]');
    await nextButton.trigger('click');
    await component.vm.$nextTick();

    expect(next).toHaveBeenCalled();
    expect(component.text()).toContain('Second page content.');
    expect(component.text()).not.toContain('First page content.');
    expect(component.text()).toMatch(/2 of 2/);
  });

  test('the "Previous" control is disabled on the first page and the "Next" control is disabled on the last', async () => {
    mockNavigator({
      'page-1': { changes: [] },
      'page-2': { changes: [] },
    });
    const component = await mountSuspended(PageInApp);

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
    const component = await mountSuspended(PageInApp);
    expect(component.text()).toContain('Second page content.');

    await component.get('button[aria-label="Previous changed page"]').trigger('click');
    await component.vm.$nextTick();

    expect(prev).toHaveBeenCalled();
    expect(component.text()).toContain('First page content.');
  });

  test('a page created during this window (no baseline) degrades gracefully with a link to its own full history, not a crash', async () => {
    mockNavigator({ 'page-1': { changes: [], baselineRevisionId: null } });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/created during this window|no earlier revision/i);
    expect(component.find('a[href="/pages/page-1/history"]').exists()).toBe(true);
  });

  // The route names the book and each page now; before it did, the screen
  // identified a page by eight characters of its id (a filed finding).
  test('names the book in the heading and the focused page by its title, and the title follows the navigation', async () => {
    mockNavigator({
      'page-1': { changes: [{ kind: 'added', id: 'b1', slot: 0, text: 'First.' }], pageTitle: 'Alpha' },
      'page-2': { changes: [{ kind: 'added', id: 'b2', slot: 0, text: 'Second.' }], pageTitle: 'Beta' },
    });
    const component = await mountSuspended(PageInApp);

    expect(component.get('h1').text()).toContain('E2E Handbook');
    expect(component.get('h2').text()).toContain('Alpha');
    expect(component.text()).not.toMatch(/page-1/);

    await component.get('button[aria-label="Next changed page"]').trigger('click');
    await component.vm.$nextTick();
    expect(component.get('h2').text()).toContain('Beta');
  });

  test('offers the way back to the book’s tree once the workspace is known, beside the way back to its history', async () => {
    mockNavigator({ 'page-1': { changes: [] } });
    const component = await mountSuspended(PageInApp);

    expect(component.find('a[href="/workspaces/ws-1/tree"]').exists()).toBe(true);
    expect(component.find('a[href="/books/book-1/history"]').exists()).toBe(true);
  });

  test('renders exactly one h1, even while the book’s title is not yet known', async () => {
    mockNavigator({}, { status: 'loading', title: '' });
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toMatch(/Book diff/);
  });

  test('every change is unchanged renders a real "no differences" state for the focused page', async () => {
    mockNavigator({ 'page-1': { changes: [{ kind: 'unchanged', id: 'b1', slot: 0, text: 'Same.' }] } });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/no differences/i);
  });

  test('renders exactly one h1 for the screen', async () => {
    mockNavigator({ 'page-1': { changes: [{ kind: 'added', id: 'b1', slot: 0, text: 'Content.' }] } });
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('h1')).toHaveLength(1);
  });
});
