import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import HistoryPage from './history.vue';

const { useBookHistoryMock, useRouteMock } = vi.hoisted(() => ({
  useBookHistoryMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { id: 'book-1' } })),
}));

mockNuxtImport('useBookHistory', () => useBookHistoryMock);
mockNuxtImport('useRoute', () => useRouteMock);

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
    expect(items[1]!.findAll('a[href="/pages/page-1"]')).toHaveLength(1);
    expect(items[1]!.findAll('a[href="/pages/page-2"]')).toHaveLength(1);
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
    expect(href).toBe(`/books/book-1/diff?since=${encodeURIComponent('2026-01-01T23:59:59.999Z')}`);
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
    expect(component.find('a[href="/workspaces/ws-1"]').exists()).toBe(true);
  });

  test('the empty state has a way forward: the tree the book lives in', async () => {
    mockHistory({ status: 'success', changesets: [] });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/no changes yet/i);
    const notice = component.get('[role="status"]');
    expect(notice.find('a[href="/workspaces/ws-1"]').exists()).toBe(true);
  });
});
