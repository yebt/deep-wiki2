import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import type { PlacedMark } from '~/composables/useBlockPlacement';
import CommentGutter from './CommentGutter.vue';

/**
 * The marks beside anchored blocks (comment-overlay spec; docs/UI-CHECKLIST.md
 * §4.7). happy-dom has no layout, so geometry — that a mark sits level
 * with its block and outside the reading column — is `e2e/comments.spec.ts`'s;
 * this file holds what the mark *is*: a named, tooltipped, keyboard-reachable
 * control whose count collapses every thread on the block into one.
 */
type GutterProps = InstanceType<typeof CommentGutter>['$props'];

function inApp(props: GutterProps) {
  return defineComponent({
    name: 'GutterInApp',
    setup: () => () => h(UApp, null, { default: () => h(CommentGutter, props) }),
  });
}

const MARKS: readonly PlacedMark[] = [
  { blockId: 'b1', count: 1, top: 0 },
  { blockId: 'b2', count: 3, top: 120 },
];

describe('CommentGutter', () => {
  test('draws one control per placed mark, named by its count, at its block’s top', async () => {
    const component = await mountSuspended(inApp({ marks: MARKS, activeBlockId: null }));

    const buttons = component.findAll('button');
    expect(buttons.map((button) => button.attributes('aria-label'))).toEqual([
      '1 comment on this block',
      '3 comments on this block',
    ]);
    const items = component.findAll('[data-testid="comment-mark"]');
    expect(items[1]!.attributes('style')).toContain('top: 120px');
  });

  test('an icon-only mark carries a tooltip as well as its accessible name (§4.3)', async () => {
    const component = await mountSuspended(inApp({ marks: MARKS, activeBlockId: null }));

    // Reka's tooltip trigger stamps `data-state` on the control it names.
    expect(component.get('button').attributes('data-state')).toBeDefined();
  });

  test('the count is visible, not only in the name, once more than one thread or reply sits on the block', async () => {
    const component = await mountSuspended(inApp({ marks: MARKS, activeBlockId: null }));

    const items = component.findAll('[data-testid="comment-mark"]');
    expect(items[0]!.text()).toBe('');
    expect(items[1]!.text()).toBe('3');
  });

  test('clicking a mark asks to open that block’s threads', async () => {
    const component = await mountSuspended(inApp({ marks: MARKS, activeBlockId: null }));
    const gutter = component.findComponent(CommentGutter);

    await component.findAll('button')[1]!.trigger('click');

    expect(gutter.emitted('open')).toEqual([['b2']]);
  });

  test('the mark whose block the panel is showing reads as pressed', async () => {
    const component = await mountSuspended(inApp({ marks: MARKS, activeBlockId: 'b2' }));

    const buttons = component.findAll('button');
    expect(buttons[0]!.attributes('aria-pressed')).toBe('false');
    expect(buttons[1]!.attributes('aria-pressed')).toBe('true');
  });

  // The API answers `{ threads: [] }` for a read-only caller and for a
  // page with no comments alike; neither may leave an empty gutter in the
  // tab order or the accessibility tree.
  test('renders nothing at all when there is nothing to mark', async () => {
    const component = await mountSuspended(inApp({ marks: [], activeBlockId: null }));

    expect(component.find('ul').exists()).toBe(false);
    expect(component.find('button').exists()).toBe(false);
  });
});
