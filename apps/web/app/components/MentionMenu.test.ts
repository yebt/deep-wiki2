import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import type { MentionCandidate } from '@deep-wiki/editor';
import MentionMenu from './MentionMenu.vue';

/**
 * The one mention menu (docs/UI-CHECKLIST.md §4.1, §4.6): the listbox
 * contract the editor and the comment composer both rely on — an id the
 * owner's `aria-controls` names, options the owner's `aria-activedescendant`
 * can point at, a distinct selected state, and both empty states.
 */
type MenuProps = InstanceType<typeof MentionMenu>['$props'];

const CANDIDATES: readonly MentionCandidate[] = [
  { id: 'u1', type: 'user', label: 'Ana Lima' },
  { id: 'p1', type: 'page', label: 'Runbook' },
];

function inApp(props: Partial<MenuProps> = {}) {
  return defineComponent({
    name: 'MenuInApp',
    setup: () => () =>
      h(UApp, null, {
        default: () => h(MentionMenu, { id: 'menu', candidates: CANDIDATES, selectedIndex: 0, query: 'a', optionIdPrefix: 'opt-', ...props }),
      }),
  });
}

describe('MentionMenu', () => {
  test('is a listbox whose options carry the ids the owner names, with exactly one selected', async () => {
    const component = await mountSuspended(inApp({ selectedIndex: 1 }));

    const listbox = component.get('[role="listbox"]');
    expect(listbox.attributes('id')).toBe('menu');
    const options = component.findAll('[role="option"]');
    expect(options.map((option) => option.attributes('id'))).toEqual(['opt-0', 'opt-1']);
    expect(options.map((option) => option.attributes('aria-selected'))).toEqual(['false', 'true']);
    expect(options.map((option) => option.text())).toEqual(['Ana Lima', 'Runbook']);
  });

  test('clicking an option selects it by index', async () => {
    const component = await mountSuspended(inApp());
    await component.findAll('[role="option"]')[1]!.trigger('click');
    expect(component.findComponent(MentionMenu).emitted('select')).toEqual([[1]]);
  });

  test('an empty query and a miss are two different empty states', async () => {
    const empty = await mountSuspended(inApp({ candidates: [], query: '' }));
    expect(empty.text()).toContain('Type to search people and pages');

    const miss = await mountSuspended(inApp({ candidates: [], query: 'zzz' }));
    expect(miss.text()).toContain('No matches');
  });

  test('a menu with viewport coordinates is fixed; one without is placed by its owner', async () => {
    const atCaret = await mountSuspended(inApp({ position: { top: 10, left: 20 } }));
    const fixed = atCaret.get('[role="listbox"]');
    expect(fixed.classes()).toContain('fixed');
    expect(fixed.attributes('style')).toContain('top: 10px');

    const inFlow = await mountSuspended(inApp());
    expect(inFlow.get('[role="listbox"]').classes()).toContain('absolute');
  });
});
