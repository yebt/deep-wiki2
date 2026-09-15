import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import DashboardPanel from '~/components/DashboardPanel.vue';
import DashboardPage from './index.vue';

/**
 * The workspace's home: what changed and who is here. What this file holds
 * is that each column shows the data the endpoint and the stream hand it,
 * that every empty column teaches, and that a fresh workspace is one
 * sentence rather than four empty panels. Geometry — the columns at 1280
 * and the single column at 320 — is `e2e/dashboard.spec.ts`'s; happy-dom
 * has no layout engine.
 */
const { useWorkspaceActivityMock, usePresenceStreamMock, useRouteMock, useWorkspaceTreeMock, useWorkspaceDirectoryMock } = vi.hoisted(() => ({
  useWorkspaceActivityMock: vi.fn(),
  usePresenceStreamMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { workspaceId: 'ws-1' } })),
  useWorkspaceTreeMock: vi.fn(),
  useWorkspaceDirectoryMock: vi.fn(),
}));
mockNuxtImport('useWorkspaceActivity', () => useWorkspaceActivityMock);
mockNuxtImport('usePresenceStream', () => usePresenceStreamMock);
mockNuxtImport('useRoute', () => useRouteMock);
mockNuxtImport('useWorkspaceTree', () => useWorkspaceTreeMock);
mockNuxtImport('useWorkspaceDirectory', () => useWorkspaceDirectoryMock);

const CHANGE = {
  revisionId: 'r1',
  pageId: 'p1',
  pageTitle: 'Roadmap',
  author: { id: 'u1', displayName: 'Ana Ruiz' },
  createdAt: '2026-09-15T10:00:00.000Z',
  changes: { added: 2, removed: 0, modified: 1, moved: 0 },
};

const THREAD = {
  id: 't1',
  pageId: 'p1',
  pageTitle: 'Roadmap',
  quote: 'the launch date',
  orphaned: false,
  author: { id: 'u2', displayName: 'Bo' },
  replyCount: 2,
  lastActivityAt: '2026-09-15T11:00:00.000Z',
  mentionsYou: true,
  awaitsYou: true,
};

const EDITOR = { pageId: 'p2', pageTitle: 'Meeting notes', userId: 'u3', userDisplayName: 'Cy Doe', since: '2026-09-15T09:30:00.000Z' };

function mockAll(overrides: { status?: string; recent?: unknown[]; mine?: unknown[]; threads?: unknown[]; editors?: unknown[]; message?: string } = {}) {
  const load = vi.fn(async () => {});
  const start = vi.fn();
  const stop = vi.fn();
  useWorkspaceActivityMock.mockReturnValue({
    status: ref(overrides.status ?? 'success'),
    workspaceName: ref('Acme'),
    recent: ref(overrides.recent ?? []),
    mine: ref(overrides.mine ?? []),
    threads: ref(overrides.threads ?? []),
    message: ref(overrides.message ?? ''),
    load,
  });
  usePresenceStreamMock.mockReturnValue({
    editors: ref(overrides.editors ?? []),
    connectionMode: ref('sse'),
    start,
    stop,
  });
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
    pathTo: () => [],
  });
  useWorkspaceDirectoryMock.mockReturnValue({
    status: ref('success'),
    workspaces: computed(() => [{ id: 'ws-1', name: 'Acme', slug: 'acme' }]),
    ensure: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    nameOf: () => 'Acme',
  });
  return { load, start, stop };
}

const PageInApp = defineComponent({
  name: 'DashboardInApp',
  setup: () => () => h(UApp, null, { default: () => h(DashboardPage) }),
});

describe('workspace dashboard', () => {
  test('loads the activity and opens the workspace-wide presence stream on mount', async () => {
    const { load, start } = mockAll();
    await mountSuspended(PageInApp);

    expect(load).toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith('ws-1');
    expect(usePresenceStreamMock).toHaveBeenCalledWith(null);
  });

  test('renders a skeleton of the grid while loading, not a spinner', async () => {
    mockAll({ status: 'loading' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('[data-testid="dashboard-skeleton"]').exists()).toBe(true);
    expect(component.findAll('h1')).toHaveLength(0);
  });

  test('the workspace’s name is the screen’s one h1, and the four columns are titled regions', async () => {
    mockAll({ recent: [CHANGE] });
    const component = await mountSuspended(PageInApp);

    expect(component.get('h1').text()).toBe('Acme');
    const titles = component.findAllComponents(DashboardPanel).map((panel) => panel.props('title'));
    expect(titles).toEqual(['Recent changes', 'Editing now', 'Threads for you', 'Your recent edits']);
  });

  test('a recent change names the author, links the page, carries the instant and says what changed in words', async () => {
    mockAll({ recent: [CHANGE] });
    const component = await mountSuspended(PageInApp);

    const row = component.get('[data-testid="dashboard-recent"] li');
    expect(row.text()).toContain('Ana Ruiz');
    expect(row.get('a[href="/pages/p1"]').text()).toBe('Roadmap');
    expect(row.get('time').attributes('datetime')).toBe('2026-09-15T10:00:00.000Z');
    // Non-zero classes only, each in words — colour is never the sole carrier (§5).
    expect(row.text()).toContain('2 blocks added');
    expect(row.text()).toContain('1 block changed');
    expect(row.text()).not.toContain('removed');
    expect(row.text()).not.toContain('moved');
  });

  test('who is editing now comes from the stream: person, page, since when — never a lock', async () => {
    mockAll({ recent: [CHANGE], editors: [EDITOR] });
    const component = await mountSuspended(PageInApp);

    const row = component.get('[data-testid="dashboard-editing"] li');
    expect(row.text()).toContain('Cy Doe');
    expect(row.get('a[href="/pages/p2"]').text()).toBe('Meeting notes');
    expect(row.get('time').attributes('datetime')).toBe(EDITOR.since);
    expect(component.text()).not.toMatch(/locked/i);
  });

  test('a thread for you shows the page, the excerpt, and whether it names you or waits on you', async () => {
    mockAll({ recent: [CHANGE], threads: [THREAD] });
    const component = await mountSuspended(PageInApp);

    const row = component.get('[data-testid="dashboard-threads"] li');
    expect(row.get('a[href="/pages/p1"]').text()).toBe('Roadmap');
    expect(row.text()).toContain('the launch date');
    expect(row.text()).toContain('2 replies');
    expect(row.text()).toContain('Waiting on you');
    expect(row.text()).toContain('Names you');
  });

  test('every column with nothing in it teaches what would appear there', async () => {
    mockAll({ recent: [CHANGE], threads: [], mine: [], editors: [] });
    const component = await mountSuspended(PageInApp);

    const empties = component.findAll('[data-testid="panel-empty"]').map((p) => p.text());
    expect(empties).toHaveLength(3);
    expect(empties.join(' ')).toMatch(/Nobody is editing right now/);
    expect(empties.join(' ')).toMatch(/No open thread mentions you/);
    expect(empties.join(' ')).toMatch(/haven't saved anything here yet/);
  });

  test('a fresh workspace is one sentence that says where to start, not four empty panels', async () => {
    mockAll();
    const component = await mountSuspended(PageInApp);

    expect(component.get('[data-testid="dashboard-empty"]').text()).toMatch(/New… creates the first shelf/);
    expect(component.findAllComponents(DashboardPanel)).toHaveLength(0);
  });

  test('absence and denial are one not-found state; a dead connection is an alert with a retry', async () => {
    mockAll({ status: 'not-found' });
    const missing = await mountSuspended(PageInApp);
    expect(missing.get('h1').text()).toMatch(/does not exist/);
    expect(missing.findAll('[role="alert"]')).toHaveLength(0);

    const { load } = mockAll({ status: 'network-error', message: 'Cannot reach the server.' });
    const failed = await mountSuspended(PageInApp);
    expect(failed.get('[role="alert"]').text()).toContain('Cannot reach the server.');
    const before = load.mock.calls.length;
    await failed.get('[data-testid="dashboard-retry"]').trigger('click');
    expect(load.mock.calls.length).toBe(before + 1);
  });
});
