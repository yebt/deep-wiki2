import { describe, expect, test, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useAnchorHighlight, type UseAnchorHighlightResult } from './useAnchorHighlight';

/**
 * The highlight controller (owner request, 2026-09-23: a comment must be
 * visibly tied to its anchored text, "guíate en Word o Google Docs").
 *
 * The *mapping* — which characters of the rendered block a stored anchor
 * names — is pure and is held by `utils/anchor-range.test.ts`. What is held
 * here is the controller's behaviour around it: which element it measures,
 * that it never writes into the cached HTML, that it falls back to the whole
 * block rather than drawing nothing, and that it scrolls only when the span
 * is not already in front of the reader.
 *
 * The test environment lays nothing out, so `getClientRects()` is empty and
 * every measurement here lands on the `offsetTop` fallback. That is stated
 * rather than worked around: the painted geometry is measured in the running
 * browser, in `e2e/comments.spec.ts`, which is the only place it can be.
 */
function harness(html: string, target: { blockId: string; quote: string } | null) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  const article = document.createElement('article');
  article.innerHTML = html;
  wrapper.append(article);
  document.body.append(wrapper);

  const targetRef = ref(target);
  const scope = effectScope();
  let highlight!: UseAnchorHighlightResult;
  scope.run(() => {
    highlight = useAnchorHighlight(ref(article), ref(wrapper), targetRef);
  });
  return { article, wrapper, targetRef, highlight, scope };
}

const HTML = '<p data-block-id="b1">The soft lock is taken on entering edit mode.</p><p data-block-id="b2">Another block.</p>';

describe('useAnchorHighlight', () => {
  test('paints something for a thread whose block is on the page', async () => {
    const { highlight } = harness(HTML, { blockId: 'b1', quote: 'taken on entering' });
    await nextTick();

    expect(highlight.boxes.value).toHaveLength(1);
  });

  test('paints nothing when there is no thread in focus, so the highlight is dismissible and never persists', async () => {
    const { highlight, targetRef } = harness(HTML, { blockId: 'b1', quote: 'taken on entering' });
    await nextTick();
    expect(highlight.boxes.value).toHaveLength(1);

    targetRef.value = null;
    await nextTick();
    expect(highlight.boxes.value).toHaveLength(0);
  });

  test('paints nothing when the block the thread names is not on the page at all', async () => {
    const { highlight } = harness(HTML, { blockId: 'gone', quote: 'taken on entering' });
    await nextTick();

    expect(highlight.boxes.value).toHaveLength(0);
    expect(highlight.located.value).toBe(false);
  });

  test('says when it could not find the span, so a caller can word its announcement for the whole block', async () => {
    const { highlight } = harness(HTML, { blockId: 'b1', quote: 'words this block never held' });
    await nextTick();

    // The whole block, not nothing: "somewhere in this paragraph" is honest.
    expect(highlight.boxes.value).toHaveLength(1);
    expect(highlight.located.value).toBe(false);
  });

  test('never writes into the cached HTML it measures', async () => {
    const { article, highlight } = harness(HTML, { blockId: 'b1', quote: 'taken on entering' });
    const before = article.innerHTML;
    await nextTick();
    highlight.measure();
    highlight.reveal();

    expect(article.innerHTML).toBe(before);
  });

  test('follows the thread in focus: pointing it at another block re-measures', async () => {
    const { targetRef, highlight } = harness(HTML, { blockId: 'b1', quote: 'taken on entering' });
    await nextTick();
    const measure = vi.spyOn(document, 'createTreeWalker');

    targetRef.value = { blockId: 'b2', quote: 'Another block.' };
    await nextTick();

    // The second block was walked, which only a re-measurement does.
    expect(measure).toHaveBeenCalled();
    expect(highlight.boxes.value).toHaveLength(1);
    measure.mockRestore();
  });

  test('scrolls the span into view when it is off screen, and leaves the page alone when it is not', async () => {
    const { article, highlight } = harness(HTML, { blockId: 'b1', quote: 'taken on entering' });
    await nextTick();
    const block = article.querySelector<HTMLElement>('[data-block-id="b1"]')!;
    const scrollIntoView = vi.fn();
    block.scrollIntoView = scrollIntoView;

    // The span's own rectangle is what decides, not the block's: a long
    // paragraph can straddle the fold while the commented sentence does not.
    const rect = vi.spyOn(Range.prototype, 'getBoundingClientRect');

    // In front of the reader: nothing moves.
    rect.mockReturnValue({ top: 300, bottom: 340 } as DOMRect);
    highlight.reveal();
    expect(scrollIntoView).not.toHaveBeenCalled();

    // Below the fold: centred, and smoothly, which the global
    // reduced-motion override turns off for anyone who asked for that.
    rect.mockReturnValue({ top: window.innerHeight + 200, bottom: window.innerHeight + 240 } as DOMRect);
    highlight.reveal();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    rect.mockRestore();
  });

  test('a reveal with nothing in focus does nothing rather than throwing', async () => {
    const { highlight } = harness(HTML, null);
    await nextTick();

    expect(() => highlight.reveal()).not.toThrow();
  });
});
