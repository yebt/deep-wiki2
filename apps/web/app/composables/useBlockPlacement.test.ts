import { describe, expect, test } from 'vitest';
import { nextTick, ref } from 'vue';
import type { CommentIndicator } from '@deep-wiki/contracts';
import { useBlockPlacement } from './useBlockPlacement';

function articleWith(html: string): HTMLElement {
  const el = document.createElement('article');
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

describe('useBlockPlacement', () => {
  test('places an indicator beside the element carrying its data-block-id, and lists the ones no element carries', async () => {
    const article = ref<HTMLElement | null>(articleWith('<p data-block-id="b1">One</p><p>Two</p>'));
    const indicators = ref<readonly CommentIndicator[]>([
      { blockId: 'b1', count: 2 },
      { blockId: 'b9', count: 1 },
    ]);
    const { placed, unplaced } = useBlockPlacement(article, indicators);
    await nextTick();

    expect(placed.value.map((mark) => mark.blockId)).toEqual(['b1']);
    expect(placed.value[0]!.count).toBe(2);
    expect(unplaced.value).toEqual(['b9']);
  });

  // Before the article exists there is nothing to measure against, and
  // "unplaced" must not be reported — a thread is only unplaceable once
  // the HTML that should carry its block is actually on screen.
  test('reports nothing at all while the article has not rendered', async () => {
    const article = ref<HTMLElement | null>(null);
    const indicators = ref<readonly CommentIndicator[]>([{ blockId: 'b1', count: 1 }]);
    const { placed, unplaced } = useBlockPlacement(article, indicators);
    await nextTick();

    expect(placed.value).toEqual([]);
    expect(unplaced.value).toEqual([]);
  });

  // A page whose cached render predates `data-block-id` (design.md
  // Decision 6, "no anchors known"): every anchored thread is unplaceable,
  // and the screen says so instead of drawing nothing.
  test('a render with no data-block-id at all leaves every indicator unplaced', async () => {
    const article = ref<HTMLElement | null>(articleWith('<p>One</p><p>Two</p>'));
    const indicators = ref<readonly CommentIndicator[]>([
      { blockId: 'b1', count: 1 },
      { blockId: 'b2', count: 1 },
    ]);
    const { placed, unplaced } = useBlockPlacement(article, indicators);
    await nextTick();

    expect(placed.value).toEqual([]);
    expect(unplaced.value).toEqual(['b1', 'b2']);
  });

  test('re-measures when the indicators change', async () => {
    const article = ref<HTMLElement | null>(articleWith('<p data-block-id="b1">One</p><p data-block-id="b2">Two</p>'));
    const indicators = ref<readonly CommentIndicator[]>([{ blockId: 'b1', count: 1 }]);
    const { placed } = useBlockPlacement(article, indicators);
    await nextTick();
    expect(placed.value.map((mark) => mark.blockId)).toEqual(['b1']);

    indicators.value = [
      { blockId: 'b1', count: 1 },
      { blockId: 'b2', count: 3 },
    ];
    await nextTick();

    expect(placed.value.map((mark) => mark.blockId)).toEqual(['b1', 'b2']);
  });

  test('a mark carries the top offset of its block, in document order', async () => {
    const article = ref<HTMLElement | null>(articleWith('<p data-block-id="b1">One</p><p data-block-id="b2">Two</p>'));
    const indicators = ref<readonly CommentIndicator[]>([
      { blockId: 'b2', count: 1 },
      { blockId: 'b1', count: 1 },
    ]);
    const { placed } = useBlockPlacement(article, indicators);
    await nextTick();

    // Document order, whatever order the threads arrived in: the gutter
    // is read top to bottom.
    expect(placed.value.map((mark) => mark.blockId)).toEqual(['b1', 'b2']);
    expect(placed.value.every((mark) => typeof mark.top === 'number')).toBe(true);
  });
});
