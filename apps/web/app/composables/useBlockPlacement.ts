import type { CommentIndicator } from '@deep-wiki/contracts';

export interface PlacedMark {
  readonly blockId: string;
  readonly count: number;
  /** The block's top edge, in px, relative to the article's positioned wrapper. */
  readonly top: number;
}

export interface UseBlockPlacementResult {
  /** Marks that found their block, in document order — what the gutter draws. */
  readonly placed: Ref<readonly PlacedMark[]>;
  /** Block ids no element on screen carries — the "no anchors known" input (design.md Decision 6). Empty until the article exists. */
  readonly unplaced: Ref<readonly string[]>;
  /** Re-run the measurement, for a caller that knows the layout moved. */
  readonly measure: () => void;
}

/**
 * Where each comment indicator sits beside the cached HTML
 * (comment-overlay spec: "The Client Composes Indicators Onto Unchanged
 * Cached HTML"). The HTML is never touched: `render()` emitted
 * `data-block-id` on each anchored block, this reads the element back by
 * that attribute and takes its `offsetTop` relative to the wrapper the
 * screen made `position: relative`, so the gutter can draw an absolutely
 * positioned mark level with the block's first line.
 *
 * An indicator whose block no element carries is *unplaced*, and
 * distinguished from "not measured yet": before the article has rendered
 * there is nothing to look for, and reporting a thread as unplaceable
 * then would flash a false "can't be shown beside its text" notice on
 * every page load. Once the article exists, an unplaced indicator means
 * exactly one thing — the cached render predates `data-block-id` and the
 * backfill has not reached this page — and the screen says so rather than
 * drawing nothing (docs/UI-CHECKLIST.md §4.7).
 *
 * Re-measured whenever the article element, its size, or the indicators
 * change: fonts load late, images resize paragraphs, and the viewport
 * reflows the measure — a mark that does not follow its block is §4.7's
 * "indicator stays correct while scrolling" failing at rest.
 */
export function useBlockPlacement(
  article: Ref<HTMLElement | null>,
  indicators: Ref<readonly CommentIndicator[]>,
): UseBlockPlacementResult {
  const placed = ref<readonly PlacedMark[]>([]);
  const unplaced = ref<readonly string[]>([]);

  function measure(): void {
    const root = article.value;
    if (!root) {
      placed.value = [];
      unplaced.value = [];
      return;
    }
    const marks: PlacedMark[] = [];
    const missing: string[] = [];
    for (const indicator of indicators.value) {
      const element = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(indicator.blockId)}"]`);
      if (element) marks.push({ blockId: indicator.blockId, count: indicator.count, top: element.offsetTop });
      else missing.push(indicator.blockId);
    }
    // Document order, whatever order the threads arrived in: the gutter
    // is read top to bottom. `offsetTop` ties are broken by DOM position.
    marks.sort((a, b) => {
      if (a.top !== b.top) return a.top - b.top;
      const first = root.querySelector(`[data-block-id="${CSS.escape(a.blockId)}"]`)!;
      const second = root.querySelector(`[data-block-id="${CSS.escape(b.blockId)}"]`)!;
      return first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    placed.value = marks;
    unplaced.value = missing;
  }

  let observer: ResizeObserver | null = null;

  watch(
    [article, indicators],
    () => {
      observer?.disconnect();
      observer = null;
      measure();
      const root = article.value;
      if (root && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => measure());
        observer.observe(root);
      }
    },
    { immediate: true, flush: 'post' },
  );

  if (typeof window !== 'undefined') {
    const onResize = (): void => measure();
    window.addEventListener('resize', onResize);
    onScopeDispose(() => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    });
  }

  return { placed, unplaced, measure };
}
