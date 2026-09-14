import { UBadge, UIcon } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import BookDiffBlockChanges from './BookDiffBlockChanges.vue';

/**
 * The book-diff screen's per-page block renderer (block-diff spec: "Diff
 * Reports Added, Removed, Modified, And Moved"; docs/UI-CHECKLIST.md §4.7;
 * task 10.5).
 *
 * Reused from `apps/web/app/pages/pages/[id]/diff.vue`: the removed/
 * current-order split and the up/down moved-direction computation from
 * `fromSlot`/`toSlot`. Changed: that screen paints every changed row's
 * FULL background in its kind's accent-container colour — the audit
 * called this "a highlighter pass over source". This component instead
 * keeps every row on the neutral `bg-default` inset
 * (docs/DESIGN-SYSTEM.md §9.4: content inside a filled `UCard
 * variant="soft"` steps DOWN to `bg-default`) and carries the signal with
 * a 4px accent-coloured left border plus an `outline`-variant badge —
 * never `soft`, which the audit measured at 1.00–1.09:1 (invisible) on the
 * `bg-emphasized` ancestor this component sits inside on the diff screen.
 */
describe('BookDiffBlockChanges', () => {
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
    const component = await mountSuspended(BookDiffBlockChanges, { props: { changes: MIXED_CHANGES } });

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
    const component = await mountSuspended(BookDiffBlockChanges, { props: { changes: MIXED_CHANGES } });

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
    const component = await mountSuspended(BookDiffBlockChanges, { props: { changes: MIXED_CHANGES } });

    const badges = component.findAllComponents(UBadge);
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) {
      expect(badge.props('variant')).toBe('outline');
    }
  });

  test('a block moved later in the document reads "Moved down" with a downward arrow', async () => {
    const component = await mountSuspended(BookDiffBlockChanges, {
      props: { changes: [{ kind: 'moved' as const, id: 'b1', fromSlot: 0, toSlot: 3, text: 'This paragraph moved later in the document.' }] },
    });

    expect(component.text()).toContain('Moved down');
    const iconNames = component.findAllComponents(UIcon).map((icon) => icon.props('name'));
    expect(iconNames).toContain('i-lucide-arrow-down');
    expect(iconNames).not.toContain('i-lucide-arrow-up');
  });

  test('a block moved earlier in the document reads "Moved up" with an upward arrow', async () => {
    const component = await mountSuspended(BookDiffBlockChanges, {
      props: { changes: [{ kind: 'moved' as const, id: 'b1', fromSlot: 3, toSlot: 0, text: 'This paragraph moved earlier in the document.' }] },
    });

    expect(component.text()).toContain('Moved up');
    const iconNames = component.findAllComponents(UIcon).map((icon) => icon.props('name'));
    expect(iconNames).toContain('i-lucide-arrow-up');
  });

  test('a modified block that also changed position carries the same directional cue as a pure move', async () => {
    const component = await mountSuspended(BookDiffBlockChanges, {
      props: { changes: [{ kind: 'modified' as const, id: 'b1', fromSlot: 0, toSlot: 2, moved: true, text: 'Edited and moved later.' }] },
    });

    expect(component.text()).toContain('Modified · moved down');
  });

  test('removed blocks render in their own section, ordered by their old position, separate from the current-order list', async () => {
    const component = await mountSuspended(BookDiffBlockChanges, { props: { changes: MIXED_CHANGES } });

    const removedSection = component.get('[aria-label*="removed"]');
    expect(removedSection.text()).toContain('apples');
    expect(removedSection.text()).not.toContain('kiwis');
  });

  test('a fixture where nothing moved never renders a Moved label — the moved branch is exercised, not merely absent', async () => {
    const component = await mountSuspended(BookDiffBlockChanges, {
      props: {
        changes: [
          { kind: 'unchanged' as const, id: 'b1', slot: 0, text: 'Untouched heading.' },
          { kind: 'modified' as const, id: 'b2', fromSlot: 1, toSlot: 1, moved: false, text: 'Edited in place.' },
        ],
      },
    });

    expect(component.text()).not.toMatch(/moved/i);
  });
});
