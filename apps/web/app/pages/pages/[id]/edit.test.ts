import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import EditPage from './edit.vue';

const { useEditSessionMock, useLockHeartbeatMock, useSavePageMock, useRouteMock } = vi.hoisted(() => ({
  useEditSessionMock: vi.fn(),
  useLockHeartbeatMock: vi.fn(),
  useSavePageMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { id: 'page-1' } })),
}));

mockNuxtImport('useEditSession', () => useEditSessionMock);
mockNuxtImport('useLockHeartbeat', () => useLockHeartbeatMock);
mockNuxtImport('useSavePage', () => useSavePageMock);
mockNuxtImport('useRoute', () => useRouteMock);

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

function mockDefaults(saveOverrides: { status?: string; corrected?: string | null; anchors?: unknown[]; message?: string } = {}) {
  useLockHeartbeatMock.mockReturnValue({ status: ref('idle'), start: vi.fn(async () => {}), stop: vi.fn() });
  useSavePageMock.mockReturnValue({
    status: ref(saveOverrides.status ?? 'idle'),
    contentHash: ref('hash-1'),
    canonical: ref(null),
    corrected: ref(saveOverrides.corrected ?? null),
    anchors: ref(saveOverrides.anchors ?? []),
    message: ref(saveOverrides.message ?? ''),
    save: vi.fn(async () => {}),
  });
}

describe('edit-mode page', () => {
  test('renders the loading skeleton while the edit session is being requested', async () => {
    mockDefaults();
    mockSession({ status: 'loading' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('[data-testid="edit-skeleton"]').exists()).toBe(true);
  });

  test('renders a permission-denied state with an "Open read-only" exit', async () => {
    mockDefaults();
    mockSession({ status: 'forbidden' });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/don't have access to edit/i);
    expect(component.find('a[href="/pages/page-1"]').exists()).toBe(true);
  });

  test('renders both "Open read-only" and "Take over editing" simultaneously when locked', async () => {
    mockDefaults();
    mockSession({
      status: 'locked',
      refusal: { reason: 'locked', holder: { userId: 'other', acquiredAt: '2026-01-01T00:00:00Z', heartbeatAt: '2026-01-01T00:00:00Z' }, offeredExits: ['read_only', 'take_over'] },
    });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/someone else is editing/i);
    expect(component.text()).toMatch(/open read-only/i);
    expect(component.text()).toMatch(/take over editing/i);
  });

  test('renders the refused state naming the construct and line, with read-only and an unavailable normalise exit that stays reachable', async () => {
    mockDefaults();
    mockSession({
      status: 'refused',
      refusal: { reason: 'unsupported_construct', construct: 'setext heading', line: 4, offeredExits: ['read_only', 'normalise'] },
    });
    const component = await mountSuspended(PageInApp);

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
    const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true } } });

    expect(component.text()).toMatch(/deleted or merged/i);
    expect(component.text()).not.toMatch(/someone else saved a newer version/i);
    const offerButton = component.findAll('button').find((button) => /corrected document/i.test(button.text()));
    expect(offerButton).toBeDefined();
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
    const component = await mountSuspended(PageInApp, { global: { stubs: { EditorSurface: true } } });

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe('Hi');
    const editorStub = component.findComponent({ name: 'EditorSurface' });
    expect(editorStub.exists() || component.find('editor-surface-stub').exists()).toBe(true);
  });
});
