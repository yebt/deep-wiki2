import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import EditPage from './edit.vue';

const {
  useEditSessionMock,
  useLockHeartbeatMock,
  useSavePageMock,
  usePresenceStreamMock,
  useRouteMock,
  useWorkspaceTreeMock,
  useWorkspaceDirectoryMock,
  navigateToMock,
  useConfirmMock,
} =
  vi.hoisted(() => ({
    navigateToMock: vi.fn(async () => {}),
    useConfirmMock: vi.fn(),
    useEditSessionMock: vi.fn(),
    useLockHeartbeatMock: vi.fn(),
    useSavePageMock: vi.fn(),
    usePresenceStreamMock: vi.fn(),
    useRouteMock: vi.fn(() => ({ params: { id: 'page-1' } })),
    useWorkspaceTreeMock: vi.fn(),
    useWorkspaceDirectoryMock: vi.fn(),
  }));

mockNuxtImport('useEditSession', () => useEditSessionMock);
mockNuxtImport('useLockHeartbeat', () => useLockHeartbeatMock);
mockNuxtImport('useSavePage', () => useSavePageMock);
mockNuxtImport('usePresenceStream', () => usePresenceStreamMock);
mockNuxtImport('useRoute', () => useRouteMock);
mockNuxtImport('useWorkspaceTree', () => useWorkspaceTreeMock);
mockNuxtImport('useWorkspaceDirectory', () => useWorkspaceDirectoryMock);
mockNuxtImport('navigateTo', () => navigateToMock);
mockNuxtImport('useConfirm', () => useConfirmMock);

/**
 * The product's one confirm dialog is `app.vue`'s; here the question half
 * is a mock that answers what the test decides, so a test reads what was
 * asked (`confirm.mock.calls`) and what happened after the answer.
 */
function mockConfirm(answer = false) {
  const confirm = vi.fn(async () => answer);
  useConfirmMock.mockReturnValue({ pending: ref(null), confirm, settle: vi.fn() });
  return confirm;
}

/**
 * The frame's own collaborators — the sidebar's tree and the workspace
 * directory — are stubbed so this file stays about the edit screen. The
 * tree places `page-1` under a shelf and a book: a page at the root would
 * make the breadcrumb test below pass with the ancestors never rendered.
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

// Every screen now renders inside the workspace frame. Its sidebar — the
// tree, the switcher, the doors — is stubbed here so this file stays about
// the screen it names; `AppShell.test.ts` and `WorkspaceSidebar.test.ts`
// own the frame.
const FRAME_STUBS = { global: { stubs: { WorkspaceSidebar: true } } };

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(EditPage) }),
});

function mockSession(overrides: {
  status?: string;
  session?: unknown;
  refusal?: unknown;
  message?: string;
} = {}) {
  const load = vi.fn(async () => {});
  const takeOver = vi.fn(async () => {});
  useEditSessionMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    session: ref(overrides.session ?? null),
    refusal: ref(overrides.refusal ?? null),
    message: ref(overrides.message ?? ''),
    load,
    takeOver,
  });
  return { load, takeOver };
}

function mockDefaults(
  saveOverrides: {
    status?: string;
    canonical?: string | null;
    corrected?: string | null;
    anchors?: unknown[];
    message?: string;
    heartbeatStatus?: string;
  } = {},
) {
  useLockHeartbeatMock.mockReturnValue({ status: ref(saveOverrides.heartbeatStatus ?? 'idle'), start: vi.fn(async () => {}), stop: vi.fn() });
  const save = vi.fn(async () => {});
  useSavePageMock.mockReturnValue({
    status: ref(saveOverrides.status ?? 'idle'),
    contentHash: ref('hash-1'),
    canonical: ref(saveOverrides.canonical ?? null),
    corrected: ref(saveOverrides.corrected ?? null),
    anchors: ref(saveOverrides.anchors ?? []),
    message: ref(saveOverrides.message ?? ''),
    save,
  });
  mockPresence();
  mockFrame();
  const confirm = mockConfirm(false);
  return { save, confirm };
}

const READY_SESSION = { markdown: '# Hi\n', title: 'A Page', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } };
const EDITOR_STUBS = { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } };

function mockPresence(editors: readonly { userId: string; userDisplayName: string; since: string }[] = []) {
  usePresenceStreamMock.mockReturnValue({
    editors: ref(editors),
    connectionMode: ref('idle'),
    start: vi.fn(),
    stop: vi.fn(),
  });
}

describe('edit-mode page', () => {
  test('renders the loading skeleton while the edit session is being requested', async () => {
    mockDefaults();
    mockSession({ status: 'loading' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.find('[data-testid="edit-skeleton"]').exists()).toBe(true);
  });

  test('renders a permission-denied state with an "Open read-only" exit', async () => {
    mockDefaults();
    mockSession({ status: 'forbidden' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/don't have access to edit/i);
    expect(component.find('a[href="/pages/page-1"]').exists()).toBe(true);
  });


  // docs/UI-CHECKLIST.md §3, "never a dead end": the denied and not-found
  // notices were prose with no link (audit, 2026-09-14) while `error.vue`
  // offers "Your workspaces" and "Sign in". They now give the same two
  // doors; the copy that keeps absence and denial indistinguishable is
  // `error.vue`'s reviewed paragraph, verbatim, so one copy exists.
  test('the denied and not-found notices each offer the workspaces list and sign-in, like the error screen', async () => {
    for (const status of ['forbidden', 'not-found'] as const) {
      mockDefaults();
      mockSession({ status });
      const component = await mountSuspended(PageInApp, FRAME_STUBS);

      expect(component.find('main a[href="/workspaces"]').exists(), status).toBe(true);
      expect(component.find('main a[href="/login"]').exists(), status).toBe(true);
      component.unmount();
    }
  });

  test('the not-found copy is the error screen’s, which says out loud that it does not disclose', async () => {
    mockDefaults();
    mockSession({ status: 'not-found' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/deliberately doesn't say which/);
  });

  // One rule for a signed-out visit to a signed-in screen: leave for
  // sign-in with this address as the return path, and show no card here —
  // a card would be a dead end with a button on it (docs/UI-CHECKLIST.md §3).
  test('a signed-out visitor is sent to sign in, to come back here afterwards, and shown no card', async () => {
    mockDefaults();
    mockSession({ status: 'unauthenticated' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(navigateToMock).toHaveBeenCalledWith(expect.stringMatching(/^\/login(\?next=|$)/), { replace: true });
    expect(component.find('main a[href="/login"]').exists()).toBe(false);
  });

  // One chrome for one destination: edit mode and the history screen both
  // link back to `/pages/:id` and used to do so as "Read" (eye) and "Back
  // to page" (arrow-left). The eye is what every "Open read-only" exit
  // already uses for read mode, so that is the one.
  test('the app bar’s way back to read mode is "Read page" with the eye, the same chrome history uses', async () => {
    mockDefaults();
    mockSession({
      status: 'ready',
      session: { markdown: '# Hi\n', title: 'Hi', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
    });
    const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });

    // In the bar's actions, not its breadcrumb — the page crumb links to
    // the same address, and is the frame's, not this screen's.
    const back = component.get('header [data-slot="right"] a[href="/pages/page-1"]');
    expect(back.text()).toBe('Read page');
    expect(back.find('[class*="i-lucide-eye"], .iconify').exists()).toBe(true);
  });

  // The trap: `useSavePage`'s `contentHash` genuinely starts `null` — every
  // OTHER test in this file gets away with `mockDefaults()`'s hardcoded
  // `ref('hash-1')`, which is why none of them would have caught this.
  // Loading an edit session for a page that already has content (an
  // `expectedContentHash` of `null` only belongs to a brand-new page) must
  // seed the real hash from the session so the first Save sends it, rather
  // than the `null` that made every existing page unsavable from a real
  // browser (docs/TODO.md Finding, this task).
  test('seeds the first Save with the edit-session content hash, not null, on a page that already has content', async () => {
    useLockHeartbeatMock.mockReturnValue({ status: ref('idle'), start: vi.fn(async () => {}), stop: vi.fn() });
    const save = vi.fn(async () => {});
    useSavePageMock.mockReturnValue({
      status: ref('idle'),
      contentHash: ref<string | null>(null),
      canonical: ref(null),
      corrected: ref(null),
      anchors: ref([]),
      message: ref(''),
      save,
    });
    mockPresence();
    mockFrame();
    mockSession({
      status: 'ready',
      session: {
        markdown: '# Hi\n',
        title: 'Hi',
        workspaceId: 'ws-1',
        contentHash: 'server-hash',
        lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' },
      },
    });
    const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });
    const editorStub = component.findComponent({ name: 'EditorSurface' });
    editorStub.vm.$emit('update', '# Hi\n\nedited\n');
    await component.vm.$nextTick();

    const saveButton = component.findAll('button').find((button) => /Save/.test(button.text()))!;
    await saveButton.trigger('click');

    expect(save).toHaveBeenCalledWith('# Hi\n\nedited\n', 'server-hash');
  });

  test('renders both "Open read-only" and "Take over editing" simultaneously when locked', async () => {
    mockDefaults();
    mockSession({
      status: 'locked',
      refusal: { reason: 'locked', holder: { userId: 'other', acquiredAt: '2026-01-01T00:00:00Z', heartbeatAt: '2026-01-01T00:00:00Z' }, offeredExits: ['read_only', 'take_over'] },
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/someone else is editing/i);
    expect(component.text()).toMatch(/open read-only/i);
    expect(component.text()).toMatch(/take over editing/i);
  });

  // "Take over" states its consequence for the other person before it is
  // confirmed (§4.8) — through the product's one confirm dialog, in the
  // destructive colour, and nothing happens on a "no".
  test('Take over asks through the confirm dialog, naming the consequence, and only takes over on a yes', async () => {
    const { confirm } = mockDefaults();
    const { takeOver } = mockSession({
      status: 'locked',
      refusal: { reason: 'locked', holder: { userId: 'other', acquiredAt: '2026-01-01T00:00:00Z', heartbeatAt: '2026-01-01T00:00:00Z' }, offeredExits: ['read_only', 'take_over'] },
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);
    const button = component.findAll('button').find((b) => /take over editing/i.test(b.text()))!;

    await button.trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Take over editing?', confirmLabel: 'Take over', tone: 'destructive', description: expect.stringMatching(/unsaved edits/i) }),
    );
    expect(takeOver).not.toHaveBeenCalled();

    confirm.mockResolvedValue(true);
    await button.trigger('click');
    await flushPromises();
    expect(takeOver).toHaveBeenCalledTimes(1);
  });

  test('renders the refused state naming the construct and line, with read-only and an unavailable normalise exit that stays reachable', async () => {
    mockDefaults();
    mockSession({
      status: 'refused',
      refusal: { reason: 'unsupported_construct', construct: 'setext heading', line: 4, offeredExits: ['read_only', 'normalise'] },
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/setext heading/i);
    expect(component.text()).toMatch(/line 4/i);
    expect(component.text()).toMatch(/open read-only/i);
    expect(component.text()).toMatch(/normalise this document/i);
    // `aria-disabled`, never the `disabled` attribute: the attribute takes
    // the control out of the tab order, which is what put the one sentence
    // explaining why this exit is not available yet behind a mouse hover a
    // keyboard user cannot perform (docs/UI-CHECKLIST.md §3 wants the
    // reason on hover *and* focus; §5 wants every control reachable by
    // keyboard). Asserting the accessible state rather than the attribute
    // is also what §7 asks for — the previous `button[disabled]` selector
    // was an assertion on the implementation, which is why making this
    // control more accessible read as a regression.
    const normaliseButton = component.get('button[aria-disabled="true"]');
    expect(normaliseButton.text()).toMatch(/normalise/i);
    expect(normaliseButton.attributes('disabled')).toBeUndefined();
  });

  // Regression for the false "someone else saved a newer version" report on
  // a reintroduced dead anchor (docs/TODO.md Findings, commit 40f9844): the
  // save-status banner must name what actually happened and must not read
  // as the stale-conflict message.
  test('a dead-anchor save reports what happened and offers the corrected document, not the stale message', async () => {
    mockDefaults({
      status: 'dead-anchor',
      corrected: 'Zebras migrate north through dusty savannah every summer.\n',
      anchors: [{ id: 'abc1234567', status: 'tombstoned' }],
      message: 'The pasted content carries an anchor for a block that was deleted or merged, so nothing was saved. Use the corrected document, with that anchor removed, to continue.',
    });
    mockSession({
      status: 'ready',
      session: { markdown: '# Hi\n', title: 'Hi', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
    });
    const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });

    expect(component.text()).toMatch(/deleted or merged/i);
    expect(component.text()).not.toMatch(/someone else saved a newer version/i);
    const offerButton = component.findAll('button').find((button) => /corrected document/i.test(button.text()));
    expect(offerButton).toBeDefined();
  });

  // The gap named in docs/TODO.md's dead-anchor fix (commit 87979d5):
  // `useSavePage` has exposed `canonical` on a `not canonical` 409 since
  // before that commit, and this screen never rendered it — the
  // not-canonical 409 had no UI at all. Same shape as the dead-anchor
  // banner directly above: `role="alert"`, the message, and an action
  // that loads the corrected text back into the editor.
  test('a not-canonical save reports what happened and offers the canonical document', async () => {
    mockDefaults({
      status: 'not-canonical',
      canonical: '# Hi\n\nCanonicalised.\n',
      message: 'This document is not in its canonical form.',
    });
    mockSession({
      status: 'ready',
      session: { markdown: '# Hi\n', title: 'Hi', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
    });
    const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });

    const banner = component.get('[role="alert"]');
    expect(banner.text()).toMatch(/not in its canonical form/i);
    const offerButton = component.findAll('button').find((button) => /canonical document/i.test(button.text()));
    expect(offerButton).toBeDefined();
  });

  test('clicking "Use the canonical document" loads the canonical text into the editor and marks the buffer dirty', async () => {
    mockDefaults({
      status: 'not-canonical',
      canonical: '# Hi\n\nCanonicalised.\n',
      message: 'This document is not in its canonical form.',
    });
    mockSession({
      status: 'ready',
      session: { markdown: '# Hi\n', title: 'Hi', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
    });
    const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });

    const offerButton = component.findAll('button').find((button) => /canonical document/i.test(button.text()))!;
    await offerButton.trigger('click');

    const editorStub = component.findComponent({ name: 'EditorSurface' });
    expect(editorStub.props('markdown')).toBe('# Hi\n\nCanonicalised.\n');
  });

  // editing-presence spec: "show the other holder if one appears
  // mid-session" (docs/UI-CHECKLIST.md §4.8: who + since when).
  test('shows another editor who appears mid-session, naming them and since when', async () => {
    mockDefaults();
    mockPresence([{ userId: 'other-1', userDisplayName: 'Ana', since: '2026-01-01T00:00:00.000Z' }]);
    mockSession({
      status: 'ready',
      session: { markdown: '# Hi\n', title: 'Hi', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
    });
    const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });

    expect(component.text()).toMatch(/Ana is editing/);
  });

  // The self-exclusion this composable's own `otherEditors` filter exists
  // for: the current holder is *this tab*, and a presence event that is
  // simply this session's own heartbeat echoing back must never render as
  // "someone else is editing" — that would be a false, alarming positive.
  test('never reports the current tab itself as "another" editor', async () => {
    mockDefaults();
    mockPresence([{ userId: 'me', userDisplayName: 'Me', since: '2026-01-01T00:00:00.000Z' }]);
    mockSession({
      status: 'ready',
      session: { markdown: '# Hi\n', title: 'Hi', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
    });
    const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });

    expect(component.text()).not.toMatch(/is editing/);
  });

  test('renders the page title as the one h1 once ready, with the editor surface handed the right props', async () => {
    mockDefaults();
    mockSession({
      status: 'ready',
      session: { markdown: '# Hi\n', title: 'Hi', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
    });
    // EditorSurface's own mount() dynamically imports the real
    // ProseMirror view (`@deep-wiki/editor/mount`) and constructs a real
    // `EditorView` — DOM behaviour this suite's happy-dom environment
    // does not fully support and that is separately covered by
    // packages/editor's own DOM-free unit tests plus manual/e2e
    // verification against a real browser. Stubbed here so this test
    // verifies only what this PAGE is responsible for: which component it
    // renders, with which props, once the session is ready.
    const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe('Hi');
    const editorStub = component.findComponent({ name: 'EditorSurface' });
    expect(editorStub.exists() || component.find('editor-surface-stub').exists()).toBe(true);
  });

  // docs/UI-CHECKLIST.md §4.11: the locked notice's timestamp must name
  // the viewer's zone and carry the exact instant in `<time datetime>` —
  // the same rule `formatRevisionDate` + `<time>` already enforce on
  // history.vue, not a second ad hoc `toLocaleTimeString()`.
  test('the locked notice names the zone and preserves the exact instant', async () => {
    mockDefaults();
    mockSession({
      status: 'locked',
      refusal: {
        reason: 'locked',
        holder: { userId: 'other', acquiredAt: '2026-01-01T00:00:00.000Z', heartbeatAt: '2026-01-01T00:00:00.000Z' },
        offeredExits: ['read_only', 'take_over'],
      },
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const time = component.get('time');
    expect(time.attributes('datetime')).toBe('2026-01-01T00:00:00.000Z');
    expect(time.text()).toMatch(/GMT|UTC|[A-Z]{2,5}$/);
  });

  describe('Save button — reason on hover and focus, never a bare `disabled`', () => {
    // docs/UI-CHECKLIST.md §3 ("a disabled button with no reason is a
    // defect") and §5 (`aria-disabled`, never `disabled`, so the reason
    // survives keyboard focus) — the same standard `AuthSubmit.vue`
    // already meets.
    test('is aria-disabled, with a reason, when there is nothing to save yet', async () => {
      mockDefaults();
      mockSession({
        status: 'ready',
        session: { markdown: '# Hi\n', title: 'Hi', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
      });
      const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });

      const saveButton = component.findAll('button').find((button) => /Save/.test(button.text()))!;
      expect(saveButton.attributes('aria-disabled')).toBe('true');
      expect(saveButton.attributes('disabled')).toBeUndefined();
    });

    test('becomes actionable once the document is dirty', async () => {
      mockDefaults();
      mockSession({
        status: 'ready',
        session: { markdown: '# Hi\n', title: 'Hi', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
      });
      const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });
      const editorStub = component.findComponent({ name: 'EditorSurface' });
      editorStub.vm.$emit('update', '# Hi\n\nedited\n');
      await component.vm.$nextTick();

      const saveButton = component.findAll('button').find((button) => /Save/.test(button.text()))!;
      expect(saveButton.attributes('aria-disabled')).toBeUndefined();
    });
  });

  // docs/UI-CHECKLIST.md §4.1: the six save banners were six hand-rolled
  // `div.rounded-md.px-3.py-2.text-body-small` — the chip tier, copied.
  // Every one of them is now `InlineNotice tier="chip"`, so a shape change
  // lands on all of them at once.
  test('every save banner is the shared chip tier, not a per-state copy', async () => {
    for (const status of ['stale', 'not-canonical', 'dead-anchor', 'forbidden', 'network-error'] as const) {
      mockDefaults({ status, message: `Refused: ${status}.`, canonical: 'x', corrected: 'x' });
      mockSession({
        status: 'ready',
        session: { markdown: '# Hi\n', title: 'Hi', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
      });
      const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });

      const chip = component.find('[role="alert"][data-notice-tier="chip"]');
      expect(chip.exists(), status).toBe(true);
      expect(chip.text()).toContain(`Refused: ${status}.`);
      component.unmount();
    }
  });

  // §3 "Error — fatal": a `stale` conflict offers no document to merge —
  // the banner must carry the reload it names, and Save must not invite a
  // retry that would just 409 again on the same hash (docs/TODO.md
  // Finding, this task).
  test('a stale save offers Reload, confirms before discarding unsaved edits, and disables Save meanwhile', async () => {
    const { confirm } = mockDefaults({ status: 'stale', message: 'Someone else saved a newer version. Reload before saving again.' });
    mockSession({
      status: 'ready',
      session: { markdown: '# Hi\n', title: 'Hi', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
    });
    const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });
    const editorStub = component.findComponent({ name: 'EditorSurface' });
    editorStub.vm.$emit('update', '# Hi\n\nedited\n');
    await component.vm.$nextTick();

    const saveButton = component.findAll('button').find((button) => /Save/.test(button.text()))!;
    expect(saveButton.attributes('aria-disabled')).toBe('true');

    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });

    const reloadButton = component.findAll('button').find((button) => /Reload/.test(button.text()))!;
    await reloadButton.trigger('click');
    await flushPromises();
    // The product's dialog, not `window.confirm`: a destructive question
    // whose verb is the action, naming what is lost.
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Reload', tone: 'destructive', description: expect.stringMatching(/unsaved changes/i) }));
    expect(reloadSpy).not.toHaveBeenCalled(); // declined the confirm — nothing discarded

    confirm.mockResolvedValue(true);
    await reloadButton.trigger('click');
    await flushPromises();
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  // §3 "Error — fatal": preserves unsaved input and says explicitly
  // whether it was lost or preserved.
  test('a forbidden save states the work is preserved but cannot be saved, and offers read-only', async () => {
    mockDefaults({ status: 'forbidden', message: "You don't have permission to save this page anymore." });
    mockSession({
      status: 'ready',
      session: { markdown: '# Hi\n', title: 'Hi', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
    });
    const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });

    const banner = component.get('[role="alert"]');
    expect(banner.text()).toMatch(/don't have permission/i);
    expect(banner.text()).toMatch(/nothing was saved/i);
    expect(component.find('a[href="/pages/page-1"]').exists()).toBe(true);
    const saveButton = component.findAll('button').find((button) => /Save/.test(button.text()))!;
    expect(saveButton.attributes('aria-disabled')).toBe('true');
  });

  // §3 "Error — recoverable": states what failed and offers a real next
  // action, never a dead end — and, per `saveMessage`, states the work is
  // preserved.
  test('a network-error save states the work is preserved and offers Retry', async () => {
    const { save } = mockDefaults({
      status: 'network-error',
      message: 'Cannot reach the server. Your changes are kept in this tab — try saving again.',
    });
    mockSession({
      status: 'ready',
      session: { markdown: '# Hi\n', title: 'Hi', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
    });
    const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });
    // A network error leaves the buffer exactly as dirty as it was before
    // the failed attempt — `onSave` only clears `isDirty` on `success`
    // (edit.vue's own `onSave`), so this mirrors the real precondition
    // rather than asserting Retry against an artificially clean buffer.
    const editorStub = component.findComponent({ name: 'EditorSurface' });
    editorStub.vm.$emit('update', '# Hi\n\nedited\n');
    await component.vm.$nextTick();

    const banner = component.get('[role="alert"]');
    expect(banner.text()).toMatch(/kept in this tab/i);
    const retryButton = component.findAll('button').find((button) => /Retry/.test(button.text()))!;
    await retryButton.trigger('click');
    expect(save).toHaveBeenCalledTimes(1);
  });

  // §3 "Success": "Saved." is the exact weak example this rule names.
  // This must name what was saved, and must stop claiming it once the
  // document is dirty again. Scoped to `main`: the contextual bar carries
  // a live region of its own since 2026-09-15 (the sidebar toggle's), and
  // the save banner is the screen's, in the column.
  describe('the success confirmation', () => {
    test('names what was saved, not a bare "Saved."', async () => {
      mockDefaults({ status: 'success' });
      mockSession({
        status: 'ready',
        session: { markdown: '# Hi\n', title: 'My Page', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
      });
      const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });

      const banner = component.get('main [role="status"][aria-live="polite"]');
      expect(banner.text()).not.toBe('Saved.');
      expect(banner.text()).toMatch(/My Page/);
    });

    test('stops claiming "Saved" once the document is dirty again', async () => {
      mockDefaults({ status: 'success' });
      mockSession({
        status: 'ready',
        session: { markdown: '# Hi\n', title: 'My Page', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
      });
      const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });
      expect(component.find('main [role="status"][aria-live="polite"]').exists()).toBe(true);

      const editorStub = component.findComponent({ name: 'EditorSurface' });
      editorStub.vm.$emit('update', '# Hi\n\nedited again\n');
      await component.vm.$nextTick();

      expect(component.find('main [role="status"][aria-live="polite"]').exists()).toBe(false);
    });
  });

  // Defect 11 (UI audit): the lock-lost indicator previously lived in the
  // fixed-height app bar, where it wrapped and overflowed at 320px. It now
  // lives in the wrapping content flow, and preserves the "work kept, not
  // saved" statement §3 requires of a fatal-adjacent error.
  test('the lock-lost notice lives in the content flow, not the header, and says the work is kept', async () => {
    mockDefaults({ heartbeatStatus: 'lost' });
    mockSession({
      status: 'ready',
      session: { markdown: '# Hi\n', title: 'Hi', workspaceId: 'ws-1', lock: { holderUserId: 'me', acquiredAt: 'x', heartbeatAt: 'x' } },
    });
    const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true, WorkspaceSidebar: true } } });

    expect(component.find('header').text()).not.toMatch(/lock lost/i);
    expect(component.find('main').text()).toMatch(/lock lost/i);
    expect(component.text()).toMatch(/kept/i);
  });

  /*
   * The screen opts into the workspace layout, so the sidebar around it is
   * the one the layout mounted — the tree keeps its scroll and its folds
   * when the person arrives from Read, and the room does not change when
   * the mode does. The record is read from the application's router; that
   * the sidebar actually survives is `e2e/frame.spec.ts`'s claim.
   */
  test('stands inside the workspace layout', async () => {
    mockDefaults();
    mockSession({ status: 'ready', session: READY_SESSION });
    await mountSuspended(PageInApp, EDITOR_STUBS);
    const { useRouter } = await import('#imports');

    expect(useRouter().getRoutes().find((route) => route.path === '/pages/:id()/edit')?.meta.layout).toBe('workspace');
  });

  describe('inside the workspace frame', () => {
    // Where the person is: workspace › shelf › book › page, through the
    // tree the sidebar holds, then the state this screen adds — a crumb
    // saying "Editing" (docs/UI-CHECKLIST.md §4.5). The word alone: with
    // an icon the crumb truncated to "Edit…" at 320 beside the bar's two
    // actions (`e2e/editor.spec.ts` measures that bar).
    test('the breadcrumb walks from the workspace to the page and ends in the Editing state', async () => {
      mockDefaults();
      mockSession({ status: 'ready', session: READY_SESSION });
      const component = await mountSuspended(PageInApp, EDITOR_STUBS);

      const nav = component.get('nav[aria-label="Where you are"]');
      const crumbs = nav.findAll('li').map((li) => li.text()).filter(Boolean);
      expect(crumbs).toEqual(['Acme', 'Engineering', 'Handbook', 'A Page', 'Editing']);
      // The page crumb is the link back to reading it; the state crumb is
      // a place name, not a link.
      expect(nav.find('a[href="/pages/page-1"]').exists()).toBe(true);
      const editing = nav.findAll('li').find((li) => li.text() === 'Editing')!;
      expect(editing.find('a').exists()).toBe(false);
    });

    // The contextual bar carries what this screen can do and who else is
    // here: the presence chip, then Read page, then Save. The column below
    // holds the document and the notices about it, nothing else.
    test('the contextual bar carries the presence chip beside Read page and Save, and the column carries none of them', async () => {
      mockDefaults();
      mockPresence([{ userId: 'other-1', userDisplayName: 'Ana', since: '2026-01-01T00:00:00.000Z' }]);
      mockSession({ status: 'ready', session: READY_SESSION });
      const component = await mountSuspended(PageInApp, EDITOR_STUBS);

      const header = component.get('header');
      const actions = header.get('[data-slot="right"]');
      expect(actions.text()).toMatch(/Ana is editing/);
      expect(actions.get('a[href="/pages/page-1"]').text()).toBe('Read page');
      expect(actions.findAll('button').some((button) => /^Save/.test(button.text()))).toBe(true);
      // Presence first, then the quieter navigation, then the primary
      // action — the read screen's order.
      const order = actions.text();
      expect(order.indexOf('Ana is editing')).toBeLessThan(order.indexOf('Read page'));
      expect(order.indexOf('Read page')).toBeLessThan(order.indexOf('Save'));
      const main = component.get('main');
      expect(main.text()).not.toMatch(/Ana is editing/);
      expect(main.findAll('button').some((button) => /^Save/.test(button.text()))).toBe(false);
      expect(main.find('a[href="/pages/page-1"]').exists()).toBe(false);
    });

    // The document's own title is the screen's `<h1>`, the same heading
    // the read screen renders in the same box — the mode changes the room's
    // bar, never the column. No eyebrow, no supporting sentence: the crumb
    // says "Editing", so a heading block repeating it would title the page
    // twice.
    test('the page title is the one h1, with no eyebrow or description under it', async () => {
      mockDefaults();
      mockSession({ status: 'ready', session: READY_SESSION });
      const component = await mountSuspended(PageInApp, EDITOR_STUBS);

      const headings = component.findAll('main h1');
      expect(headings).toHaveLength(1);
      expect(headings[0]!.text()).toBe('A Page');
      const block = headings[0]!.element.parentElement!;
      expect(block.querySelectorAll('p')).toHaveLength(0);
    });

    // The lock-lost state was a bare `span` — a fourth notice shape beside
    // the three `InlineNotice` states (docs/DESIGN-SYSTEM.md §14,
    // 2026-09-14) — and named a reload it did not offer (docs/UI-CHECKLIST.md
    // §3, never a dead end). It is the chip tier now, above the editor,
    // with the action, and it confirms before a dirty buffer is discarded
    // the way the stale banner's Reload does.
    test('the lock-lost notice is the shared chip tier above the editor, offers Reload, and confirms before discarding unsaved edits', async () => {
      const { confirm } = mockDefaults({ heartbeatStatus: 'lost' });
      mockSession({ status: 'ready', session: READY_SESSION });
      const component = await mountSuspended(PageInApp, EDITOR_STUBS);

      const chip = component.get('main [role="alert"][data-notice-tier="chip"]');
      expect(chip.text()).toMatch(/lock lost/i);
      expect(chip.text()).toMatch(/kept/i);
      expect(component.get('header').text()).not.toMatch(/lock lost/i);
      // Above the editor, not below it.
      const main = component.get('main').element;
      expect(Array.from(main.querySelectorAll('*')).indexOf(chip.element)).toBeLessThan(
        Array.from(main.querySelectorAll('*')).indexOf(component.find('editor-surface-stub').element),
      );

      const editorStub = component.findComponent({ name: 'EditorSurface' });
      editorStub.vm.$emit('update', '# Hi\n\nedited\n');
      await component.vm.$nextTick();

      const reloadSpy = vi.fn();
      vi.stubGlobal('location', { ...window.location, reload: reloadSpy });

      const reload = chip.findAll('button').find((button) => /Reload/.test(button.text()))!;
      await reload.trigger('click');
      await flushPromises();
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Reload', tone: 'destructive' }));
      expect(reloadSpy).not.toHaveBeenCalled();

      confirm.mockResolvedValue(true);
      await reload.trigger('click');
      expect(reloadSpy).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });
      await flushPromises();

    // The skeleton is the loaded screen's boxes: the title line the
    // heading takes and the editor's text on `doc-body` lines — the read
    // skeleton's shape, not one slab of a guessed height. That the boxes
    // coincide is a measurement (`e2e/editor.spec.ts`); this holds that
    // both parts exist, are marked for it, and that the lines are prose
    // line boxes.
    test('the skeleton is the title line and doc-body text lines, marked for measurement', async () => {
      mockDefaults();
      mockSession({ status: 'loading' });
      const component = await mountSuspended(PageInApp, EDITOR_STUBS);

      const skeleton = component.get('[data-testid="edit-skeleton"]');
      expect(skeleton.attributes('aria-hidden')).toBe('true');
      expect(skeleton.find('[data-testid="edit-skeleton-title"]').exists()).toBe(true);
      const line = skeleton.get('[data-testid="edit-skeleton-line"]');
      expect(line.element.tagName).toBe('P');
      expect(line.element.parentElement!.classList.contains('text-doc-body')).toBe(true);
    });
  });
});
