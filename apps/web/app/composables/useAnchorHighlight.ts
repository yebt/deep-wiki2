import { locateQuoteInText, needsReveal, rangeOverOffsets } from '../utils/anchor-range';
import { blockSelector } from '../utils/block-element';

/** One painted rectangle, in the coordinates of the wrapper the article sits in. */
export interface HighlightBox {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** What a thread points at: the block, and the text inside it the comment was written against. */
export interface HighlightTarget {
  readonly blockId: string;
  readonly quote: string;
}

export interface UseAnchorHighlightResult {
  /** The rectangles to paint, one per line the span wraps onto; empty when there is nothing to highlight. */
  readonly boxes: Ref<readonly HighlightBox[]>;
  /** Whether a span *inside* the block was located, rather than the whole block being the fallback. */
  readonly located: Ref<boolean>;
  /** Re-measure, for a caller that knows the layout moved. */
  readonly measure: () => void;
  /** Scroll the span into view — only if it is not already in front of the reader. */
  readonly reveal: () => void;
}

/** The sticky contextual bar's height (docs/DESIGN-SYSTEM.md §7.2, `--ui-header-height`): chrome the span must not hide behind. */
const STICKY_BAR = 56;

/**
 * The highlight that ties a comment to its text (owner request, 2026-09-23:
 * *"Guíate en Word o Google Docs"*).
 *
 * In both reference products, selecting a comment highlights **the anchored
 * span** in the document and scrolls it into view. What stood here before
 * was a wash over the whole block — a paragraph-wide tint that said "the
 * comment is about something in here" and no more, which is exactly the
 * relation the owner said was not being shown.
 *
 * ## Painted behind, never written into
 *
 * The article is `v-html` of the cached render and nothing may write into
 * it: the comment overlay's whole contract is that the HTML is the same
 * bytes for every viewer and the client composes over it (comment-overlay
 * spec, "The Client Composes Indicators Onto Unchanged Cached HTML"). So
 * the span is measured as a DOM `Range` and painted as absolutely
 * positioned boxes *behind* the article — one per `getClientRects()`
 * rectangle, which is one per line the span wraps onto, so a highlight that
 * crosses a line break looks like a highlight and not like a rectangle
 * drawn over two.
 *
 * The CSS Custom Highlight API (`CSS.highlights`) would do this without
 * boxes and was considered. It is not used: a `::highlight()` pseudo cannot
 * be measured from a test or a screenshot, and this project's rule is that
 * a colour pair is asserted in the running browser (docs/UI-CHECKLIST.md
 * §4.2, §5 — `e2e/read.spec.ts` measures computed values). A mechanism no
 * gate can see is a mechanism that regresses silently.
 *
 * ## When the span cannot be found
 *
 * `locateQuoteInText` answers `null` when the rendered text does not hold
 * the anchor's quote at all — a block edited since the thread was written,
 * a quote whose markers defeated the stripper. The fallback is the whole
 * block, which is the honest span for "somewhere in this paragraph" and is
 * also the *correct* one for a thread anchored to a whole block, the common
 * case. `located` says which of the two happened, so a caller can word its
 * announcement accordingly.
 *
 * An orphaned thread is not this composable's business: it has no block at
 * all, and the thread itself says so where the person is reading it
 * (`CommentThreadItem`'s "Text removed"). The caller passes `null`.
 */
export function useAnchorHighlight(
  article: Ref<HTMLElement | null>,
  wrapper: Ref<HTMLElement | null>,
  target: Ref<HighlightTarget | null>,
  /** Anything whose change means the layout moved — the caller's measured marks will do. */
  layout?: Ref<unknown>,
): UseAnchorHighlightResult {
  const boxes = ref<readonly HighlightBox[]>([]);
  const located = ref(false);

  /** The block element and the range over its anchored span, measured fresh every time. */
  function resolve(): { block: HTMLElement; range: Range | null } | null {
    const root = article.value;
    const wanted = target.value;
    if (!root || !wanted) return null;
    const block = root.querySelector<HTMLElement>(blockSelector(wanted.blockId));
    if (!block) return null;
    const span = locateQuoteInText(block.textContent ?? '', wanted.quote);
    return { block, range: span ? rangeOverOffsets(block, span.start, span.end) : null };
  }

  function measure(): void {
    const resolved = resolve();
    const frame = wrapper.value;
    if (!resolved || !frame) {
      boxes.value = [];
      located.value = false;
      return;
    }

    const origin = frame.getBoundingClientRect();
    const rects = resolved.range ? [...resolved.range.getClientRects()].filter((rect) => rect.width > 0 || rect.height > 0) : [];
    if (rects.length > 0) {
      located.value = true;
      boxes.value = rects.map((rect) => ({
        top: rect.top - origin.top,
        left: rect.left - origin.left,
        width: rect.width,
        height: rect.height,
      }));
      return;
    }

    // The whole block, the way the highlight was drawn before a span could
    // be found — measured through `offsetTop`, which needs no live rects
    // and is what `useBlockPlacement` places the gutter's marks by.
    located.value = false;
    boxes.value = [
      { top: resolved.block.offsetTop, left: resolved.block.offsetLeft, width: resolved.block.offsetWidth, height: resolved.block.offsetHeight },
    ];
  }

  function reveal(): void {
    const resolved = resolve();
    if (!resolved) return;
    const rect = resolved.range?.getBoundingClientRect() ?? resolved.block.getBoundingClientRect();
    const viewport = { top: STICKY_BAR, bottom: window.innerHeight };
    // Already in front of the reader: scrolling would move the document
    // under someone who is reading it (`needsReveal`).
    if (!needsReveal({ top: rect.top, bottom: rect.bottom }, viewport)) return;
    // The block, not the range: a `Range` has no `scrollIntoView`, and a
    // paragraph in the 72ch reading measure is short enough that centring
    // it puts the span on screen. A span low in a very long block is the
    // known limit of this, recorded in docs/TODO.md rather than solved with
    // a scroll calculation of our own.
    // `behavior: 'smooth'` is honoured by the global reduced-motion
    // override, which sets `scroll-behavior: auto` (DESIGN-SYSTEM §6.6).
    resolved.block.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  watch(
    [target, article, wrapper, ...(layout ? [layout] : [])],
    () => measure(),
    { immediate: true, flush: 'post' },
  );

  if (typeof window !== 'undefined') {
    const onResize = (): void => measure();
    window.addEventListener('resize', onResize);
    onScopeDispose(() => window.removeEventListener('resize', onResize));
  }

  return { boxes, located, measure, reveal };
}
