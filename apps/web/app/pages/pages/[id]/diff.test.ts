import { UApp, UIcon } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import DiffPage from './diff.vue';

const { usePageDiffMock, useRouteMock, useCurrentWorkspaceMock, useWorkspaceTreeMock, useWorkspaceDirectoryMock } = vi.hoisted(() => ({
  usePageDiffMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { id: 'page-1' }, query: { from: 'rev-1', to: 'rev-2' } })),
  useCurrentWorkspaceMock: vi.fn(),
  useWorkspaceTreeMock: vi.fn(),
  useWorkspaceDirectoryMock: vi.fn(),
}));

mockNuxtImport('usePageDiff', () => usePageDiffMock);
mockNuxtImport('useRoute', () => useRouteMock);
mockNuxtImport('useCurrentWorkspace', () => useCurrentWorkspaceMock);
mockNuxtImport('useWorkspaceTree', () => useWorkspaceTreeMock);
mockNuxtImport('useWorkspaceDirectory', () => useWorkspaceDirectoryMock);

/**
 * The frame's own collaborators, stubbed so this file stays about the diff
 * screen. The diff response names no workspace, so the frame stands on the
 * last one the person was in (`useCurrentWorkspace`), and the tree places
 * `page-1` under a shelf and a book — a page at the root would let the
 * breadcrumb test pass with the ancestors never rendered.
 */
function mockFrame() {
  useCurrentWorkspaceMock.mockReturnValue({ workspaceId: ref('ws-1'), enter: vi.fn() });
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

const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

// Every screen now renders inside the workspace frame. Its sidebar — the
// tree, the switcher, the doors — is stubbed here so this file stays about
// the screen it names; `AppShell.test.ts` and `WorkspaceSidebar.test.ts`
// own the frame.
const FRAME_STUBS = { global: { stubs: { WorkspaceSidebar: true } } };

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(DiffPage) }),
});

interface Change {
  kind: 'added' | 'removed' | 'modified' | 'moved' | 'unchanged';
  id: string;
  slot?: number;
  fromSlot?: number;
  toSlot?: number;
  moved?: boolean;
  splitFrom?: string;
  mergedInto?: string;
  text: string;
}

function mockDiff(overrides: Partial<{ status: string; changes: Change[]; message: string }> = {}) {
  mockFrame();
  const load = vi.fn(async () => {});
  const diffValue =
    overrides.status === undefined || overrides.status === 'success'
      ? { from: { id: 'rev-1', createdAt: '2026-01-01T00:00:00.000Z' }, to: { id: 'rev-2', createdAt: '2026-01-02T00:00:00.000Z' }, changes: overrides.changes ?? [] }
      : null;
  usePageDiffMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    diff: ref(diffValue),
    message: ref(overrides.message ?? ''),
    load,
  });
  return load;
}

// versioning-and-collaboration tasks.md 10.3 quality bar: every block
// changed makes added/removed/modified indistinguishable from each other,
// so this fixture keeps one UNCHANGED block alongside one of each kind —
// each assertion below targets its own block by its own text, in
// isolation from every other kind's treatment.
const MIXED_CHANGES: Change[] = [
  { kind: 'removed', id: 'b-removed', slot: 0, text: 'Paragraph about apples, removed entirely.' },
  { kind: 'modified', id: 'b-modified', fromSlot: 1, toSlot: 0, moved: false, text: 'Paragraph about grapes, now changed.' },
  { kind: 'unchanged', id: 'b-unchanged', slot: 1, text: 'Paragraph about pears, never touched.' },
  { kind: 'added', id: 'b-added', slot: 2, text: 'Paragraph about kiwis, brand new.' },
  { kind: 'moved', id: 'b-moved', fromSlot: 0, toSlot: 3, text: 'Paragraph about bananas, only its position changed.' },
];

describe('page-diff screen', () => {
  test('renders the loading skeleton, not a spinner, while the request is in flight', async () => {
    mockDiff({ status: 'loading' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.find('[data-testid="diff-skeleton"]').exists()).toBe(true);
  });

  test('renders a single not-found state — absence and denial are indistinguishable here', async () => {
    mockDiff({ status: 'not-found' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/does not exist/i);
  });


  // docs/UI-CHECKLIST.md §3, "never a dead end": the denied and not-found
  // notices were prose with no link (audit, 2026-09-14) while `error.vue`
  // offers "Your workspaces" and "Sign in". They now give the same two
  // doors; the copy that keeps absence and denial indistinguishable is
  // `error.vue`'s reviewed paragraph, verbatim, so one copy exists.
  test('the not-found notice offers the workspaces list and sign-in, with the error screen’s copy', async () => {
    mockDiff({ status: 'not-found' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.find('main a[href="/workspaces"]').exists()).toBe(true);
    expect(component.find('main a[href="/login"]').exists()).toBe(true);
    expect(component.text()).toMatch(/deliberately doesn't say which/);
  });

  test('renders a recoverable error state with a retry action that reloads', async () => {
    const load = mockDiff({ status: 'network-error', message: 'Cannot reach the server.' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const retry = component.get('button[data-testid="diff-retry"]');
    await retry.trigger('click');

    expect(load).toHaveBeenCalled();
  });

  // Two revisions with no differences is a real, reachable state
  // (versioning-and-collaboration tasks.md 10.3) — never folded into the
  // error branch.
  test('two revisions with no differences render a real empty state, not an error', async () => {
    mockDiff({ status: 'success', changes: [{ kind: 'unchanged', id: 'b1', slot: 0, text: 'Nothing changed here.' }] });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/no differences/i);
    expect(component.find('[role="alert"]').exists()).toBe(false);
  });

  test('each classification renders its own accessible label, isolated from the others in the same result', async () => {
    mockDiff({ status: 'success', changes: MIXED_CHANGES });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    // Case-sensitive `.toContain`, not a case-insensitive regex: the
    // badge label "Removed" contains the literal substring "moved" (as in
    // "re-MOVED"), so a `/moved/i` check against removedRow's text would
    // pass for the wrong reason. The badges render Title Case and the
    // surrounding prose does not, so an exact-case check on the label
    // itself is the assertion that actually isolates one kind from another.
    const removedRow = component.findAll('main li').find((li) => li.text().includes('apples'))!;
    expect(removedRow.text()).toContain('Removed');
    expect(removedRow.text()).not.toContain('Added');
    expect(removedRow.text()).not.toContain('Modified');
    expect(removedRow.text()).not.toContain('Moved');

    const modifiedRow = component.findAll('main li').find((li) => li.text().includes('grapes'))!;
    expect(modifiedRow.text()).toContain('Modified');
    expect(modifiedRow.text()).not.toContain('Added');
    expect(modifiedRow.text()).not.toContain('Removed');

    const addedRow = component.findAll('main li').find((li) => li.text().includes('kiwis'))!;
    expect(addedRow.text()).toContain('Added');
    expect(addedRow.text()).not.toContain('Removed');
    expect(addedRow.text()).not.toContain('Modified');
    expect(addedRow.text()).not.toContain('Moved');

    const unchangedRow = component.findAll('main li').find((li) => li.text().includes('pears'))!;
    expect(unchangedRow.text()).not.toContain('Added');
    expect(unchangedRow.text()).not.toContain('Removed');
    expect(unchangedRow.text()).not.toContain('Modified');
    expect(unchangedRow.text()).not.toContain('Moved');
  });

  // The quality-bar case named explicitly by task 10.3: moved must be
  // visually distinct from every other kind, not merely labeled
  // differently — asserted on the row's own classes, not just its text.
  test('a moved block gets a visual treatment distinct from added, removed and modified', async () => {
    mockDiff({ status: 'success', changes: MIXED_CHANGES });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const rows = component.findAll('main li');
    const movedRow = rows.find((li) => li.text().includes('bananas'))!;
    const addedRow = rows.find((li) => li.text().includes('kiwis'))!;
    const removedRow = rows.find((li) => li.text().includes('apples'))!;
    const modifiedRow = rows.find((li) => li.text().includes('grapes'))!;

    expect(movedRow.text()).toContain('Moved');

    // Only the colour-carrying classes matter here — `px-4`/`py-3`/
    // `rounded-md` are shared row structure, not the signal under test.
    // The actual proof that "moved" is not "added, but blue": its own
    // background class is not any of the other three kinds' background
    // class.
    const backgroundClassOf = (row: typeof movedRow) => row.classes().find((c) => c.startsWith('bg-'));
    const movedBackground = backgroundClassOf(movedRow);
    expect(movedBackground).toBeDefined();
    expect([backgroundClassOf(addedRow), backgroundClassOf(removedRow), backgroundClassOf(modifiedRow)]).not.toContain(
      movedBackground,
    );
  });

  // Follow-up from owner review of the first cut: a moved block appearing
  // ONLY in its new position, with a generic crosshair icon, was legible
  // only by reading the "Moved" label — the ordering itself communicated
  // nothing. The badge now names and points a direction. Both directions
  // are asserted here, in isolation from each other, so a hardcoded
  // "always down" implementation cannot pass.
  test('a block moved later in the document reads "Moved down" with a downward arrow', async () => {
    mockDiff({
      status: 'success',
      changes: [{ kind: 'moved', id: 'b1', fromSlot: 0, toSlot: 3, text: 'This paragraph moved later in the document.' }],
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toContain('Moved down');
    const iconNames = component.findAllComponents(UIcon).map((icon) => icon.props('name'));
    expect(iconNames).toContain('i-lucide-arrow-down');
    expect(iconNames).not.toContain('i-lucide-arrow-up');
  });

  test('a block moved earlier in the document reads "Moved up" with an upward arrow', async () => {
    mockDiff({
      status: 'success',
      changes: [{ kind: 'moved', id: 'b1', fromSlot: 3, toSlot: 0, text: 'This paragraph moved earlier in the document.' }],
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toContain('Moved up');
    const iconNames = component.findAllComponents(UIcon).map((icon) => icon.props('name'));
    expect(iconNames).toContain('i-lucide-arrow-up');
    expect(iconNames).not.toContain('i-lucide-arrow-down');
  });

  test('a modified block that also changed position carries the same directional cue as a pure move', async () => {
    mockDiff({
      status: 'success',
      changes: [
        { kind: 'modified', id: 'b1', fromSlot: 0, toSlot: 2, moved: true, text: 'Edited and moved later.' },
      ],
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toContain('Modified · moved down');
    const iconNames = component.findAllComponents(UIcon).map((icon) => icon.props('name'));
    expect(iconNames).toContain('i-lucide-arrow-down');
  });

  test("renders the block's own text content, not just its classification", async () => {
    mockDiff({ status: 'success', changes: MIXED_CHANGES });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toContain('Paragraph about kiwis, brand new.');
    expect(component.text()).toContain('Paragraph about apples, removed entirely.');
  });

  // One `<h1>` in every state, for the accessibility tree; visibly, the
  // screen's identity is the breadcrumb's ("… › History › Compare"), so the
  // heading is `sr-only` and no heading block — no title repeated, no
  // supporting sentence — stands between the bar and the blocks (the
  // document-frame residue the owner reacted to on 2026-09-15).
  test('renders exactly one h1 for the screen, for the accessibility tree only, in every state', async () => {
    const states: Parameters<typeof mockDiff>[0][] = [{ status: 'success', changes: MIXED_CHANGES }, { status: 'not-found' }, { status: 'loading' }];
    for (const state of states) {
      mockDiff(state);
      const component = await mountSuspended(PageInApp, FRAME_STUBS);

      const headings = component.findAll('h1');
      expect(headings, state!.status).toHaveLength(1);
      expect(headings[0]!.text()).toBe('Compare revisions');
      expect(headings[0]!.classes(), 'the heading is for assistive technology; the breadcrumb is the visible identity').toContain('sr-only');
      expect(component.get('main').text()).not.toMatch(/What changed between two saved revisions/);
      component.unmount();
    }
  });

  /*
   * The screen opts into the workspace layout, so the sidebar around it is
   * the one the layout mounted and the tree keeps its scroll when the
   * person arrives here from history. The record is read from the
   * application's router; that the sidebar survives is `e2e/frame.spec.ts`'s.
   */
  test('stands inside the workspace layout', async () => {
    mockDiff({ status: 'success', changes: MIXED_CHANGES });
    await mountSuspended(PageInApp, FRAME_STUBS);
    const { useRouter } = await import('#imports');

    expect(useRouter().getRoutes().find((route) => route.path === '/pages/:id()/diff')?.meta.layout).toBe('workspace');
  });

  // Where the person is: workspace › shelf › book › page through the
  // tree, then History (a link — it is where they came from) and Compare.
  test('the breadcrumb walks from the workspace to the page, then History as a link, then Compare', async () => {
    mockDiff({ status: 'success', changes: MIXED_CHANGES });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const nav = component.get('nav[aria-label="Where you are"]');
    const crumbs = nav.findAll('li').map((li) => li.text()).filter(Boolean);
    expect(crumbs).toEqual(['Acme', 'Engineering', 'Handbook', 'A Page', 'History', 'Compare']);
    expect(nav.find('a[href="/pages/page-1/history"]').exists()).toBe(true);
    expect(nav.find('a[href="/pages/page-1"]').exists()).toBe(true);
  });

  // The bar's action is the way back; the two revisions being compared
  // are the list's caption, above the blocks — each a `<time>` carrying
  // its instant, read in the viewer's own zone with the zone named
  // (docs/UI-CHECKLIST.md §4.11). Not in the bar: measured at 1280×900
  // with the sidebar, two zoned timestamps beside "Back to history" left
  // the breadcrumb 400px short and it truncated to "E2E Wor… › His… ›
  // Com…". Two zones, one pair of instants: the same instant reads
  // differently in each, so a formatter stuck on one zone cannot satisfy
  // both.
  test('the contextual bar carries "Back to history"; the revision pair captions the blocks, in the viewer\'s zone', async () => {
    process.env.TZ = 'America/New_York';
    mockDiff({ status: 'success', changes: MIXED_CHANGES });
    const inNewYork = await mountSuspended(PageInApp, FRAME_STUBS);

    const actions = inNewYork.get('header [data-slot="right"]');
    expect(actions.findAll('a').map((a) => a.attributes('href'))).toEqual(['/pages/page-1/history']);
    expect(actions.get('a[href="/pages/page-1/history"]').text()).toBe('Back to history');
    expect(actions.findAll('time')).toHaveLength(0);

    const pair = inNewYork.get('main [data-testid="diff-pair"]');
    const times = pair.findAll('time');
    expect(times.map((time) => time.attributes('datetime'))).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z']);
    expect(times.map((time) => time.text())).toEqual(['Dec 31, 2025, 7:00 PM EST', 'Jan 1, 2026, 7:00 PM EST']);
    // The pair reads as a comparison, in order: from, then to — and it
    // stands above the blocks it captions.
    expect(pair.text().indexOf('Dec 31')).toBeLessThan(pair.text().indexOf('Jan 1'));
    const main = inNewYork.get('main').element;
    const all = Array.from(main.querySelectorAll('*'));
    expect(all.indexOf(pair.element)).toBeLessThan(all.indexOf(inNewYork.get('main li').element));
    inNewYork.unmount();

    process.env.TZ = 'Asia/Tokyo';
    mockDiff({ status: 'success', changes: MIXED_CHANGES });
    const inTokyo = await mountSuspended(PageInApp, FRAME_STUBS);
    expect(inTokyo.get('main [data-testid="diff-pair"]').findAll('time').map((time) => time.text())).toEqual(['Jan 1, 2026, 9:00 AM GMT+9', 'Jan 2, 2026, 9:00 AM GMT+9']);
  });

  // Two identical revisions are still two revisions: the caption names them
  // above the empty state too.
  test('the revision pair captions the "No differences" state as well', async () => {
    mockDiff({ status: 'success', changes: [{ kind: 'unchanged', id: 'b1', slot: 0, text: 'Nothing changed here.' }] });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.get('main [data-testid="diff-pair"]').findAll('time')).toHaveLength(2);
    expect(component.text()).toMatch(/no differences/i);
  });

  // Before the response there is no pair to name — and after a refusal
  // there is none either. The way back stays in every state.
  test('the revision pair is absent until the diff has loaded, while "Back to history" is always offered', async () => {
    for (const status of ['loading', 'not-found', 'network-error'] as const) {
      mockDiff({ status, message: 'x' });
      const component = await mountSuspended(PageInApp, FRAME_STUBS);

      expect(component.findAll('time'), status).toHaveLength(0);
      expect(component.get('header [data-slot="right"] a[href="/pages/page-1/history"]').text()).toBe('Back to history');
      component.unmount();
    }
  });

  // The skeleton is the loaded screen's boxes — the caption line and the
  // list's rows, marked for the measurement `e2e/diff.spec.ts` makes.
  test('the skeleton is the caption line and the list rows, marked for measurement', async () => {
    mockDiff({ status: 'loading' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const skeleton = component.get('[data-testid="diff-skeleton"]');
    expect(skeleton.attributes('aria-hidden')).toBe('true');
    expect(skeleton.find('[data-testid="diff-skeleton-caption"]').exists()).toBe(true);
    expect(skeleton.findAll('[data-testid="diff-skeleton-row"]').length).toBeGreaterThan(0);
  });
});
