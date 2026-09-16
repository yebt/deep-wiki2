import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import type { PlacedBlock, PlacedMark } from '~/composables/useBlockPlacement';
import CommentGutter from './CommentGutter.vue';

/**
 * The marks beside anchored blocks (comment-overlay spec; docs/UI-CHECKLIST.md
 * §4.7). happy-dom has no layout, so geometry — that a mark sits level
 * with its block and outside the reading column — is `e2e/comments.spec.ts`'s;
 * this file holds what the mark *is*: a named, tooltipped, keyboard-reachable
 * control whose count collapses every thread on the block into one.
 */
type GutterProps = InstanceType<typeof CommentGutter>['$props'];

function inApp(props: Partial<GutterProps>) {
  return defineComponent({
    name: 'GutterInApp',
    setup: () => () => h(UApp, null, { default: () => h(CommentGutter, { marks: [], blocks: [], activeBlockId: null, hoveredBlockId: null, canStart: false, ...props }) }),
  });
}

const MARKS: readonly PlacedMark[] = [
  { blockId: 'b1', count: 1, top: 0 },
  { blockId: 'b2', count: 3, top: 120 },
];

/** Every commentable block: the two marked ones and one with no thread yet, between them. */
const BLOCKS: readonly PlacedBlock[] = [
  { blockId: 'b1', top: 0 },
  { blockId: 'd:0123456789ab#0', top: 60 },
  { blockId: 'b2', top: 120 },
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

  // Starting a thread (docs/UI-CHECKLIST.md §4.7; tasks.md 10.7's gap):
  // beside every block that has no mark, a "+" that opens the composer —
  // offered only to a caller the API says may comment, never as an empty
  // affordance to a reader.
  describe('the "+" to comment on a block', () => {
    test('draws one per commentable block without a mark, named, tooltipped, at the block’s top — only for a caller who may comment', async () => {
      const component = await mountSuspended(inApp({ marks: MARKS, blocks: BLOCKS, canStart: true }));

      const starts = component.findAll('button[aria-label="Comment on this block"]');
      expect(starts).toHaveLength(1);
      expect(starts[0]!.attributes('data-state')).toBeDefined();
      expect(component.get('[data-testid="comment-start"]').attributes('style')).toContain('top: 60px');

      const reader = await mountSuspended(inApp({ marks: MARKS, blocks: BLOCKS, canStart: false }));
      expect(reader.findAll('button[aria-label="Comment on this block"]')).toHaveLength(0);
    });

    test('a page with no thread yet still offers the "+" on every block', async () => {
      const component = await mountSuspended(inApp({ marks: [], blocks: BLOCKS, canStart: true }));
      expect(component.findAll('button[aria-label="Comment on this block"]')).toHaveLength(3);
    });

    test('is quiet until its block is hovered or it is focused, and never hidden from the tab order', async () => {
      const component = await mountSuspended(inApp({ marks: [], blocks: BLOCKS, canStart: true, hoveredBlockId: 'd:0123456789ab#0' }));
      const items = component.findAll('[data-testid="comment-start"]');
      expect(items[1]!.attributes('data-revealed')).toBe('true');
      expect(items[0]!.attributes('data-revealed')).toBe('false');
      // Quiet, not gone: the control keeps its size and its place.
      expect(items[0]!.attributes('aria-hidden')).toBeUndefined();
    });

    test('clicking it asks to start a thread on that block', async () => {
      const component = await mountSuspended(inApp({ marks: MARKS, blocks: BLOCKS, canStart: true }));
      await component.get('button[aria-label="Comment on this block"]').trigger('click');
      expect(component.findComponent(CommentGutter).emitted('start')).toEqual([['d:0123456789ab#0']]);
    });

    // §4.1: a hand-rolled group of controls owes the keyboard contract a
    // library one would bring. One tab stop, arrows between the controls
    // in document order, Home and End to the ends, and the screen says so.
    test('the gutter is one tab stop with the arrow keys moving between marks and "+" in document order', async () => {
      const component = await mountSuspended(inApp({ marks: MARKS, blocks: BLOCKS, canStart: true }), { attachTo: document.body });
      const buttons = component.findAll('button');
      expect(buttons.map((button) => button.attributes('aria-label'))).toEqual([
        '1 comment on this block',
        'Comment on this block',
        '3 comments on this block',
      ]);
      expect(buttons.map((button) => button.attributes('tabindex'))).toEqual(['0', '-1', '-1']);
      expect(component.get('ul').attributes('aria-describedby')).toBeDefined();
      expect(component.text()).toContain('arrow keys');

      (buttons[0]!.element as HTMLElement).focus();
      await buttons[0]!.trigger('keydown', { key: 'ArrowDown' });
      expect(document.activeElement).toBe(buttons[1]!.element);
      expect(buttons[1]!.attributes('tabindex')).toBe('0');
      await buttons[1]!.trigger('keydown', { key: 'End' });
      expect(document.activeElement).toBe(buttons[2]!.element);
      await buttons[2]!.trigger('keydown', { key: 'ArrowUp' });
      expect(document.activeElement).toBe(buttons[1]!.element);
      await buttons[1]!.trigger('keydown', { key: 'Home' });
      expect(document.activeElement).toBe(buttons[0]!.element);
      component.unmount();
    });
  });
});
