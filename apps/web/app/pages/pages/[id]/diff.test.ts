import { UApp, UIcon } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import DiffPage from './diff.vue';

const { usePageDiffMock, useRouteMock } = vi.hoisted(() => ({
  usePageDiffMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { id: 'page-1' }, query: { from: 'rev-1', to: 'rev-2' } })),
}));

mockNuxtImport('usePageDiff', () => usePageDiffMock);
mockNuxtImport('useRoute', () => useRouteMock);

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
    const component = await mountSuspended(PageInApp);

    expect(component.find('[data-testid="diff-skeleton"]').exists()).toBe(true);
  });

  test('renders a single not-found state — absence and denial are indistinguishable here', async () => {
    mockDiff({ status: 'not-found' });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/does not exist/i);
  });

  test('renders a recoverable error state with a retry action that reloads', async () => {
    const load = mockDiff({ status: 'network-error', message: 'Cannot reach the server.' });
    const component = await mountSuspended(PageInApp);

    const retry = component.get('button[data-testid="diff-retry"]');
    await retry.trigger('click');

    expect(load).toHaveBeenCalled();
  });

  // Two revisions with no differences is a real, reachable state
  // (versioning-and-collaboration tasks.md 10.3) — never folded into the
  // error branch.
  test('two revisions with no differences render a real empty state, not an error', async () => {
    mockDiff({ status: 'success', changes: [{ kind: 'unchanged', id: 'b1', slot: 0, text: 'Nothing changed here.' }] });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/no differences/i);
    expect(component.find('[role="alert"]').exists()).toBe(false);
  });

  test('each classification renders its own accessible label, isolated from the others in the same result', async () => {
    mockDiff({ status: 'success', changes: MIXED_CHANGES });
    const component = await mountSuspended(PageInApp);

    // Case-sensitive `.toContain`, not a case-insensitive regex: the
    // badge label "Removed" contains the literal substring "moved" (as in
    // "re-MOVED"), so a `/moved/i` check against removedRow's text would
    // pass for the wrong reason. The badges render Title Case and the
    // surrounding prose does not, so an exact-case check on the label
    // itself is the assertion that actually isolates one kind from another.
    const removedRow = component.findAll('li').find((li) => li.text().includes('apples'))!;
    expect(removedRow.text()).toContain('Removed');
    expect(removedRow.text()).not.toContain('Added');
    expect(removedRow.text()).not.toContain('Modified');
    expect(removedRow.text()).not.toContain('Moved');

    const modifiedRow = component.findAll('li').find((li) => li.text().includes('grapes'))!;
    expect(modifiedRow.text()).toContain('Modified');
    expect(modifiedRow.text()).not.toContain('Added');
    expect(modifiedRow.text()).not.toContain('Removed');

    const addedRow = component.findAll('li').find((li) => li.text().includes('kiwis'))!;
    expect(addedRow.text()).toContain('Added');
    expect(addedRow.text()).not.toContain('Removed');
    expect(addedRow.text()).not.toContain('Modified');
    expect(addedRow.text()).not.toContain('Moved');

    const unchangedRow = component.findAll('li').find((li) => li.text().includes('pears'))!;
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
    const component = await mountSuspended(PageInApp);

    const rows = component.findAll('li');
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
    const component = await mountSuspended(PageInApp);

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
    const component = await mountSuspended(PageInApp);

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
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toContain('Modified · moved down');
    const iconNames = component.findAllComponents(UIcon).map((icon) => icon.props('name'));
    expect(iconNames).toContain('i-lucide-arrow-down');
  });

  test("renders the block's own text content, not just its classification", async () => {
    mockDiff({ status: 'success', changes: MIXED_CHANGES });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toContain('Paragraph about kiwis, brand new.');
    expect(component.text()).toContain('Paragraph about apples, removed entirely.');
  });

  test('renders exactly one h1 for the screen, at the same type role every state uses', async () => {
    mockDiff({ status: 'success', changes: MIXED_CHANGES });
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('h1')).toHaveLength(1);
  });
});
