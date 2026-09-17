import { UApp, UBadge, UIcon } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { useDiffLayout } from '~/composables/useDiffLayout';
import DiffBlockChanges from './DiffBlockChanges.vue';

/**
 * The one block renderer both diff screens use (block-diff spec: "Diff
 * Reports Added, Removed, Modified, And Moved"; docs/UI-CHECKLIST.md §4.7,
 * §4.1 — one component, not one copy per screen). Born as the book-diff
 * screen's `BookDiffBlockChanges`; the page-diff screen joined it on
 * 2026-09-17 when the word-level marks and the layout control arrived,
 * so neither could drift from the other.
 *
 * Every row stays on the neutral `bg-default` inset (docs/DESIGN-SYSTEM.md
 * §9.4: content inside a filled `UCard variant="soft"` steps DOWN to
 * `bg-default`) and carries the signal with a 4px accent-coloured left
 * border plus an `outline`-variant badge — never `soft`, which the
 * 2026-09-14 audit measured at 1.00–1.09:1 (invisible) on the
 * `bg-emphasized` ancestor this component sits inside — and, for an
 * edited block, its word-level changes as `<ins>`/`<del>`.
 */
type Props = InstanceType<typeof DiffBlockChanges>['$props'];

/** Tooltips (the layout control's) need `UApp`'s provider. */
async function mountInApp(props: Props) {
  return mountSuspended(
    defineComponent({ name: 'ChangesInApp', setup: () => () => h(UApp, null, { default: () => h(DiffBlockChanges, props) }) }),
  );
}

/** happy-dom has no layout: the viewport is whatever `matchMedia` says, and the component asks it once on mount. */
function stubViewport(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  useDiffLayout().set('unified');
});

describe('DiffBlockChanges', () => {
  // Mirrors page-diff.vue's own quality-bar fixture: one of every kind
  // alongside an untouched one, each asserted in isolation so a kind
  // cannot pass by accident of another kind's treatment.
  const MIXED_CHANGES = [
    { kind: 'removed' as const, id: 'b-removed', slot: 0, text: 'Paragraph about apples, removed entirely.' },
    { kind: 'modified' as const, id: 'b-modified', fromSlot: 1, toSlot: 0, moved: false, text: 'Paragraph about grapes, now changed.' },
    { kind: 'unchanged' as const, id: 'b-unchanged', slot: 1, text: 'Paragraph about pears, never touched.' },
    { kind: 'added' as const, id: 'b-added', slot: 2, text: 'Paragraph about kiwis, brand new.' },
    { kind: 'moved' as const, id: 'b-moved', fromSlot: 0, toSlot: 3, text: 'Paragraph about bananas, only its position changed.' },
  ];

  test('renders every block\'s own text, and each classification isolated from the others', async () => {
    const component = await mountInApp({ changes: MIXED_CHANGES });

    const removedRow = component.findAll('li').find((li) => li.text().includes('apples'))!;
    expect(removedRow.text()).toContain('Removed');
    expect(removedRow.text()).not.toContain('Added');
    expect(removedRow.text()).not.toContain('Modified');
    expect(removedRow.text()).not.toContain('Moved');

    const addedRow = component.findAll('li').find((li) => li.text().includes('kiwis'))!;
    expect(addedRow.text()).toContain('Added');
    expect(addedRow.text()).not.toContain('Removed');

    const modifiedRow = component.findAll('li').find((li) => li.text().includes('grapes'))!;
    expect(modifiedRow.text()).toContain('Modified');
    expect(modifiedRow.text()).not.toContain('Moved');

    const unchangedRow = component.findAll('li').find((li) => li.text().includes('pears'))!;
    expect(unchangedRow.text()).not.toMatch(/added|removed|modified|moved/i);
  });

  test('a moved block gets a visual treatment distinct from added, removed and modified — via its accent border, never a full-row wash', async () => {
    const component = await mountInApp({ changes: MIXED_CHANGES });

    const rows = component.findAll('li');
    const movedRow = rows.find((li) => li.text().includes('bananas'))!;
    const addedRow = rows.find((li) => li.text().includes('kiwis'))!;
    const removedRow = rows.find((li) => li.text().includes('apples'))!;
    const modifiedRow = rows.find((li) => li.text().includes('grapes'))!;

    expect(movedRow.text()).toContain('Moved');

    // Distinct signal lives on the accent border, not a background wash —
    // every row (changed or not) shares the same neutral `bg-default`.
    const borderClassOf = (row: typeof movedRow) => row.classes().find((c) => c.startsWith('border-') && !c.startsWith('border-l-4'));
    const movedBorder = borderClassOf(movedRow);
    expect(movedBorder).toBeDefined();
    expect([borderClassOf(addedRow), borderClassOf(removedRow), borderClassOf(modifiedRow)]).not.toContain(movedBorder);
    for (const row of [movedRow, addedRow, removedRow, modifiedRow]) {
      expect(row.classes()).toContain('bg-default');
      expect(row.classes().some((c) => /-container\b|container$/.test(c))).toBe(false);
    }
  });

  test('every badge uses the `outline` variant, never `soft` — the audit found `soft` invisible on a bg-emphasized ancestor', async () => {
    const component = await mountInApp({ changes: MIXED_CHANGES });

    const badges = component.findAllComponents(UBadge);
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) {
      expect(badge.props('variant')).toBe('outline');
    }
  });

  test('a block moved later in the document reads "Moved down" with a downward arrow', async () => {
    const component = await mountInApp({ changes: [{ kind: 'moved' as const, id: 'b1', fromSlot: 0, toSlot: 3, text: 'This paragraph moved later in the document.' }] });

    expect(component.text()).toContain('Moved down');
    const iconNames = component.findAllComponents(UIcon).map((icon) => icon.props('name'));
    expect(iconNames).toContain('i-lucide-arrow-down');
    expect(iconNames).not.toContain('i-lucide-arrow-up');
  });

  test('a block moved earlier in the document reads "Moved up" with an upward arrow', async () => {
    const component = await mountInApp({ changes: [{ kind: 'moved' as const, id: 'b1', fromSlot: 3, toSlot: 0, text: 'This paragraph moved earlier in the document.' }] });

    expect(component.text()).toContain('Moved up');
    const iconNames = component.findAllComponents(UIcon).map((icon) => icon.props('name'));
    expect(iconNames).toContain('i-lucide-arrow-up');
  });

  test('a modified block that also changed position carries the same directional cue as a pure move', async () => {
    const component = await mountInApp({ changes: [{ kind: 'modified' as const, id: 'b1', fromSlot: 0, toSlot: 2, moved: true, text: 'Edited and moved later.', segments: [] }] });

    expect(component.text()).toContain('Modified · moved down');
  });

  test('removed blocks render in their own section, ordered by their old position, separate from the current-order list', async () => {
    const component = await mountInApp({ changes: MIXED_CHANGES });

    const removedSection = component.get('[aria-label*="removed"]');
    expect(removedSection.text()).toContain('apples');
    expect(removedSection.text()).not.toContain('kiwis');
  });

  test('a fixture where nothing moved never renders a Moved label — the moved branch is exercised, not merely absent', async () => {
    const component = await mountInApp({
      changes: [
        { kind: 'unchanged' as const, id: 'b1', slot: 0, text: 'Untouched heading.' },
        { kind: 'modified' as const, id: 'b2', fromSlot: 1, toSlot: 1, moved: false, text: 'Edited in place.', segments: [] },
      ],
    });

    expect(component.text()).not.toMatch(/moved/i);
  });

  // The word-level half of "a diff like GitHub's" (owner review
  // 2026-09-17): an edited block shows which words changed, as `<ins>`
  // and `<del>` so assistive technology reads them, with one legend per
  // screen; a moved-and-edited block shows both facts.
  const EDITED = {
    kind: 'modified' as const,
    id: 'b-edited',
    fromSlot: 0,
    toSlot: 0,
    moved: false,
    text: 'The page as it was first saved, now with one small edit.',
    segments: [
      { kind: 'equal' as const, text: 'The page as it was first saved, ' },
      { kind: 'inserted' as const, text: 'now ' },
      { kind: 'equal' as const, text: 'with ' },
      { kind: 'deleted' as const, text: 'no edits yet' },
      { kind: 'inserted' as const, text: 'one small edit' },
      { kind: 'equal' as const, text: '.' },
    ],
  };

  test('an edited block marks its inserted and deleted words as <ins>/<del>, and the legend says what the marks mean, once', async () => {
    const component = await mountInApp({ changes: [EDITED, { kind: 'unchanged' as const, id: 'b-plain', slot: 1, text: 'Untouched.' }] });

    const row = component.findAll('li').find((li) => li.text().includes('first saved'))!;
    expect(row.findAll('ins').map((el) => el.element.textContent)).toEqual(['now ', 'one small edit']);
    expect(row.findAll('del').map((el) => el.element.textContent)).toEqual(['no edits yet']);
    expect(row.find('pre').element.textContent).toBe('The page as it was first saved, now with no edits yetone small edit.');

    const legend = component.get('[data-testid="diff-legend"]');
    expect(legend.text()).toMatch(/inserted/i);
    expect(legend.text()).toMatch(/deleted/i);
    expect(component.findAll('[data-testid="diff-legend"]')).toHaveLength(1);
  });

  test('a moved-and-edited block shows both: the directional badge and its inline marks', async () => {
    const component = await mountInApp({ changes: [{ ...EDITED, fromSlot: 2, toSlot: 0, moved: true }] });

    const row = component.findAll('li').find((li) => li.text().includes('first saved'))!;
    expect(row.text()).toContain('Modified · moved up');
    expect(row.findAll('del')).toHaveLength(1);
  });

  test('a modified block that arrived without segments still renders its text, unmarked', async () => {
    const component = await mountInApp({ changes: [{ kind: 'modified' as const, id: 'b1', fromSlot: 0, toSlot: 0, moved: false, text: 'Edited in place.' }] });

    const row = component.findAll('li').find((li) => li.text().includes('Edited in place'))!;
    expect(row.findAll('ins, del')).toHaveLength(0);
  });

  test('side by side: an edited block becomes a before column carrying the deletions and an after column carrying the insertions', async () => {
    stubViewport(true);
    useDiffLayout().set('side-by-side');
    const component = await mountInApp({ changes: [EDITED, { kind: 'added' as const, id: 'b-new', slot: 1, text: 'Brand new.' }] });

    const row = component.findAll('li').find((li) => li.text().includes('first saved'))!;
    const columns = row.findAll('pre');
    expect(columns).toHaveLength(2);
    expect(columns[0]!.element.textContent).toBe('Before: The page as it was first saved, with no edits yet.');
    expect(columns[0]!.findAll('ins')).toHaveLength(0);
    expect(columns[1]!.element.textContent).toBe('After: The page as it was first saved, now with one small edit.');
    expect(columns[1]!.findAll('del')).toHaveLength(0);

    // An added block has no before side, and the cell says so instead of standing empty.
    const addedRow = component.findAll('li').find((li) => li.text().includes('Brand new'))!;
    expect(addedRow.text()).toMatch(/not in the earlier revision/i);
    expect(addedRow.findAll('pre')).toHaveLength(1);
  });

  test('choosing a layout on the control is remembered in the cookie and redraws', async () => {
    stubViewport(true);
    const component = await mountInApp({ changes: [EDITED] });
    expect(component.findAll('li').find((li) => li.text().includes('first saved'))!.findAll('pre')).toHaveLength(1);

    const sideBySide = component.findAll('button').find((button) => /side by side/i.test(button.text()))!;
    await sideBySide.trigger('click');
    await nextTick();

    expect(document.cookie).toContain('dw-diff-layout=side-by-side');
    expect(sideBySide.attributes('aria-pressed')).toBe('true');
    expect(component.findAll('li').find((li) => li.text().includes('first saved'))!.findAll('pre')).toHaveLength(2);
  });

  test('below md the side-by-side preference is honoured as one column, and the control still shows it pressed', async () => {
    stubViewport(false);
    useDiffLayout().set('side-by-side');
    const component = await mountInApp({ changes: [EDITED] });

    const row = component.findAll('li').find((li) => li.text().includes('first saved'))!;
    expect(row.findAll('pre')).toHaveLength(1);
    expect(row.findAll('ins')).toHaveLength(2);
    const sideBySide = component.findAll('button').find((button) => /side by side/i.test(button.text()))!;
    expect(sideBySide.attributes('aria-pressed')).toBe('true');
  });

  test('the list labels are the screen\'s own words when it gives them', async () => {
    const component = await mountInApp({
      changes: MIXED_CHANGES,
      currentLabel: 'Current revision, annotated with what changed',
      removedHeading: 'Removed in this revision',
      removedLabel: 'Blocks removed since the earlier revision',
    });

    expect(component.find('[aria-label="Current revision, annotated with what changed"]').exists()).toBe(true);
    expect(component.find('[aria-label="Blocks removed since the earlier revision"]').exists()).toBe(true);
    expect(component.text()).toContain('Removed in this revision');
  });
});
