import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import type { CommentThread } from '@deep-wiki/contracts';
import ReadPage from './index.vue';

const { usePageReadMock, usePresenceStreamMock, usePageCommentsMock, useRouteMock, useWorkspaceTreeMock, useWorkspaceDirectoryMock } = vi.hoisted(() => ({
  usePageReadMock: vi.fn(),
  usePresenceStreamMock: vi.fn(),
  usePageCommentsMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { id: 'page-1' } })),
  useWorkspaceTreeMock: vi.fn(),
  useWorkspaceDirectoryMock: vi.fn(),
}));

mockNuxtImport('usePageRead', () => usePageReadMock);
mockNuxtImport('usePresenceStream', () => usePresenceStreamMock);
mockNuxtImport('usePageComments', () => usePageCommentsMock);
mockNuxtImport('useRoute', () => useRouteMock);
mockNuxtImport('useWorkspaceTree', () => useWorkspaceTreeMock);
mockNuxtImport('useWorkspaceDirectory', () => useWorkspaceDirectoryMock);

/**
 * The frame's own collaborators — the sidebar's tree and the workspace
 * directory — are stubbed so this file stays about the read screen. The
 * tree places `page-1` under a shelf and a book, which is what the
 * breadcrumb test below reads.
 */
function mockFrame() {
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
  });
}

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(ReadPage) }),
});

/** Every mount is unmounted after its test: the thread panel teleports into `document.body`, and a dialog left open would leak into the next test's queries. */
const mounted: Awaited<ReturnType<typeof mountSuspended>>[] = [];

async function mount() {
  const wrapper = await mountSuspended(PageInApp);
  mounted.push(wrapper);
  return wrapper;
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function mockRead(overrides: Partial<{ status: string; html: string; title: string; message: string; workspaceId: string | null }> = {}) {
  const load = vi.fn(async () => {});
  usePageReadMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    html: ref(overrides.html ?? ''),
    title: ref(overrides.title ?? ''),
    message: ref(overrides.message ?? ''),
    workspaceId: ref(overrides.workspaceId ?? null),
    load,
  });
  mockPresence();
  mockComments();
  mockFrame();
  return load;
}

function commentThread(overrides: Partial<CommentThread> & { id: string; blockId?: string; orphaned?: boolean }): CommentThread {
  const { blockId = 'b1', orphaned = false, ...rest } = overrides;
  return {
    body: `Body of ${overrides.id}`,
    author: { id: 'u1', displayName: 'Ana' },
    createdAt: '2026-01-01T00:00:00.000Z',
    anchor: { blockId, offsetStart: 0, offsetEnd: 4, quote: `Quote of ${overrides.id}`, orphaned },
    resolved: false,
    resolvedAt: null,
    replies: [],
    ...rest,
  };
}

/**
 * The comments composable, mocked at its boundary the way presence is; the
 * derived `indicators`/`orphaned` are recomputed here from the threads so
 * the mock cannot disagree with the real composable about what a mark
 * means (`usePageComments.test.ts` holds that derivation).
 */
function mockComments(threads: readonly CommentThread[] = [], status: string = 'success') {
  const load = vi.fn(async () => {});
  const byBlock = new Map<string, number>();
  for (const thread of threads) {
    if (thread.anchor.orphaned) continue;
    byBlock.set(thread.anchor.blockId, (byBlock.get(thread.anchor.blockId) ?? 0) + 1 + thread.replies.length);
  }
  usePageCommentsMock.mockReturnValue({
    status: ref(status),
    threads: ref(threads),
    indicators: computed(() => [...byBlock.entries()].map(([blockId, count]) => ({ blockId, count }))),
    orphaned: computed(() => threads.filter((thread) => thread.anchor.orphaned)),
    message: ref(status === 'network-error' ? "Couldn't load this page's comments. Check your connection and try again." : ''),
    writeMessage: ref(null),
    load,
    reply: vi.fn(async () => true),
    setResolved: vi.fn(async () => true),
  });
  return load;
}

const ANCHORED_HTML = '<p data-block-id="b1">First block.</p><p data-block-id="b2">Second block.</p>';

async function settle(): Promise<void> {
  await nextTick();
  await nextTick();
  await nextTick();
}

function mockPresence(editors: readonly { userId: string; userDisplayName: string; since: string }[] = []) {
  const start = vi.fn();
  usePresenceStreamMock.mockReturnValue({
    editors: ref(editors),
    connectionMode: ref('idle'),
    start,
    stop: vi.fn(),
  });
  return start;
}

describe('read-mode page', () => {
  /*
   * The screen opts into the workspace layout, so the sidebar around it is
   * the one the layout mounted and survives the navigation that brought
   * the person here. The record is read from the application's router;
   * that the tree's scroll and fold state actually survive is
   * `e2e/frame.spec.ts`'s claim ("the sidebar survives a navigation").
   */
  test('stands inside the workspace layout', async () => {
    mockRead({ status: 'success', title: 'A Page', html: '<p>Hello from cache</p>' });
    await mount();
    const { useRouter } = await import('#imports');

    expect(useRouter().getRoutes().find((route) => route.path === '/pages/:id()')?.meta.layout).toBe('workspace');
  });

  // Presence only. The §3 guarantee that the skeleton occupies the loaded
  // box is a measurement, and happy-dom has no layout engine: its owner is
  // `e2e/read.spec.ts` ("the read skeleton occupies the box…").
  test('renders the loading skeleton, not a spinner, while the request is in flight', async () => {
    mockRead({ status: 'loading' });
    const component = await mount();

    expect(component.find('[data-testid="read-skeleton"]').exists()).toBe(true);
  });

  test('renders the page title as the one h1 and the cached HTML as body content, with the semantic landmarks', async () => {
    mockRead({ status: 'success', title: 'A Page', html: '<p>Hello from cache</p>' });
    const component = await mount();

    // The workspace frame: the contextual bar is the pane's header, the
    // column is the one main, and the sidebar is the navigation landmark.
    // No footer — the frame's doors are in the sidebar.
    expect(component.find('header').exists()).toBe(true);
    expect(component.findAll('main')).toHaveLength(1);
    expect(component.find('[role="navigation"][aria-label="Workspace"]').exists()).toBe(true);
    expect(component.find('footer').exists()).toBe(false);
    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe('A Page');
    expect(component.html()).toContain('Hello from cache');
  });

  test('renders a distinct permission-denied state on forbidden, not a generic error, and withholds Edit', async () => {
    mockRead({ status: 'forbidden' });
    const component = await mount();

    expect(component.text()).toMatch(/don't have access/i);
    expect(component.text()).not.toMatch(/does not exist/i);
    expect(component.find('a[href*="/edit"]').exists()).toBe(false);
    expect(component.find('a[href*="/history"]').exists()).toBe(false);
  });

  test('renders a distinct not-found state, different from permission-denied, and withholds Edit', async () => {
    mockRead({ status: 'not-found' });
    const component = await mount();

    expect(component.text()).toMatch(/does not exist/i);
    // Distinct from the denied heading — the not-found paragraph itself
    // mentions access, deliberately, because it does not disclose.
    expect(component.text()).not.toMatch(/You don't have access to this page/);
    expect(component.find('a[href*="/edit"]').exists()).toBe(false);
    expect(component.find('a[href*="/history"]').exists()).toBe(false);
  });


  // docs/UI-CHECKLIST.md §3, "never a dead end": the denied and not-found
  // notices were prose with no link (audit, 2026-09-14) while `error.vue`
  // offers "Your workspaces" and "Sign in". They now give the same two
  // doors; the copy that keeps absence and denial indistinguishable is
  // `error.vue`'s reviewed paragraph, verbatim, so one copy exists.
  test('the denied and not-found notices each offer the workspaces list and sign-in, like the error screen', async () => {
    for (const status of ['forbidden', 'not-found'] as const) {
      mockRead({ status });
      const component = await mount();

      expect(component.find('main a[href="/workspaces"]').exists(), status).toBe(true);
      expect(component.find('main a[href="/login"]').exists(), status).toBe(true);
      component.unmount();
    }
  });

  test('the not-found copy is the error screen’s, which says out loud that it does not disclose', async () => {
    mockRead({ status: 'not-found' });
    const component = await mount();

    expect(component.text()).toMatch(/deliberately doesn't say which/);
  });

  test('renders a recoverable error state with a retry action that reloads', async () => {
    const load = mockRead({ status: 'network-error', message: 'Cannot reach the server.' });
    const component = await mount();

    const retry = component.get('button[data-testid="read-retry"]');
    await retry.trigger('click');

    expect(load).toHaveBeenCalled();
  });

  /**
   * The affordance that makes `/pages/:id/history` a shipped screen
   * rather than a URL. It existed, was tested, and had passing e2e, and
   * nothing anywhere linked to it — the same class of defect as the
   * route module nobody mounted, twice (scripts/checks/routes-mounted.ts).
   *
   * It is icon-only, which docs/UI-CHECKLIST.md §4.3 permits only "where
   * space genuinely forbids" a visible label — so the space was measured
   * rather than assumed. At 320x900 the app bar holds the brand (143px at
   * x=8), "Edit" (64px at x=206) and the theme toggle (28px at x=276),
   * leaving **55px** between the brand and Edit. A labelled control of
   * Edit's shape needs ~64px plus the 6px gap before "History" is even
   * spelled longer than "Edit". So the label does not fit, and §4.3's
   * exception — an accessible name *plus* a tooltip, both — is what
   * applies. That is also the existing pattern one element to the right:
   * the theme toggle is the chrome's other icon-only control and carries
   * exactly the same pair (checklist §4.1, match the nearest control).
   */
  test('offers this page’s revision history from the app bar, as a real link', async () => {
    mockRead({ status: 'success', title: 'A Page', html: '<p>Hello from cache</p>' });
    const component = await mount();

    expect(component.find('header a[href="/pages/page-1/history"]').exists()).toBe(true);
  });

  test('the icon-only history control carries both an accessible name and a tooltip, and the name says what it is for', async () => {
    mockRead({ status: 'success', title: 'A Page', html: '<p>Hello from cache</p>' });
    const component = await mount();

    const history = component.get('header a[href="/pages/page-1/history"]');
    // "History" alone is ambiguous out of context — history of what?
    // The name matches the `<h1>` the link lands on.
    expect(history.attributes('aria-label')).toBe('Revision history');
    // No visible text: the name is the only carrier, which is exactly
    // why §4.3 demands the tooltip as well.
    expect(history.text()).toBe('');
    // Reka's tooltip trigger. Without it the glyph is unnamed for a
    // sighted mouse user, whose icon pack may draw it differently.
    expect(history.attributes('data-state')).toBeDefined();
  });

  /*
   * Where the person is, above the article: workspace › shelf › book ›
   * page, placed through the tree the sidebar already holds once the
   * response has named the workspace — the page's title alone until then.
   */
  test('the breadcrumb walks from the workspace to this page once the response names the workspace', async () => {
    mockRead({ status: 'success', title: 'A Page', html: '<p>Hello</p>', workspaceId: 'ws-1' });
    const component = await mount();

    const crumbs = component.get('nav[aria-label="Where you are"]').findAll('li').map((li) => li.text()).filter(Boolean);
    expect(crumbs).toEqual(['Acme', 'Engineering', 'Handbook', 'A Page']);
  });

  test('the history control keeps its own tab stop and precedes the higher-emphasis Edit transition', async () => {
    mockRead({ status: 'success', title: 'A Page', html: '<p>Hello from cache</p>' });
    const component = await mount();

    const header = component.get('header').element;
    const links = Array.from(header.querySelectorAll('[data-slot="right"] a')).map((anchor) => anchor.getAttribute('href'));
    // The contextual bar: this screen's own controls only — the quieter
    // navigation, then the emphasised one, the order edit mode already
    // uses for "Read page" before "Save" (docs/DESIGN-SYSTEM.md §9.1's
    // emphasis ladder). The shell's doors (registration, the theme
    // toggle) live in the sidebar's footer now, not in this bar; the
    // breadcrumb's links are counted separately below. Enumerated in
    // full on purpose: this is what catches a control silently dropping
    // out of the sequence.
    expect(links).toEqual(['/pages/page-1/history', '/pages/page-1/edit']);
    // A link, not a click handler: reachable and operable by keyboard
    // with no JavaScript of its own (checklist §5).
    expect(component.get('header a[href="/pages/page-1/history"]').element.tagName).toBe('A');
  });

  test('the history control is kept while the page is still loading, and withheld only where its route is a dead end', async () => {
    mockRead({ status: 'loading' });
    const component = await mount();

    // Transient, and the page may well resolve into something with a
    // history — the same call `Edit` already makes.
    expect(component.find('a[href*="/history"]').exists()).toBe(true);
  });

  // editing-presence spec (docs/UI-CHECKLIST.md §4.8): who is editing this
  // page, and since when. The wiring itself — render whatever
  // `usePresenceStream` reports — is independent of *whether* this screen
  // can currently open the stream (see index.vue's own header comment for
  // that gap), so it is testable and tested on its own.
  test('shows who is editing this page and since when, once presence reports it', async () => {
    mockRead({ status: 'success', title: 'A Page', html: '<p>Hello</p>' });
    mockPresence([{ userId: 'u1', userDisplayName: 'Ana', since: '2026-01-01T00:00:00.000Z' }]);
    const component = await mount();

    expect(component.text()).toMatch(/Ana is editing/);
  });

  test('renders no presence indicator when nobody is editing', async () => {
    mockRead({ status: 'success', title: 'A Page', html: '<p>Hello</p>' });
    const component = await mount();

    // Scoped to the screen: the sidebar's tree toolbar keeps its own
    // always-present live region for its own announcements.
    expect(component.find('main [role="status"]').exists()).toBe(false);
  });

  // editing-presence spec: the stream is workspace-scoped
  // (`GET /workspaces/:workspaceId/presence/stream`), and until the read
  // response carried `workspaceId` this screen had nothing honest to open
  // it with — the only other source was the edit-session route, which
  // acquires the lock as a side effect. Now the read response names the
  // workspace, and the stream starts with exactly that id, once it is known.
  test('starts the presence stream with the workspace id the read response carries', async () => {
    mockRead({ status: 'success', title: 'A Page', html: '<p>Hello</p>', workspaceId: 'ws-1' });
    const start = mockPresence();
    await mount();

    expect(start).toHaveBeenCalledWith('ws-1');
  });

  test('never starts the presence stream before the workspace id is known', async () => {
    mockRead({ status: 'loading' });
    const start = mockPresence();
    await mount();

    expect(start).not.toHaveBeenCalled();
  });

  /**
   * The comment overlay (comment-overlay spec; tasks.md 10.7 and 10.9).
   * Composed over the cached HTML: the article is rendered exactly as it
   * arrived and the marks are positioned against the `data-block-id`
   * attributes `render()` emitted. The page under test carries anchored
   * blocks in every case below — a gutter test on a page with no anchored
   * blocks would pass against a gutter that never draws anything.
   */
  describe('comment overlay', () => {
    test('fetches the threads once, alongside the page, and draws one mark beside each commented block', async () => {
      mockRead({ status: 'success', title: 'A Page', html: ANCHORED_HTML });
      const load = mockComments([commentThread({ id: 't1', blockId: 'b1' }), commentThread({ id: 't2', blockId: 'b1' })]);
      const component = await mount();
      await settle();

      expect(load).toHaveBeenCalledTimes(1);
      expect(component.get('article').html()).toContain('data-block-id="b1"');
      const marks = component.findAll('button[aria-label$="on this block"]');
      expect(marks.map((mark) => mark.attributes('aria-label'))).toEqual(['2 comments on this block']);
    });

    // The API answers `{ threads: [] }` for a read-only caller, byte-identical
    // to a page with no comments. The page has anchored blocks; the client
    // must still draw nothing — no gutter, no chip, no panel.
    test('a read-only caller sees no gutter and no chip, even on a page whose blocks are anchored', async () => {
      mockRead({ status: 'success', title: 'A Page', html: ANCHORED_HTML });
      mockComments([]);
      const component = await mount();
      await settle();

      expect(component.find('button[aria-label$="on this block"]').exists()).toBe(false);
      expect(component.find('[data-notice-tier="chip"]').exists()).toBe(false);
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });

    test('a mark opens the panel on that block and highlights the block; closing the panel drops the highlight', async () => {
      mockRead({ status: 'success', title: 'A Page', html: ANCHORED_HTML });
      mockComments([commentThread({ id: 't1', blockId: 'b2' })]);
      const component = await mount();
      await settle();

      expect(component.find('[data-testid="comment-highlight"]').exists()).toBe(false);
      await component.get('button[aria-label="1 comment on this block"]').trigger('click');
      await settle();

      const dialog = document.body.querySelector('[role="dialog"]');
      expect(dialog?.textContent).toContain('Quote of t1');
      expect(component.find('[data-testid="comment-highlight"]').exists()).toBe(true);
      expect(component.get('button[aria-label="1 comment on this block"]').attributes('aria-pressed')).toBe('true');

      document.body.querySelector<HTMLElement>('[role="dialog"] button[aria-label="Close"]')!.click();
      await settle();
      expect(component.find('[data-testid="comment-highlight"]').exists()).toBe(false);
    });

    // comment-threads spec: "Orphan Is A First-Class State, Never An
    // Error". The thread here IS orphaned; the sibling assertion proves the
    // chip is absent when it is not, so the test cannot pass on a chip that
    // always renders.
    test('an orphaned thread is surfaced above the article, in words, with a way to read it', async () => {
      mockRead({ status: 'success', title: 'A Page', html: ANCHORED_HTML });
      mockComments([commentThread({ id: 't1', blockId: 'b1' }), commentThread({ id: 't2', blockId: 'gone', orphaned: true })]);
      const component = await mount();
      await settle();

      const chip = component.get('[data-testid="comments-orphaned"]');
      expect(chip.text()).toMatch(/1 comment points at text that is no longer on this page/);
      // Not a mark: an orphan has no block to stand beside.
      expect(component.findAll('button[aria-label$="on this block"]')).toHaveLength(1);

      await chip.get('button').trigger('click');
      await settle();
      const orphan = document.body.querySelector('[data-comment-placement="orphaned"]');
      expect(orphan?.textContent).toContain('Quote of t2');
      expect(orphan?.textContent).toMatch(/no longer on this page/);
    });

    test('no orphan chip renders when every thread is still anchored', async () => {
      mockRead({ status: 'success', title: 'A Page', html: ANCHORED_HTML });
      mockComments([commentThread({ id: 't1', blockId: 'b1' })]);
      const component = await mount();
      await settle();

      expect(component.find('[data-testid="comments-orphaned"]').exists()).toBe(false);
    });

    // design.md Decision 6: a cached render that predates `data-block-id`
    // means "no anchors known", not an error — and not a blank page either.
    test('a page whose cached render carries no anchors says its comments cannot be placed yet, and still offers them', async () => {
      mockRead({ status: 'success', title: 'A Page', html: '<p>First block.</p><p>Second block.</p>' });
      mockComments([commentThread({ id: 't1', blockId: 'b1' }), commentThread({ id: 't2', blockId: 'b2' })]);
      const component = await mount();
      await settle();

      expect(component.find('button[aria-label$="on this block"]').exists()).toBe(false);
      const chip = component.get('[data-testid="comments-unplaced"]');
      expect(chip.text()).toMatch(/2 comments can't be shown beside their text until this page is re-rendered/);

      await chip.get('button').trigger('click');
      await settle();
      const placements = Array.from(document.body.querySelectorAll<HTMLElement>('[data-comment-placement]')).map((el) => el.dataset.commentPlacement);
      expect(placements).toEqual(['unplaced', 'unplaced']);
    });

    test('a failed comments request is a recoverable chip with Retry, and never hides the page', async () => {
      mockRead({ status: 'success', title: 'A Page', html: ANCHORED_HTML });
      const load = mockComments([], 'network-error');
      const component = await mount();
      await settle();

      expect(component.get('h1').text()).toBe('A Page');
      const chip = component.get('[data-testid="comments-error"]');
      expect(chip.attributes('role')).toBe('alert');
      await chip.get('button').trigger('click');
      expect(load).toHaveBeenCalledTimes(2);
    });
  });
});
