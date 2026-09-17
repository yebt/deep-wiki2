<script lang="ts">
/**
 * The text of one edited block with its word-level changes marked —
 * `<ins>` for an inserted run, `<del>` for a deleted one, plain text for
 * what both sides share — so assistive technology reads "insertion" and
 * "deletion" around the words themselves (docs/UI-CHECKLIST.md §5:
 * colour is never the sole carrier; the element's own semantics, the
 * underline and the strike are the second signal, and `DiffBlockChanges`
 * draws the legend once).
 *
 * A render function, not a template: this renders *inside a `<pre>`*, and
 * a template's own line breaks between `<ins>` and `<del>` would be
 * preserved there as real whitespace in the block's text.
 *
 * Fills are the opaque container pairs (docs/DESIGN-SYSTEM.md §1.2, never
 * an alpha — §12.8): `success-container`/`on-success-container` for an
 * insertion — the alias that already names "Added" on the block badge,
 * carrying M3's `tertiary-container` role here, one hue for one meaning —
 * and `error-container`/`on-error-container` for a deletion. Each mark
 * carries the same 1px inset ring in its accent that every tonal chip
 * does (§9.1/§9.7's `TONAL_BOUNDARY`, measured ≥ 4.47:1 against the
 * fill): the 2026-09-14 audit found a `soft` badge at 1.00:1 on its own
 * container row, and a mark on the `bg-default` row is the same shape of
 * risk. `box-decoration-clone` keeps the fill and ring whole on each line
 * a wrapped mark spans.
 */
import { defineComponent, h, type PropType, type VNodeChild } from 'vue';

export interface InlineSegment {
  readonly kind: 'equal' | 'inserted' | 'deleted';
  readonly text: string;
}

/** Which side of the block to read: both sides interleaved (unified), or one column of a side-by-side layout. */
export type InlineSide = 'both' | 'before' | 'after';

const MARK_BASE = 'rounded-xs px-1 ring ring-inset box-decoration-clone decoration-1';
export const INSERTED_CLASS = `${MARK_BASE} bg-success-container text-on-success-container ring-success underline`;
export const DELETED_CLASS = `${MARK_BASE} bg-error-container text-on-error-container ring-error line-through`;

export default defineComponent({
  name: 'DiffInlineText',
  props: {
    segments: { type: Array as PropType<readonly InlineSegment[]>, required: true },
    side: { type: String as PropType<InlineSide>, default: 'both' },
  },
  setup(props) {
    return (): VNodeChild[] =>
      props.segments.flatMap((segment): VNodeChild[] => {
        if (segment.kind === 'equal') return [segment.text];
        if (segment.kind === 'inserted') {
          return props.side === 'before' ? [] : [h('ins', { class: INSERTED_CLASS }, segment.text)];
        }
        return props.side === 'after' ? [] : [h('del', { class: DELETED_CLASS }, segment.text)];
      });
  },
});
</script>
